/**
 * CodeHive MCP Server
 *
 * Entry point for the Model Context Protocol server that integrates
 * CodeHive collaboration into any MCP-compatible AI editor.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { userInfo } from "node:os";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  DEFAULT_RELAY_HOST,
  DEFAULT_RELAY_PORT,
} from "../shared/protocol.js";
import type { AnyServerMessage } from "../shared/types.js";
import { generateDeviceId } from "../shared/utils.js";
import { RelayClient } from "./client.js";
import { registerTools, type ToolState } from "./tools.js";
import { FileWatcher } from "../watcher/index.js";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/** Detect current git branch in the project directory. */
function detectGitBranch(projectPath: string): string | undefined {
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: projectPath,
      encoding: "utf-8",
      timeout: 3000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return branch || undefined;
  } catch {
    return undefined;
  }
}

/** Load codehive.json config from project root. */
function loadProjectConfig(projectPath: string): Record<string, unknown> {
  try {
    const configPath = resolve(projectPath, "codehive.json");
    const data = readFileSync(configPath, "utf-8");
    return JSON.parse(data) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function main(): Promise<void> {
  const projectPath = resolve(process.env["CODEHIVE_PROJECT"] ?? process.cwd());

  // Load project config (codehive.json)
  const config = loadProjectConfig(projectPath);

  const relayHost = (process.env["CODEHIVE_RELAY_HOST"] ?? config["relayHost"] ?? DEFAULT_RELAY_HOST) as string;
  const relayPort = parseInt(
    (process.env["CODEHIVE_RELAY_PORT"] ?? String(config["relayPort"] ?? DEFAULT_RELAY_PORT)) as string,
    10,
  );
  const devName = (process.env["CODEHIVE_DEV_NAME"] ?? config["devName"] ?? userInfo().username) as string;
  const deviceId = generateDeviceId();

  // Detect git branch
  const gitBranch = detectGitBranch(projectPath);

  // -----------------------------------------------------------------------
  // Build MCP server
  // -----------------------------------------------------------------------
  const _require = createRequire(import.meta.url);
  const { version } = _require("../../package.json") as { version: string };

  const server = new McpServer({
    name: "codehive",
    version,
  });

  // -----------------------------------------------------------------------
  // Set up shared state
  // -----------------------------------------------------------------------
  const state: ToolState = {
    client: null!,
    watcher: null,
    lastRoomInfo: null,
    pendingNotifications: [],
  };

  // -----------------------------------------------------------------------
  // Real-time push notifications to the editor
  // -----------------------------------------------------------------------

  function pushToEditor(level: "info" | "warning" | "error", text: string): void {
    server.sendLoggingMessage({
      level,
      logger: "codehive",
      data: text,
    }).catch(() => {});
  }

  function handleServerEvent(msg: AnyServerMessage): void {
    let notification: string | null = null;

    switch (msg.type) {
      case "member_joined":
        notification = `${msg.member.name} joined the room${msg.member.branch ? ` [${msg.member.branch}]` : ""}`;
        pushToEditor("info", notification);
        break;

      case "member_left":
        notification = `${msg.member.name} left the room`;
        pushToEditor("info", notification);
        break;

      case "file_changed": {
        const c = msg.change;
        if (c.sizeAfter !== undefined && c.sizeAfter !== null) {
          const size = formatBytes(c.sizeAfter);
          notification = `${c.author} ${c.type}d ${c.path} (${size})`;
        } else {
          notification = `${c.author} ${c.type}d ${c.path} (+${c.linesAdded} -${c.linesRemoved})`;
        }
        pushToEditor("info", notification);
        break;
      }

      case "chat_received":
        notification = `[Chat] ${msg.from}: ${msg.content}`;
        pushToEditor("info", notification);
        break;

      case "conflict_warning":
        notification = `CONFLICT WARNING: ${msg.message}`;
        pushToEditor("warning", notification);
        break;

      case "typing_indicator":
        if (msg.file) {
          notification = `${msg.name} is typing in ${msg.file}`;
          // Don't push typing to editor (too noisy), just add to notifications
        }
        break;

      case "file_locked":
        notification = `${msg.lock.lockedBy} locked ${msg.lock.file}`;
        pushToEditor("info", notification);
        break;

      case "file_unlocked":
        notification = `${msg.unlockedBy} unlocked ${msg.file}`;
        pushToEditor("info", notification);
        break;

      case "lock_error":
        notification = `Lock denied: ${msg.error}`;
        pushToEditor("warning", notification);
        break;

      case "terminal_shared":
        notification = `[Terminal] ${msg.terminal.sharedBy} shared: \`${msg.terminal.command}\` (exit ${msg.terminal.exitCode ?? "?"})`;
        pushToEditor("info", notification);
        break;

      case "branch_warning":
        notification = `BRANCH WARNING: ${msg.message}`;
        pushToEditor("warning", notification);
        break;

      case "room_status":
        state.lastRoomInfo = msg.room;
        break;
    }

    if (notification) {
      state.pendingNotifications.push(notification);
    }

    if (state.pendingNotifications.length > 50) {
      state.pendingNotifications = state.pendingNotifications.slice(-50);
    }
  }

  // -----------------------------------------------------------------------
  // Initialize relay client
  // -----------------------------------------------------------------------
  const client = new RelayClient({
    host: relayHost,
    port: relayPort,
    deviceId,
    devName,
    projectPath,
    onMessage: handleServerEvent,
    onConnect: () => {
      console.error(`[CodeHive MCP] connected to relay at ${relayHost}:${relayPort}`);
    },
    onDisconnect: () => {
      console.error("[CodeHive MCP] disconnected from relay");
    },
  });

  // Set git branch
  if (gitBranch) {
    client.setBranch(gitBranch);
    console.error(`[CodeHive MCP] git branch: ${gitBranch}`);
  }

  state.client = client;

  // -----------------------------------------------------------------------
  // Initialize file watcher
  // -----------------------------------------------------------------------
  state.watcher = new FileWatcher({
    projectPath,
    deviceId,
    devName,
    onFileChange: (change) => {
      client.reportFileChange(change);
    },
  });

  // -----------------------------------------------------------------------
  // Periodic git branch re-detection (every 30s)
  // -----------------------------------------------------------------------
  let lastKnownBranch = gitBranch;
  const branchCheckInterval = setInterval(() => {
    const newBranch = detectGitBranch(projectPath);
    if (newBranch && newBranch !== lastKnownBranch) {
      lastKnownBranch = newBranch;
      client.setBranch(newBranch);
    }
  }, 30_000);

  // -----------------------------------------------------------------------
  // Register tools and start MCP transport
  // -----------------------------------------------------------------------
  registerTools(server, state);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("[CodeHive MCP] server started");

  // -----------------------------------------------------------------------
  // Connect to relay
  // -----------------------------------------------------------------------
  try {
    await client.connect();
  } catch {
    console.error(
      `[CodeHive MCP] relay not available at ${relayHost}:${relayPort}. Start it with: codehive relay`,
    );
  }

  // -----------------------------------------------------------------------
  // Graceful shutdown
  // -----------------------------------------------------------------------
  process.on("SIGINT", () => void shutdown(client, state, branchCheckInterval));
  process.on("SIGTERM", () => void shutdown(client, state, branchCheckInterval));
  process.stdin.on("end", () => void shutdown(client, state, branchCheckInterval));
  process.stdin.resume();
}

async function shutdown(client: RelayClient, state: ToolState, branchInterval: ReturnType<typeof setInterval>): Promise<void> {
  console.error("[CodeHive MCP] shutting down...");
  clearInterval(branchInterval);
  if (state.watcher) {
    await state.watcher.stop();
  }
  client.disconnect();
  process.exit(0);
}

export default main;
