/**
 * CodeHive MCP Tool Definitions
 *
 * Registers all MCP tools that AI editors (Claude Code, Cursor,
 * Windsurf, VS Code + Copilot) can call to interact with the
 * collaboration system.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { RoomInfo, RoomSummary, TimelineEvent, SharedTerminal } from "../shared/types.js";
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
 * Register all CodeHive tools and resources on the given MCP server.
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
  registerLockFile(server, state);
  registerUnlockFile(server, state);
  registerGetTimeline(server, state);
  registerShareTerminal(server, state);
  registerBrowseRooms(server, state);
  registerSetWebhook(server, state);
  registerResources(server, state);
}

// ---------------------------------------------------------------------------
// MCP Resources — subscribable live data
// ---------------------------------------------------------------------------

function registerResources(server: McpServer, state: ToolState): void {
  server.resource(
    "room-status",
    "codehive://room/status",
    { description: "Current room status including members, recent changes, locks, and notifications" },
    async () => {
      if (!state.client.roomCode || !state.lastRoomInfo) {
        return {
          contents: [{
            uri: "codehive://room/status",
            mimeType: "application/json",
            text: JSON.stringify({ connected: false, room: null }),
          }],
        };
      }

      return {
        contents: [{
          uri: "codehive://room/status",
          mimeType: "application/json",
          text: JSON.stringify({
            connected: true,
            room: state.lastRoomInfo,
            pendingNotifications: state.pendingNotifications.length,
          }),
        }],
      };
    },
  );

  server.resource(
    "notifications",
    "codehive://notifications",
    { description: "Unread notifications from teammates" },
    async () => {
      return {
        contents: [{
          uri: "codehive://notifications",
          mimeType: "application/json",
          text: JSON.stringify({
            count: state.pendingNotifications.length,
            notifications: state.pendingNotifications,
          }),
        }],
      };
    },
  );
}

// ---------------------------------------------------------------------------
// create_room
// ---------------------------------------------------------------------------

function registerCreateRoom(server: McpServer, state: ToolState): void {
  server.tool(
    "create_room",
    "Create a new CodeHive collaboration room. Optionally set a password, make it public for discovery, or set an expiry time.",
    {
      password: z.string().optional().describe("Optional password to protect the room"),
      is_public: z.boolean().optional().describe("Make the room discoverable by other developers (default: false)"),
      expires_in_hours: z.number().optional().describe("Auto-delete the room after this many hours of inactivity (0 = never)"),
    },
    async ({ password, is_public, expires_in_hours }) => {
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

      const result = await waitForRoomCreatedEvent(state, () => {
        state.client.createRoom(password, is_public, expires_in_hours);
      });

      if (!result) {
        return {
          content: [
            { type: "text" as const, text: "Failed to create room. Is the relay server running?" },
          ],
        };
      }

      if (state.watcher) {
        await state.watcher.start();
      }

      const { roomInfo, inviteLink } = result;

      return {
        content: [
          {
            type: "text" as const,
            text: [
              `Room created successfully!`,
              ``,
              `Room code: ${roomInfo.code}`,
              password ? `Password protected: yes` : ``,
              roomInfo.isPublic ? `Visibility: PUBLIC (discoverable)` : `Visibility: PRIVATE`,
              roomInfo.expiresInHours > 0 ? `Expires: after ${roomInfo.expiresInHours}h of inactivity` : ``,
              inviteLink ? `Invite link: ${inviteLink}` : ``,
              ``,
              `Share the room code${password ? " and password" : ""} with your teammates.`,
              `They can join with:`,
              `  "Join CodeHive room ${roomInfo.code}"`,
              ``,
              `File watching is active. Your teammates will see your changes in real-time.`,
            ].filter(Boolean).join("\n"),
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
    {
      code: z.string().describe("The room code to join (e.g. HIVE-A3K7XY)"),
      password: z.string().optional().describe("Room password if the room is protected"),
    },
    async ({ code, password }) => {
      const normalized = code.toUpperCase().trim();

      if (!isValidRoomCode(normalized)) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Invalid room code "${code}". Expected format: HIVE-XXXXXX (e.g. HIVE-A3K7XY).`,
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

      const roomInfo = await waitForRoomJoinEvent(state, () => {
        state.client.joinRoom(normalized, password);
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
        .map((m) => {
          const branch = m.branch ? ` [${m.branch}]` : "";
          return `  - ${m.name} (${m.status})${branch}`;
        })
        .join("\n");

      const lockList = roomInfo.locks.length > 0
        ? `\nLocked files:\n` + roomInfo.locks.map((l) => `  - ${l.file} (by ${l.lockedBy})`).join("\n")
        : "";

      return {
        content: [
          {
            type: "text" as const,
            text: [
              `Joined room ${roomInfo.code} successfully!`,
              ``,
              `Team members:`,
              memberList,
              lockList,
              ``,
              `File watching is active. You'll be notified of teammates' changes.`,
              ``,
              `TIP: Use "check CodeHive notifications" to see updates from teammates.`,
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
    "See who is connected to the current room, their status, git branch, and what files they are working on. Call this before editing files to avoid conflicts with teammates.",
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
        roomInfo.isPublic ? `Visibility: PUBLIC` : `Visibility: PRIVATE`,
        ``,
      ];

      for (const member of roomInfo.members) {
        const files =
          member.workingOn.length > 0
            ? member.workingOn.join(", ")
            : "none declared";
        const lastSeen = formatTime(member.lastSeen);
        const branch = member.branch ? ` [${member.branch}]` : "";
        const typing = member.typingIn ? ` (typing in ${member.typingIn})` : "";
        lines.push(`  ${member.name}${branch}${typing}`);
        lines.push(`    Status: ${member.status}`);
        lines.push(`    Working on: ${files}`);
        lines.push(`    Last seen: ${lastSeen}`);
        if (member.cursor) {
          lines.push(`    Cursor: ${member.cursor.file}:${member.cursor.line}:${member.cursor.column}`);
        }
        lines.push(``);
      }

      if (roomInfo.locks.length > 0) {
        lines.push(`Locked files:`);
        for (const lock of roomInfo.locks) {
          lines.push(`  - ${lock.file} (by ${lock.lockedBy} at ${formatTime(lock.lockedAt)})`);
        }
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
        const isBinary = change.sizeAfter !== undefined && change.sizeAfter !== null;
        const stats = isBinary
          ? `${Math.round((change.sizeAfter as number) / 1024)}KB`
          : `+${change.linesAdded} -${change.linesRemoved}`;
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

      if (message.length > 10_000) {
        return {
          content: [
            { type: "text" as const, text: "Message too long (max 10,000 characters)." },
          ],
        };
      }

      state.client.sendChatMessage(message);

      return {
        content: [
          {
            type: "text" as const,
            text: `Message sent to room ${state.client.roomCode}: "${message}"\n\nTeammates will see it when they check notifications.`,
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
    "Declare which files you are about to edit. ALWAYS call this before modifying any file so teammates get conflict warnings if they touch the same files.",
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
    "IMPORTANT: Call this tool BEFORE starting any coding task to check for teammate updates. Shows unread notifications: file changes, chat messages, conflict warnings, lock events, and branch warnings.",
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
// lock_file
// ---------------------------------------------------------------------------

function registerLockFile(server: McpServer, state: ToolState): void {
  server.tool(
    "lock_file",
    "Lock a file so only you can edit it. Other teammates will be warned if they try to modify a locked file. Use this for critical files to prevent conflicts.",
    {
      file: z.string().describe("File path relative to project root (e.g. src/config.ts)"),
    },
    async ({ file }) => {
      if (!state.client.roomCode) {
        return {
          content: [
            { type: "text" as const, text: "Not in a room. Create or join one first." },
          ],
        };
      }

      state.client.lockFile(file.trim());

      // Wait for lock confirmation or error
      const result = await waitForLockEvent(state, file.trim());

      return {
        content: [
          { type: "text" as const, text: result },
        ],
      };
    },
  );
}

// ---------------------------------------------------------------------------
// unlock_file
// ---------------------------------------------------------------------------

function registerUnlockFile(server: McpServer, state: ToolState): void {
  server.tool(
    "unlock_file",
    "Unlock a file you previously locked, allowing teammates to edit it again.",
    {
      file: z.string().describe("File path to unlock (e.g. src/config.ts)"),
    },
    async ({ file }) => {
      if (!state.client.roomCode) {
        return {
          content: [
            { type: "text" as const, text: "Not in a room. Create or join one first." },
          ],
        };
      }

      state.client.unlockFile(file.trim());

      return {
        content: [
          { type: "text" as const, text: `Unlocked ${file.trim()}. Teammates can now edit it.` },
        ],
      };
    },
  );
}

// ---------------------------------------------------------------------------
// get_timeline
// ---------------------------------------------------------------------------

function registerGetTimeline(server: McpServer, state: ToolState): void {
  server.tool(
    "get_timeline",
    "View the activity timeline for the current room. Shows all events: joins, leaves, file changes, chat messages, locks, and branch changes in chronological order.",
    {
      limit: z.number().optional().describe("Number of events to show (default: 30)"),
    },
    async ({ limit }) => {
      if (!state.client.roomCode) {
        return {
          content: [
            { type: "text" as const, text: "Not in a room. Create or join one first." },
          ],
        };
      }

      const events = await waitForTimelineEvent(state, limit ?? 30);

      if (!events || events.length === 0) {
        return {
          content: [
            { type: "text" as const, text: "No activity in the timeline yet." },
          ],
        };
      }

      const lines: string[] = ["Activity timeline:"];
      for (const event of events) {
        const time = formatTime(event.timestamp);
        const icon = getTimelineIcon(event.type);
        lines.push(`  ${icon} [${time}] ${event.detail}`);
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    },
  );
}

function getTimelineIcon(type: TimelineEvent["type"]): string {
  switch (type) {
    case "join": return "+";
    case "leave": return "-";
    case "chat": return ">";
    case "file_change": return "~";
    case "lock": return "#";
    case "unlock": return ".";
    case "conflict": return "!";
    case "branch_change": return "*";
    default: return " ";
  }
}

// ---------------------------------------------------------------------------
// share_terminal
// ---------------------------------------------------------------------------

function registerShareTerminal(server: McpServer, state: ToolState): void {
  server.tool(
    "share_terminal",
    "Share terminal command output with your teammates. Useful for sharing test results, build output, or debugging information.",
    {
      command: z.string().describe("The command that was run"),
      output: z.string().describe("The terminal output to share"),
      exit_code: z.number().optional().describe("The exit code of the command"),
    },
    async ({ command, output, exit_code }) => {
      if (!state.client.roomCode) {
        return {
          content: [
            { type: "text" as const, text: "Not in a room. Create or join one first." },
          ],
        };
      }

      if (output.length > 50_000) {
        return {
          content: [
            { type: "text" as const, text: "Output too large (max 50,000 characters). Truncate before sharing." },
          ],
        };
      }

      const terminal: SharedTerminal = {
        command,
        output,
        exitCode: exit_code ?? null,
        cwd: state.client.projectPath,
        sharedBy: state.client.devName,
        timestamp: Date.now(),
      };

      state.client.shareTerminal(terminal);

      return {
        content: [
          {
            type: "text" as const,
            text: `Shared terminal output with teammates: \`${command}\` (${output.length} chars)`,
          },
        ],
      };
    },
  );
}

// ---------------------------------------------------------------------------
// browse_rooms
// ---------------------------------------------------------------------------

function registerBrowseRooms(server: McpServer, state: ToolState): void {
  server.tool(
    "browse_rooms",
    "Browse public CodeHive rooms available on the relay server. Only shows rooms that have been made public by their creators.",
    {},
    async () => {
      const rooms = await waitForRoomListEvent(state);

      if (!rooms || rooms.length === 0) {
        return {
          content: [
            { type: "text" as const, text: "No public rooms available." },
          ],
        };
      }

      const lines: string[] = [`${rooms.length} public room(s) found:`, ``];
      for (const room of rooms) {
        const lock = room.hasPassword ? " [password protected]" : "";
        lines.push(`  ${room.code} — ${room.memberCount} member(s)${lock}`);
        lines.push(`    Created by: ${room.createdBy}`);
        lines.push(`    Members: ${room.memberNames.join(", ")}`);
        lines.push(``);
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    },
  );
}

// ---------------------------------------------------------------------------
// set_webhook
// ---------------------------------------------------------------------------

function registerSetWebhook(server: McpServer, state: ToolState): void {
  server.tool(
    "set_webhook",
    "Configure a webhook URL to receive notifications for room events. Events will be POSTed as JSON. Set to empty to remove.",
    {
      url: z.string().describe("Webhook URL to POST events to (Slack, Discord, or custom). Empty string to remove."),
      events: z.string().optional().describe("Comma-separated list of events: all, join, leave, chat, file_change, conflict (default: all)"),
    },
    async ({ url, events }) => {
      if (!state.client.roomCode) {
        return {
          content: [
            { type: "text" as const, text: "Not in a room. Create or join one first." },
          ],
        };
      }

      if (!url) {
        state.client.setWebhook(null);
        return {
          content: [
            { type: "text" as const, text: "Webhook removed." },
          ],
        };
      }

      const eventList = (events || "all").split(",").map((e) => e.trim()).filter(Boolean);

      state.client.setWebhook({ url, events: eventList });

      return {
        content: [
          {
            type: "text" as const,
            text: `Webhook configured: ${url}\nEvents: ${eventList.join(", ")}`,
          },
        ],
      };
    },
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function waitForRoomCreatedEvent(
  state: ToolState,
  trigger: () => void,
): Promise<{ roomInfo: RoomInfo; inviteLink: string } | null> {
  return new Promise((resolve) => {
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      unsub();
      resolve(null);
    }, 10_000);

    const unsub = state.client.onceMessage(
      (msg) =>
        msg.type === "room_created" ||
        msg.type === "error",
      (msg) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);

        if (msg.type === "room_created") {
          const created = msg as { room: RoomInfo; inviteLink: string };
          state.lastRoomInfo = created.room;
          resolve({ roomInfo: created.room, inviteLink: created.inviteLink });
        } else {
          resolve(null);
        }
      },
    );

    trigger();
  });
}

function waitForRoomJoinEvent(
  state: ToolState,
  trigger: () => void,
): Promise<RoomInfo | null> {
  return new Promise((resolve) => {
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      unsub();
      resolve(null);
    }, 10_000);

    const unsub = state.client.onceMessage(
      (msg) =>
        msg.type === "room_joined" ||
        msg.type === "error",
      (msg) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);

        if (msg.type === "room_joined") {
          state.lastRoomInfo = (msg as { room: RoomInfo }).room;
          resolve((msg as { room: RoomInfo }).room);
        } else {
          resolve(null);
        }
      },
    );

    trigger();
  });
}

function waitForStatusEvent(state: ToolState): Promise<RoomInfo | null> {
  return new Promise((resolve) => {
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      unsub();
      if (state.lastRoomInfo) {
        resolve(state.lastRoomInfo);
      } else {
        resolve(null);
      }
    }, 5_000);

    const unsub = state.client.onceMessage(
      (msg) => msg.type === "room_status",
      (msg) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        state.lastRoomInfo = (msg as { room: RoomInfo }).room;
        resolve((msg as { room: RoomInfo }).room);
      },
    );

    state.client.requestStatus();
  });
}

function waitForLockEvent(state: ToolState, file: string): Promise<string> {
  return new Promise((resolve) => {
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      unsub();
      resolve(`Lock request sent for ${file}.`);
    }, 5_000);

    const unsub = state.client.onceMessage(
      (msg) =>
        (msg.type === "file_locked" && (msg as { lock: { file: string } }).lock.file === file) ||
        (msg.type === "lock_error" && (msg as { file: string }).file === file),
      (msg) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);

        if (msg.type === "file_locked") {
          resolve(`Locked ${file}. Only you can edit it now. Use unlock_file when done.`);
        } else {
          const err = msg as { error: string; lockedBy: string };
          resolve(`Cannot lock ${file}: ${err.error}`);
        }
      },
    );
  });
}

function waitForTimelineEvent(state: ToolState, limit: number): Promise<TimelineEvent[] | null> {
  return new Promise((resolve) => {
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      unsub();
      // Fallback to cached timeline
      if (state.lastRoomInfo?.timeline) {
        resolve(state.lastRoomInfo.timeline);
      } else {
        resolve(null);
      }
    }, 5_000);

    const unsub = state.client.onceMessage(
      (msg) => msg.type === "timeline",
      (msg) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve((msg as { events: TimelineEvent[] }).events);
      },
    );

    state.client.getTimeline(limit);
  });
}

function waitForRoomListEvent(state: ToolState): Promise<RoomSummary[] | null> {
  return new Promise((resolve) => {
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      unsub();
      resolve(null);
    }, 5_000);

    const unsub = state.client.onceMessage(
      (msg) => msg.type === "room_list",
      (msg) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve((msg as { rooms: RoomSummary[] }).rooms);
      },
    );

    state.client.listRooms();
  });
}
