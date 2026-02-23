/**
 * CodeHive File Watcher
 *
 * Monitors the project directory for file changes and emits structured
 * events that get relayed to connected teammates. Uses chokidar v4 for
 * cross-platform, high-performance file watching.
 *
 * The watcher:
 * - Ignores common non-source directories (node_modules, .git, dist, etc.)
 * - Debounces rapid changes PER FILE to avoid flooding the relay
 * - Computes lightweight diffs for text files
 * - Skips binary files
 * - Caps memory usage for file content cache
 */

import { watch, type FSWatcher } from "chokidar";
import { readFile, stat } from "node:fs/promises";
import { relative, extname } from "node:path";
import type { DevName, DeviceId, FileChange, RelativePath } from "../shared/types.js";
import { computeDiffSummary, now } from "../shared/utils.js";

/** Directories and patterns to ignore when watching. */
const IGNORED_PATTERNS = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/build/**",
  "**/.next/**",
  "**/.nuxt/**",
  "**/coverage/**",
  "**/__pycache__/**",
  "**/.venv/**",
  "**/*.pyc",
  "**/target/**",
  "**/.DS_Store",
  "**/Thumbs.db",
  "**/.env",
  "**/.env.*",
  "**/package-lock.json",
  "**/yarn.lock",
  "**/pnpm-lock.yaml",
  "**/bun.lockb",
];

/** File extensions considered binary (skip diff computation). */
const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".webp", ".svg",
  ".mp3", ".mp4", ".wav", ".avi", ".mov", ".mkv",
  ".zip", ".tar", ".gz", ".bz2", ".7z", ".rar",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx",
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
  ".exe", ".dll", ".so", ".dylib",
  ".sqlite", ".db",
]);

/** Max number of file contents to cache (LRU eviction). */
const MAX_CACHED_FILES = 500;

export type FileChangeHandler = (change: FileChange) => void;

export interface WatcherOptions {
  projectPath: string;
  deviceId: DeviceId;
  devName: DevName;
  onFileChange: FileChangeHandler;
  debounceMs?: number;
}

/**
 * Manages file system watching and change detection.
 */
export class FileWatcher {
  private watcher: FSWatcher | null = null;
  private fileContents: Map<RelativePath, string> = new Map();
  private debouncedHandlers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private projectPath: string;
  private deviceId: DeviceId;
  private devName: DevName;
  private onFileChange: FileChangeHandler;
  private debounceMs: number;

  constructor(options: WatcherOptions) {
    this.projectPath = options.projectPath;
    this.deviceId = options.deviceId;
    this.devName = options.devName;
    this.onFileChange = options.onFileChange;
    this.debounceMs = options.debounceMs ?? 300;
  }

  /**
   * Start watching the project directory for changes.
   */
  async start(): Promise<void> {
    if (this.watcher) return;

    this.watcher = watch(this.projectPath, {
      ignored: IGNORED_PATTERNS,
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 50,
      },
    });

    // Per-file debounce handler
    const scheduleChange = (path: string, type: "add" | "change" | "unlink") => {
      const existing = this.debouncedHandlers.get(path);
      if (existing) clearTimeout(existing);

      const timer = setTimeout(() => {
        this.debouncedHandlers.delete(path);
        void this.handleChange(path, type);
      }, this.debounceMs);

      this.debouncedHandlers.set(path, timer);
    };

    this.watcher.on("add", (path) => scheduleChange(path, "add"));
    this.watcher.on("change", (path) => scheduleChange(path, "change"));
    this.watcher.on("unlink", (path) => scheduleChange(path, "unlink"));

    this.watcher.on("error", (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[CodeHive Watcher] error:", message);
    });

    // Wait for chokidar to finish initial scan
    await new Promise<void>((resolve) => {
      this.watcher!.on("ready", resolve);
    });
  }

  /**
   * Stop watching for changes.
   */
  async stop(): Promise<void> {
    // Clear all pending debounce timers
    for (const timer of this.debouncedHandlers.values()) {
      clearTimeout(timer);
    }
    this.debouncedHandlers.clear();

    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
    this.fileContents.clear();
  }

  /**
   * Handle a single file system event.
   */
  private async handleChange(
    absolutePath: string,
    type: "add" | "change" | "unlink",
  ): Promise<void> {
    const relativePath = relative(this.projectPath, absolutePath).replace(
      /\\/g,
      "/",
    );

    const ext = extname(absolutePath).toLowerCase();
    const isBinary = BINARY_EXTENSIONS.has(ext);

    let diff: string | null = null;
    let linesAdded = 0;
    let linesRemoved = 0;
    let sizeBefore: number | null = null;
    let sizeAfter: number | null = null;

    // For binary files, report file size changes
    if (isBinary && type !== "unlink") {
      try {
        const fileStat = await stat(absolutePath);
        sizeAfter = fileStat.size;
        // We don't track binary file sizes in cache, so sizeBefore stays null for now
      } catch {
        return;
      }
    } else if (isBinary && type === "unlink") {
      // Binary file deleted — no size info available
    } else if (!isBinary && type !== "unlink") {
      try {
        const newContent = await readFile(absolutePath, "utf-8");
        const oldContent = this.fileContents.get(relativePath) ?? "";

        if (type === "change" && oldContent) {
          const summary = computeDiffSummary(oldContent, newContent);
          diff = summary.diff;
          linesAdded = summary.linesAdded;
          linesRemoved = summary.linesRemoved;
        } else if (type === "add") {
          linesAdded = newContent.split("\n").length;
        }

        // Cache with LRU eviction
        this.fileContents.set(relativePath, newContent);
        this.evictCacheIfNeeded();
      } catch {
        // File might have been deleted between detection and read — skip event
        return;
      }
    } else if (type === "unlink") {
      const oldContent = this.fileContents.get(relativePath);
      if (oldContent) {
        linesRemoved = oldContent.split("\n").length;
      }
      this.fileContents.delete(relativePath);
    }

    const change: FileChange = {
      path: relativePath,
      type,
      author: this.devName,
      deviceId: this.deviceId,
      timestamp: now(),
      diff,
      linesAdded,
      linesRemoved,
      ...(sizeBefore !== null || sizeAfter !== null ? { sizeBefore, sizeAfter } : {}),
    };

    this.onFileChange(change);
  }

  /** Evict oldest cached file contents if over the limit. */
  private evictCacheIfNeeded(): void {
    while (this.fileContents.size > MAX_CACHED_FILES) {
      // Map iterates in insertion order — first key is oldest
      const oldestKey = this.fileContents.keys().next().value;
      if (oldestKey !== undefined) {
        this.fileContents.delete(oldestKey);
      } else {
        break;
      }
    }
  }
}
