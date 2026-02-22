/**
 * CodeHive MCP Server
 *
 * Entry point for the Model Context Protocol server that integrates
 * CodeHive collaboration into Claude Code. When Claude Code starts
 * this server, it gains access to all collaboration tools:
 *
 *   - create_room      → Create a new collaboration room
 *   - join_room        → Join an existing room
 *   - leave_room       → Leave the current room
 *   - get_team_status  → See connected teammates
 *   - get_recent_changes → View teammates' file changes
 *   - send_message     → Chat with teammates
 *   - declare_working  → Declare files you're editing
 *   - get_notifications → Check unread notifications
 *
 * Environment variables:
 *   CODEHIVE_RELAY_HOST  → Relay server host (default: 127.0.0.1)
 *   CODEHIVE_RELAY_PORT  → Relay server port (default: 4819)
 *   CODEHIVE_DEV_NAME    → Your display name (default: system username)
 *   CODEHIVE_PROJECT     → Project root path (default: cwd)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { userInfo } from "node:os";
import { resolve } from "node:path";
import {
  DEFAULT_RELAY_HOST,
  DEFAULT_RELAY_PORT,
} from "../shared/protocol.js";
import type { AnyServerMessage } from "../shared/types.js";
import { generateDeviceId, formatTime } from "../shared/utils.js";
import { RelayClient } from "./client.js";
import { registerTools, type ToolState } from "./tools.js";
import { FileWatcher } from "../watcher/index.js";

async function main(): Promise<void> {
  const relayHost = process.env["CODEHIVE_RELAY_HOST"] ?? DEFAULT_RELAY_HOST;
  const relayPort = parseInt(
    process.env["CODEHIVE_RELAY_PORT"] ?? String(DEFAULT_RELAY_PORT),
    10,
  );
  const devName = process.env["CODEHIVE_DEV_NAME"] ?? userInfo().username;
  const projectPath = resolve(process.env["CODEHIVE_PROJECT"] ?? process.cwd());
  const deviceId = generateDeviceId();

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
  // Build notification handler
  // -----------------------------------------------------------------------
  function handleServerEvent(msg: AnyServerMessage): void {
    switch (msg.type) {
      case "member_joined":
        state.pendingNotifications.push(
          `${msg.member.name} joined the room`,
        );
        break;

      case "member_left":
        state.pendingNotifications.push(
          `${msg.member.name} left the room`,
        );
        break;

      case "file_changed":
        state.pendingNotifications.push(
          `${msg.change.author} ${msg.change.type}d ${msg.change.path} (+${msg.change.linesAdded} -${msg.change.linesRemoved})`,
        );
        break;

      case "chat_received":
        state.pendingNotifications.push(
          `Message from ${msg.from}: ${msg.content}`,
        );
        break;

      case "conflict_warning":
        state.pendingNotifications.push(
          `CONFLICT WARNING: ${msg.message}`,
        );
        break;

      case "room_status":
        state.lastRoomInfo = msg.room;
        break;
    }

    // Keep notifications list bounded
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
  // Connect to relay (non-blocking — tools will wait if needed)
  // -----------------------------------------------------------------------
  try {
    await client.connect();
  } catch {
    // Relay might not be running yet; tools will report this to the user
    console.error(
      `[CodeHive MCP] relay not available at ${relayHost}:${relayPort}. Start it with: codehive relay`,
    );
  }

  // -----------------------------------------------------------------------
  // Build and start MCP server
  // -----------------------------------------------------------------------
  const server = new McpServer({
    name: "codehive",
    version: "1.0.0",
  });

  registerTools(server, state);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("[CodeHive MCP] server started");

  // -----------------------------------------------------------------------
  // Graceful shutdown
  // -----------------------------------------------------------------------
  process.on("SIGINT", () => shutdown(client, state));
  process.on("SIGTERM", () => shutdown(client, state));
}

function shutdown(client: RelayClient, state: ToolState): void {
  console.error("[CodeHive MCP] shutting down...");
  state.watcher?.stop();
  client.disconnect();
  process.exit(0);
}

export default main;

main().catch((err) => {
  console.error("[CodeHive MCP] fatal error:", err);
  process.exit(1);
});
