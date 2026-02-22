/**
 * CodeHive MCP Tool Definitions
 *
 * Registers all tools that Claude Code can call to interact with
 * the collaboration system. Each tool maps to a user intent like
 * "create a room", "see who's online", "send a message", etc.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AnyServerMessage, RoomInfo } from "../shared/types.js";
import { isValidRoomCode, formatTime } from "../shared/utils.js";
import type { RelayClient } from "./client.js";
import type { FileWatcher } from "../watcher/index.js";

/**
 * State container shared across all tools within a single session.
 */
export interface ToolState {
  client: RelayClient;
  watcher: FileWatcher | null;
  lastRoomInfo: RoomInfo | null;
  pendingNotifications: string[];
}

/**
 * Register all CodeHive tools on the given MCP server.
 */
export function registerTools(server: McpServer, state: ToolState): void {
  registerCreateRoom(server, state);
  registerJoinRoom(server, state);
  registerLeaveRoom(server, state);
  registerGetTeamStatus(server, state);
  registerGetRecentChanges(server, state);
  registerSendMessage(server, state);
  registerDeclareWorking(server, state);
  registerGetNotifications(server, state);
}

// ---------------------------------------------------------------------------
// create_room
// ---------------------------------------------------------------------------

function registerCreateRoom(server: McpServer, state: ToolState): void {
  server.tool(
    "create_room",
    "Create a new CodeHive collaboration room. Share the generated room code with your teammates so they can join.",
    {},
    async () => {
      if (state.client.roomCode) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Already in room ${state.client.roomCode}. Leave the current room first with leave_room.`,
            },
          ],
        };
      }

      const roomInfo = await waitForRoomEvent(state, () => {
        state.client.createRoom();
      });

      if (!roomInfo) {
        return {
          content: [
            { type: "text" as const, text: "Failed to create room. Is the relay server running?" },
          ],
        };
      }

      if (state.watcher) {
        await state.watcher.start();
      }

      return {
        content: [
          {
            type: "text" as const,
            text: [
              `Room created successfully!`,
              ``,
              `Room code: ${roomInfo.code}`,
              ``,
              `Share this code with your teammates. They can join with:`,
              `  "Join CodeHive room ${roomInfo.code}"`,
              ``,
              `File watching is active. Your teammates will see your changes in real-time.`,
            ].join("\n"),
          },
        ],
      };
    },
  );
}

// ---------------------------------------------------------------------------
// join_room
// ---------------------------------------------------------------------------

function registerJoinRoom(server: McpServer, state: ToolState): void {
  server.tool(
    "join_room",
    "Join an existing CodeHive collaboration room using a room code shared by a teammate.",
    { code: z.string().describe("The room code to join (e.g. HIVE-A3K7)") },
    async ({ code }) => {
      const normalized = code.toUpperCase().trim();

      if (!isValidRoomCode(normalized)) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Invalid room code "${code}". Expected format: HIVE-XXXX (e.g. HIVE-A3K7).`,
            },
          ],
        };
      }

      if (state.client.roomCode) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Already in room ${state.client.roomCode}. Leave the current room first.`,
            },
          ],
        };
      }

      const roomInfo = await waitForRoomEvent(state, () => {
        state.client.joinRoom(normalized);
      });

      if (!roomInfo) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to join room ${normalized}. The room may not exist or the relay is unreachable.`,
            },
          ],
        };
      }

      if (state.watcher) {
        await state.watcher.start();
      }

      const memberList = roomInfo.members
        .map((m) => `  - ${m.name} (${m.status})`)
        .join("\n");

      return {
        content: [
          {
            type: "text" as const,
            text: [
              `Joined room ${roomInfo.code} successfully!`,
              ``,
              `Team members:`,
              memberList,
              ``,
              `File watching is active. You'll be notified of teammates' changes.`,
            ].join("\n"),
          },
        ],
      };
    },
  );
}

// ---------------------------------------------------------------------------
// leave_room
// ---------------------------------------------------------------------------

function registerLeaveRoom(server: McpServer, state: ToolState): void {
  server.tool(
    "leave_room",
    "Leave the current CodeHive collaboration room.",
    {},
    async () => {
      if (!state.client.roomCode) {
        return {
          content: [
            { type: "text" as const, text: "Not currently in any room." },
          ],
        };
      }

      const code = state.client.roomCode;
      state.client.leaveRoom();

      if (state.watcher) {
        await state.watcher.stop();
      }

      state.lastRoomInfo = null;
      state.pendingNotifications = [];

      return {
        content: [
          { type: "text" as const, text: `Left room ${code}. File watching stopped.` },
        ],
      };
    },
  );
}

// ---------------------------------------------------------------------------
// get_team_status
// ---------------------------------------------------------------------------

function registerGetTeamStatus(server: McpServer, state: ToolState): void {
  server.tool(
    "get_team_status",
    "See who is connected to the current room, their status, and what files they are working on.",
    {},
    async () => {
      if (!state.client.roomCode) {
        return {
          content: [
            { type: "text" as const, text: "Not in a room. Create or join one first." },
          ],
        };
      }

      const roomInfo = await waitForStatusEvent(state);

      if (!roomInfo) {
        return {
          content: [
            { type: "text" as const, text: "Could not retrieve room status." },
          ],
        };
      }

      const lines: string[] = [
        `Room: ${roomInfo.code}`,
        `Members: ${roomInfo.members.length}`,
        ``,
      ];

      for (const member of roomInfo.members) {
        const files =
          member.workingOn.length > 0
            ? member.workingOn.join(", ")
            : "none declared";
        const lastSeen = formatTime(member.lastSeen);
        lines.push(`  ${member.name}`);
        lines.push(`    Status: ${member.status}`);
        lines.push(`    Working on: ${files}`);
        lines.push(`    Last seen: ${lastSeen}`);
        lines.push(``);
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    },
  );
}

// ---------------------------------------------------------------------------
// get_recent_changes
// ---------------------------------------------------------------------------

function registerGetRecentChanges(server: McpServer, state: ToolState): void {
  server.tool(
    "get_recent_changes",
    "View recent file changes made by teammates in the current room.",
    {},
    async () => {
      if (!state.client.roomCode) {
        return {
          content: [
            { type: "text" as const, text: "Not in a room. Create or join one first." },
          ],
        };
      }

      const roomInfo = await waitForStatusEvent(state);

      if (!roomInfo || roomInfo.recentChanges.length === 0) {
        return {
          content: [
            { type: "text" as const, text: "No recent changes from teammates." },
          ],
        };
      }

      const lines: string[] = ["Recent changes:"];

      for (const change of roomInfo.recentChanges.slice(-15)) {
        const time = formatTime(change.timestamp);
        const stats = `+${change.linesAdded} -${change.linesRemoved}`;
        lines.push(`  [${time}] ${change.author} ${change.type} ${change.path} (${stats})`);

        if (change.diff) {
          const diffLines = change.diff.split("\n").slice(0, 5);
          for (const dl of diffLines) {
            lines.push(`    ${dl}`);
          }
          if (change.diff.split("\n").length > 5) {
            lines.push(`    ... (truncated)`);
          }
        }
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    },
  );
}

// ---------------------------------------------------------------------------
// send_message
// ---------------------------------------------------------------------------

function registerSendMessage(server: McpServer, state: ToolState): void {
  server.tool(
    "send_message",
    "Send a chat message to all teammates in the current room.",
    {
      message: z.string().describe("The message to send to your teammates"),
    },
    async ({ message }) => {
      if (!state.client.roomCode) {
        return {
          content: [
            { type: "text" as const, text: "Not in a room. Create or join one first." },
          ],
        };
      }

      state.client.sendChatMessage(message);

      return {
        content: [
          {
            type: "text" as const,
            text: `Message sent to room ${state.client.roomCode}: "${message}"`,
          },
        ],
      };
    },
  );
}

// ---------------------------------------------------------------------------
// declare_working
// ---------------------------------------------------------------------------

function registerDeclareWorking(server: McpServer, state: ToolState): void {
  server.tool(
    "declare_working",
    "Declare which files you are currently working on. Teammates will be warned if they try to edit the same files.",
    {
      files: z
        .string()
        .describe(
          "Comma-separated list of file paths relative to project root (e.g. src/auth.ts, src/api.ts)",
        ),
    },
    async ({ files }) => {
      if (!state.client.roomCode) {
        return {
          content: [
            { type: "text" as const, text: "Not in a room. Create or join one first." },
          ],
        };
      }

      const fileList = files
        .split(",")
        .map((f) => f.trim())
        .filter(Boolean);

      state.client.declareWorkingOn(fileList);

      return {
        content: [
          {
            type: "text" as const,
            text: `Declared working on: ${fileList.join(", ")}. Teammates will be notified.`,
          },
        ],
      };
    },
  );
}

// ---------------------------------------------------------------------------
// get_notifications
// ---------------------------------------------------------------------------

function registerGetNotifications(server: McpServer, state: ToolState): void {
  server.tool(
    "get_notifications",
    "Check for unread notifications from teammates (file changes, messages, conflict warnings).",
    {},
    async () => {
      if (state.pendingNotifications.length === 0) {
        return {
          content: [
            { type: "text" as const, text: "No new notifications." },
          ],
        };
      }

      const notifications = [...state.pendingNotifications];
      state.pendingNotifications = [];

      return {
        content: [
          {
            type: "text" as const,
            text: [
              `${notifications.length} notification(s):`,
              ``,
              ...notifications.map((n, i) => `  ${i + 1}. ${n}`),
            ].join("\n"),
          },
        ],
      };
    },
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Wait for a room creation or join event from the relay, with timeout.
 */
function waitForRoomEvent(
  state: ToolState,
  trigger: () => void,
): Promise<RoomInfo | null> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve(null);
    }, 10_000);

    const originalHandler = state.client["onMessage"];

    state.client["onMessage"] = (msg: AnyServerMessage) => {
      originalHandler(msg);

      if (msg.type === "room_created" || msg.type === "room_joined") {
        clearTimeout(timeout);
        state.lastRoomInfo = msg.room;
        state.client["onMessage"] = originalHandler;
        resolve(msg.room);
      }

      if (msg.type === "error") {
        clearTimeout(timeout);
        state.client["onMessage"] = originalHandler;
        resolve(null);
      }
    };

    trigger();
  });
}

/**
 * Request and wait for a status update from the relay.
 */
function waitForStatusEvent(state: ToolState): Promise<RoomInfo | null> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve(state.lastRoomInfo);
    }, 5_000);

    const originalHandler = state.client["onMessage"];

    state.client["onMessage"] = (msg: AnyServerMessage) => {
      originalHandler(msg);

      if (msg.type === "room_status") {
        clearTimeout(timeout);
        state.lastRoomInfo = msg.room;
        state.client["onMessage"] = originalHandler;
        resolve(msg.room);
      }
    };

    state.client.requestStatus();
  });
}
