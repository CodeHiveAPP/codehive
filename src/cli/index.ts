/**
 * CodeHive CLI
 *
 * Main entry point for all CodeHive commands:
 *
 *   codehive init                → Auto-setup: configures your AI editor + starts local relay
 *   codehive init --relay <url>  → Configure with a remote relay (for remote teams)
 *   codehive init --editor <ed>  → Force a specific editor (claude-code, cursor, windsurf, copilot)
 *   codehive relay               → Start the relay server (foreground)
 *   codehive relay --background  → Start the relay server in background
 *   codehive deploy              → Deploy relay to the cloud (Fly.io / Docker)
 *   codehive uninstall           → Remove CodeHive from editor config
 *   codehive status              → Show current configuration and relay status
 *   codehive doctor              → Full diagnostics
 */

import { Command } from "commander";
import chalk from "chalk";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { resolve, join, dirname } from "node:path";
import { homedir, userInfo } from "node:os";
import { execSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { startRelayServer } from "../relay/server.js";
import {
  DEFAULT_RELAY_HOST,
  DEFAULT_RELAY_PORT,
} from "../shared/protocol.js";

import { createRequire } from "node:module";
const _require = createRequire(import.meta.url);
const { version: VERSION } = _require("../../package.json") as { version: string };

const BANNER = `
  ${chalk.hex("#FFB800").bold("  ____          _      _   _ _")}
  ${chalk.hex("#FFB800").bold(" / ___|___   __| | ___| | | (_)_   _____")}
  ${chalk.hex("#FFB800").bold("| |   / _ \\ / _\\` |/ _ \\ |_| | \\ \\ / / _ \\")}
  ${chalk.hex("#FFB800").bold("| |__| (_) | (_| |  __/  _  | |\\ V /  __/")}
  ${chalk.hex("#FFB800").bold(" \\____\\___/ \\__,_|\\___|_| |_|_| \\_/ \\___|")}
  ${chalk.dim("v" + VERSION + " — Real-time collaboration for AI-powered coding")}
`;

// ---------------------------------------------------------------------------
// Supported editors
// ---------------------------------------------------------------------------

type EditorId = "claude-code" | "cursor" | "windsurf" | "copilot";

interface EditorConfig {
  name: string;
  projectConfig: string;
  globalConfig: string;
  configKey: string;
}

const EDITORS: Record<EditorId, EditorConfig> = {
  "claude-code": {
    name: "Claude Code",
    projectConfig: ".mcp.json",
    globalConfig: join(homedir(), ".claude.json"),
    configKey: "mcpServers",
  },
  cursor: {
    name: "Cursor",
    projectConfig: ".cursor/mcp.json",
    globalConfig: join(homedir(), ".cursor", "mcp.json"),
    configKey: "mcpServers",
  },
  windsurf: {
    name: "Windsurf",
    projectConfig: ".windsurf/mcp.json",
    globalConfig: join(homedir(), ".codeium", "windsurf", "mcp_config.json"),
    configKey: "mcpServers",
  },
  copilot: {
    name: "VS Code + Copilot",
    projectConfig: ".vscode/mcp.json",
    globalConfig: join(homedir(), ".vscode", "mcp.json"),
    configKey: "servers",
  },
};

const EDITOR_IDS = Object.keys(EDITORS) as EditorId[];

/** Try to find a binary by name. Returns true if found. */
function isBinaryAvailable(name: string): boolean {
  try {
    const cmd = process.platform === "win32"
      ? `where ${name} 2>nul`
      : `which ${name} 2>/dev/null`;
    execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
    return true;
  } catch {
    return false;
  }
}

/** Detect which editors are available on this system. */
function detectEditors(): EditorId[] {
  const detected: EditorId[] = [];

  // Claude Code: check for ~/.claude directory or claude binary
  const claudeDir = join(homedir(), ".claude");
  if (existsSync(claudeDir) || isBinaryAvailable("claude")) {
    detected.push("claude-code");
  }

  // Cursor: check for ~/.cursor directory or cursor binary
  const cursorDir = join(homedir(), ".cursor");
  if (existsSync(cursorDir) || isBinaryAvailable("cursor")) {
    detected.push("cursor");
  }

  // Windsurf: check for ~/.codeium directory or windsurf binary
  const codeiumDir = join(homedir(), ".codeium");
  if (existsSync(codeiumDir) || isBinaryAvailable("windsurf")) {
    detected.push("windsurf");
  }

  // VS Code + Copilot: check for ~/.vscode directory or code binary
  const vscodeDir = join(homedir(), ".vscode");
  if (existsSync(vscodeDir) || isBinaryAvailable("code")) {
    detected.push("copilot");
  }

  return detected;
}

const program = new Command();

program
  .name("codehive")
  .version(VERSION)
  .description("Real-time multi-developer collaboration for AI-powered coding");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve the path to the codehive-relay binary/script. */
function findRelayBin(): string {
  const __filename = fileURLToPath(import.meta.url);
  const binDir = resolve(dirname(__filename), "..", "..", "bin");
  const relayBin = join(binDir, "codehive-relay.js");
  if (existsSync(relayBin)) return relayBin;

  // Fallback: try global
  try {
    const whichCmd = process.platform === "win32"
      ? "where codehive-relay 2>nul"
      : "which codehive-relay 2>/dev/null";
    return execSync(whichCmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] })
      .trim().split("\n")[0]!;
  } catch {
    return "";
  }
}

/** Check if a WebSocket server is reachable at the given URL. */
async function isRelayReachable(host: string, port: number): Promise<boolean> {
  const { default: WebSocket } = await import("ws");
  const url = `ws://${host}:${port}`;

  return new Promise<boolean>((res) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.terminate();
      res(false);
    }, 3000);

    ws.on("open", () => {
      clearTimeout(timer);
      ws.terminate();
      res(true);
    });

    ws.on("error", () => {
      clearTimeout(timer);
      res(false);
    });
  });
}

/** Parse a relay URL like ws://host:port or host:port. Supports IPv6. */
function parseRelayUrl(url: string): { host: string; port: number } {
  const normalized = url.startsWith("ws") ? url : `ws://${url}`;
  try {
    const parsed = new URL(normalized);
    return {
      host: parsed.hostname || DEFAULT_RELAY_HOST,
      port: parsed.port ? parseInt(parsed.port, 10) : DEFAULT_RELAY_PORT,
    };
  } catch {
    return { host: DEFAULT_RELAY_HOST, port: DEFAULT_RELAY_PORT };
  }
}

/** Start the relay server as a detached background process. */
function startRelayBackground(port: number, host: string = "127.0.0.1"): boolean {
  const relayBin = findRelayBin();
  if (!relayBin) return false;

  try {
    const child = spawn("node", [relayBin], {
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        CODEHIVE_HOST: host,
        CODEHIVE_PORT: String(port),
      },
    });

    child.unref();
    return true;
  } catch {
    return false;
  }
}

/** Read and parse a JSON config file. */
function readJsonConfig(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Write a JSON config file with pretty formatting. */
function writeJsonConfig(path: string, config: Record<string, unknown>): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

/** Configure a single editor. */
function configureEditor(
  editorId: EditorId,
  isGlobal: boolean,
  relayHost: string,
  relayPort: number,
  devName: string,
): string {
  const editor = EDITORS[editorId];
  const configPath = isGlobal
    ? editor.globalConfig
    : resolve(process.cwd(), editor.projectConfig);

  const env: Record<string, string> = {
    CODEHIVE_RELAY_HOST: relayHost,
    CODEHIVE_RELAY_PORT: String(relayPort),
    CODEHIVE_DEV_NAME: devName,
  };

  const mcpConfig: Record<string, unknown> = {
    command: "npx",
    args: ["-y", "codehive", "mcp-server"],
    env,
  };

  // Find codehive-mcp binary for local installs
  try {
    const whichCmd = process.platform === "win32"
      ? "where codehive-mcp 2>nul"
      : "which codehive-mcp 2>/dev/null";
    const binPath = execSync(whichCmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] })
      .trim().split("\n")[0];
    if (binPath) {
      mcpConfig.command = "codehive-mcp";
      mcpConfig.args = [];
    }
  } catch {
    // Keep npx fallback
  }

  const config = readJsonConfig(configPath);
  const key = editor.configKey;
  if (!config[key] || typeof config[key] !== "object") {
    config[key] = {};
  }
  (config[key] as Record<string, unknown>)["codehive"] = mcpConfig;

  writeJsonConfig(configPath, config);
  return configPath;
}

// ---------------------------------------------------------------------------
// codehive init
// ---------------------------------------------------------------------------

program
  .command("init")
  .description("Set up CodeHive for your project (auto-detects and configures your AI editor)")
  .option("--relay <url>", "Remote relay URL (e.g. ws://relay.example.com:4819)")
  .option("--port <port>", "Local relay port", String(DEFAULT_RELAY_PORT))
  .option("--name <name>", "Your display name")
  .option("--global", "Install globally instead of per-project")
  .option("--editor <editor>", "Force a specific editor (claude-code, cursor, windsurf, copilot)")
  .option("--no-auto-relay", "Don't auto-start a local relay server")
  .action(async (options) => {
    console.log(BANNER);
    console.log();

    const isGlobal = options.global === true;
    const devName = options.name || userInfo().username;

    let relayHost: string;
    let relayPort: number;
    let isRemote = false;

    // ---------------------------------------------------------------
    // Step 1: Determine relay server
    // ---------------------------------------------------------------
    if (options.relay) {
      const parsed = parseRelayUrl(options.relay);
      relayHost = parsed.host;
      relayPort = parsed.port;
      isRemote = true;

      console.log(chalk.white("  [1/3] Relay server"));
      console.log(chalk.dim(`    Using remote relay: ws://${relayHost}:${relayPort}`));

      const reachable = await isRelayReachable(relayHost, relayPort);
      if (reachable) {
        console.log(chalk.green("    ✓ Relay is reachable"));
      } else {
        console.log(chalk.yellow("    ⚠ Relay is not reachable right now (will retry when you connect)"));
      }
    } else {
      relayHost = "127.0.0.1";
      relayPort = parseInt(options.port, 10);

      console.log(chalk.white("  [1/3] Relay server"));

      const alreadyRunning = await isRelayReachable(relayHost, relayPort);
      if (alreadyRunning) {
        console.log(chalk.green(`    ✓ Local relay already running on port ${relayPort}`));
      } else if (options.autoRelay !== false) {
        const started = startRelayBackground(relayPort);
        if (started) {
          await new Promise((r) => setTimeout(r, 1500));
          const nowRunning = await isRelayReachable(relayHost, relayPort);
          if (nowRunning) {
            console.log(chalk.green(`    ✓ Local relay auto-started on port ${relayPort}`));
          } else {
            console.log(chalk.yellow(`    ⚠ Relay started but not yet responding (may need a moment)`));
          }
        } else {
          console.log(chalk.yellow("    ⚠ Could not auto-start relay. Run manually: codehive relay"));
        }
      } else {
        console.log(chalk.dim(`    Relay auto-start disabled. Run manually: codehive relay`));
      }
    }

    console.log();

    // ---------------------------------------------------------------
    // Step 2: Detect and configure editors
    // ---------------------------------------------------------------
    console.log(chalk.white("  [2/3] Editor configuration"));

    let targetEditors: EditorId[];

    if (options.editor) {
      const editorId = options.editor as EditorId;
      if (!EDITORS[editorId]) {
        console.error(chalk.red(`    ✗ Unknown editor: ${editorId}`));
        console.log(chalk.dim(`    Available: ${EDITOR_IDS.join(", ")}`));
        process.exit(1);
      }
      targetEditors = [editorId];
    } else {
      // Auto-detect
      targetEditors = detectEditors();

      if (targetEditors.length === 0) {
        // Fallback: configure for all via .mcp.json (Claude Code format, widely supported)
        console.log(chalk.dim("    No specific editor detected — using standard MCP config (.mcp.json)"));
        targetEditors = ["claude-code"];
      }
    }

    const configuredPaths: string[] = [];
    for (const editorId of targetEditors) {
      const editor = EDITORS[editorId];
      const configPath = configureEditor(editorId, isGlobal, relayHost, relayPort, devName);
      configuredPaths.push(configPath);
      console.log(chalk.green("    ✓") + ` ${editor.name} configured`);
      console.log(chalk.dim(`      ${configPath}`));
    }

    console.log();

    // ---------------------------------------------------------------
    // Step 3: Summary
    // ---------------------------------------------------------------
    console.log(chalk.white("  [3/3] Ready!"));
    console.log();

    const editorNames = targetEditors.map((id) => EDITORS[id].name).join(", ");
    console.log(chalk.white("  ┌─────────────────────────────────────────────────────┐"));
    console.log(chalk.white("  │                                                     │"));
    console.log(chalk.white("  │  In your AI editor, just say:                       │"));
    console.log(chalk.white("  │                                                     │"));
    console.log(chalk.white("  │    ") + chalk.cyan('"Create a CodeHive collaboration room"') + chalk.white("    │"));
    console.log(chalk.white("  │                                                     │"));
    console.log(chalk.white("  │  Then share the room code with your teammate.       │"));
    console.log(chalk.white("  │  They join with:                                    │"));
    console.log(chalk.white("  │                                                     │"));
    console.log(chalk.white("  │    ") + chalk.cyan('"Join CodeHive room HIVE-XXXX"') + chalk.white("             │"));
    console.log(chalk.white("  │                                                     │"));
    console.log(chalk.white("  └─────────────────────────────────────────────────────┘"));
    console.log();
    console.log(chalk.dim(`  Configured for: ${editorNames}`));
    console.log(chalk.dim("  Works with: Claude Code, Cursor, Windsurf, VS Code + Copilot"));
    console.log();

    if (isRemote) {
      console.log(chalk.dim("  Your teammates run:"));
      console.log(chalk.cyan(`    npm install -g codehive && codehive init --relay ws://${relayHost}:${relayPort}`));
    } else {
      console.log(chalk.dim("  For remote teammates, deploy a relay first:"));
      console.log(chalk.cyan("    codehive deploy --help"));
    }

    console.log();
  });

// ---------------------------------------------------------------------------
// codehive relay
// ---------------------------------------------------------------------------

program
  .command("relay")
  .description("Start the CodeHive relay server")
  .option("--host <host>", "Host to bind to", DEFAULT_RELAY_HOST)
  .option("-p, --port <port>", "Port to listen on", String(DEFAULT_RELAY_PORT))
  .option("--public", "Bind to 0.0.0.0 for remote access")
  .option("--background", "Run in the background (detached)")
  .action((options) => {
    const host = options.public ? "0.0.0.0" : options.host;
    const port = parseInt(options.port, 10);

    if (isNaN(port) || port < 1 || port > 65535) {
      console.error(chalk.red("  ✗ Invalid port number"));
      process.exit(1);
    }

    if (options.background) {
      const started = startRelayBackground(port, host);
      if (started) {
        console.log(chalk.green("  ✓") + ` Relay started in background on port ${port}`);
      } else {
        console.error(chalk.red("  ✗ Failed to start relay in background"));
        process.exit(1);
      }
      return;
    }

    console.log(BANNER);
    console.log(chalk.dim(`  Starting relay server...`));
    console.log();

    startRelayServer({ host, port });

    console.log();
    console.log(chalk.dim("  Developers can now connect to this relay."));

    if (options.public) {
      console.log(chalk.yellow("  ⚠ Public mode: accessible from any network interface"));
    }

    console.log();
    console.log(chalk.dim("  Press Ctrl+C to stop."));
  });

// ---------------------------------------------------------------------------
// codehive deploy
// ---------------------------------------------------------------------------

program
  .command("deploy")
  .description("Deploy the relay server to the cloud for remote collaboration")
  .action(() => {
    console.log(BANNER);
    console.log();
    console.log(chalk.white("  Deploy the CodeHive relay for remote teams"));
    console.log();

    console.log(chalk.hex("#FFB800").bold("  Option 1: Fly.io (recommended, free tier)"));
    console.log();
    console.log(chalk.dim("    1. Install Fly CLI:"));
    console.log(chalk.cyan("       curl -L https://fly.io/install.sh | sh"));
    console.log();
    console.log(chalk.dim("    2. From the codehive directory:"));
    console.log(chalk.cyan("       fly launch --name my-codehive-relay"));
    console.log(chalk.cyan("       fly deploy"));
    console.log();
    console.log(chalk.dim("    3. Tell your teammates:"));
    console.log(chalk.cyan("       codehive init --relay ws://my-codehive-relay.fly.dev:4819"));
    console.log();

    console.log(chalk.hex("#FFB800").bold("  Option 2: Docker (any server)"));
    console.log();
    console.log(chalk.dim("    1. Build the image:"));
    console.log(chalk.cyan("       docker build -t codehive-relay ."));
    console.log();
    console.log(chalk.dim("    2. Run it:"));
    console.log(chalk.cyan("       docker run -d -p 4819:4819 --name codehive codehive-relay"));
    console.log();
    console.log(chalk.dim("    3. Tell your teammates:"));
    console.log(chalk.cyan("       codehive init --relay ws://YOUR_SERVER_IP:4819"));
    console.log();

    console.log(chalk.hex("#FFB800").bold("  Option 3: Any VPS / Cloud"));
    console.log();
    console.log(chalk.dim("    1. Install on your server:"));
    console.log(chalk.cyan("       npm install -g codehive"));
    console.log();
    console.log(chalk.dim("    2. Run the relay:"));
    console.log(chalk.cyan("       codehive relay --public"));
    console.log();
    console.log(chalk.dim("    Tip: Use PM2 to keep it running:"));
    console.log(chalk.cyan("       pm2 start codehive -- relay --public"));
    console.log();
  });

// ---------------------------------------------------------------------------
// codehive uninstall
// ---------------------------------------------------------------------------

program
  .command("uninstall")
  .description("Remove CodeHive from all configured editors")
  .option("--global", "Remove from global configs")
  .option("--editor <editor>", "Remove from a specific editor only")
  .action((options) => {
    const isGlobal = options.global === true;
    const targetEditors = options.editor
      ? [options.editor as EditorId]
      : EDITOR_IDS;

    let removed = 0;

    for (const editorId of targetEditors) {
      const editor = EDITORS[editorId];
      if (!editor) continue;

      const configPath = isGlobal
        ? editor.globalConfig
        : resolve(process.cwd(), editor.projectConfig);

      if (!existsSync(configPath)) continue;

      try {
        const config = readJsonConfig(configPath);
        const servers = config[editor.configKey] as Record<string, unknown> | undefined;

        if (servers?.["codehive"]) {
          delete servers["codehive"];
          writeJsonConfig(configPath, config);
          console.log(chalk.green("  ✓") + ` CodeHive removed from ${editor.name} (${configPath})`);
          removed++;
        }
      } catch {
        // Skip this editor
      }
    }

    if (removed === 0) {
      console.log(chalk.yellow("  ⚠ CodeHive not found in any editor config"));
    }
  });

// ---------------------------------------------------------------------------
// codehive status
// ---------------------------------------------------------------------------

program
  .command("status")
  .description("Show CodeHive configuration and relay connectivity")
  .action(async () => {
    console.log(BANNER);
    console.log();
    console.log(chalk.white("  Editor configurations:"));

    let relayHost = DEFAULT_RELAY_HOST;
    let relayPort = DEFAULT_RELAY_PORT;
    let anyConfigured = false;

    for (const editorId of EDITOR_IDS) {
      const editor = EDITORS[editorId];
      const projectPath = resolve(process.cwd(), editor.projectConfig);
      const globalPath = editor.globalConfig;

      for (const [label, path] of [["Project", projectPath], ["Global", globalPath]] as const) {
        if (!existsSync(path)) continue;

        const config = readJsonConfig(path);
        const servers = config[editor.configKey] as Record<string, unknown> | undefined;
        const hive = servers?.["codehive"] as Record<string, unknown> | undefined;

        if (hive) {
          anyConfigured = true;
          console.log(chalk.green(`    ✓ ${editor.name} (${label})`) + chalk.dim(` → ${path}`));
          const hiveEnv = hive["env"] as Record<string, string> | undefined;
          if (hiveEnv) {
            if (hiveEnv["CODEHIVE_RELAY_HOST"]) relayHost = hiveEnv["CODEHIVE_RELAY_HOST"];
            if (hiveEnv["CODEHIVE_RELAY_PORT"]) relayPort = parseInt(hiveEnv["CODEHIVE_RELAY_PORT"], 10);
            if (hiveEnv["CODEHIVE_DEV_NAME"]) {
              console.log(chalk.dim(`      Name: ${hiveEnv["CODEHIVE_DEV_NAME"]}`));
            }
            console.log(chalk.dim(`      Relay: ws://${relayHost}:${relayPort}`));
          }
        }
      }
    }

    if (!anyConfigured) {
      console.log(chalk.dim("    No editor configured. Run: codehive init"));
    }

    console.log();
    console.log(chalk.white("  Relay server:"));

    const reachable = await isRelayReachable(relayHost, relayPort);
    if (reachable) {
      console.log(chalk.green(`    ✓ Online`) + chalk.dim(` at ws://${relayHost}:${relayPort}`));
    } else {
      console.log(chalk.red(`    ✗ Offline`) + chalk.dim(` at ws://${relayHost}:${relayPort}`));
      console.log(chalk.dim("      Start with: codehive relay"));
    }

    console.log();
  });

// ---------------------------------------------------------------------------
// codehive doctor
// ---------------------------------------------------------------------------

program
  .command("doctor")
  .description("Run full diagnostics on your CodeHive setup")
  .action(async () => {
    console.log(BANNER);
    console.log();
    console.log(chalk.white("  Running diagnostics...\n"));

    let issues = 0;

    // Node.js version
    const nodeVersion = process.versions.node;
    const major = parseInt(nodeVersion.split(".")[0]!, 10);
    if (major >= 20) {
      console.log(chalk.green("  ✓") + ` Node.js v${nodeVersion}`);
    } else {
      console.log(chalk.red("  ✗") + ` Node.js v${nodeVersion} — need >= 20`);
      issues++;
    }

    // Check if codehive-mcp is available
    try {
      const whichMcp = process.platform === "win32"
        ? "where codehive-mcp 2>nul"
        : "which codehive-mcp 2>/dev/null";
      execSync(whichMcp, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
      console.log(chalk.green("  ✓") + " codehive-mcp binary found");
    } catch {
      console.log(chalk.yellow("  ~") + " codehive-mcp not in PATH (will use npx fallback)");
    }

    // Detect editors
    const detected = detectEditors();
    if (detected.length > 0) {
      const names = detected.map((id) => EDITORS[id].name).join(", ");
      console.log(chalk.green("  ✓") + ` Editors detected: ${names}`);
    } else {
      console.log(chalk.yellow("  ~") + " No AI editors detected (will use standard .mcp.json)");
    }

    // Check config files for all editors
    let configFound = false;
    let relayHost = DEFAULT_RELAY_HOST;
    let relayPort = DEFAULT_RELAY_PORT;

    for (const editorId of EDITOR_IDS) {
      const editor = EDITORS[editorId];
      const projectPath = resolve(process.cwd(), editor.projectConfig);
      const globalPath = editor.globalConfig;

      for (const path of [projectPath, globalPath]) {
        if (!existsSync(path)) continue;
        const config = readJsonConfig(path);
        const servers = config[editor.configKey] as Record<string, unknown> | undefined;
        const hive = servers?.["codehive"] as Record<string, unknown> | undefined;
        if (hive) {
          configFound = true;
          console.log(chalk.green("  ✓") + ` ${editor.name} MCP config found`);
          const hiveEnv = hive["env"] as Record<string, string> | undefined;
          if (hiveEnv?.["CODEHIVE_RELAY_HOST"]) relayHost = hiveEnv["CODEHIVE_RELAY_HOST"];
          if (hiveEnv?.["CODEHIVE_RELAY_PORT"]) relayPort = parseInt(hiveEnv["CODEHIVE_RELAY_PORT"], 10);
        }
      }
    }

    if (!configFound) {
      console.log(chalk.red("  ✗") + " No CodeHive config found — run: codehive init");
      issues++;
    }

    // Check relay connectivity
    console.log(chalk.dim(`  Checking relay at ws://${relayHost}:${relayPort}...`));
    const reachable = await isRelayReachable(relayHost, relayPort);
    if (reachable) {
      console.log(chalk.green("  ✓") + " Relay server reachable");
    } else {
      console.log(chalk.red("  ✗") + " Relay server not reachable");
      console.log(chalk.dim("      Start locally: codehive relay"));
      console.log(chalk.dim("      Or deploy:     codehive deploy --help"));
      issues++;
    }

    // Check Git
    try {
      execSync("git rev-parse --is-inside-work-tree 2>/dev/null", { encoding: "utf-8" });
      console.log(chalk.green("  ✓") + " Inside a Git repository");
    } catch {
      console.log(chalk.yellow("  ~") + " Not a Git repo (optional, but recommended)");
    }

    console.log();
    if (issues === 0) {
      console.log(chalk.green.bold("  All checks passed! You're ready to collaborate."));
    } else {
      console.log(chalk.yellow(`  ${issues} issue(s) found. Fix them and run codehive doctor again.`));
    }
    console.log();
  });

// ---------------------------------------------------------------------------
// codehive mcp-server (hidden — called by AI editors)
// ---------------------------------------------------------------------------

program
  .command("mcp-server")
  .description("Start the MCP server (used internally by AI editors)")
  .action(async () => {
    const { default: startMcp } = await import("../mcp/index.js");
    await startMcp();
  });

// ---------------------------------------------------------------------------
// Parse and run
// ---------------------------------------------------------------------------

program.parse();
