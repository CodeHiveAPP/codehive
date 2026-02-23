/**
 * CodeHive Relay Server
 *
 * A lightweight WebSocket relay that routes messages between developers
 * in the same collaboration room. The relay does not store file contents;
 * it only forwards metadata, diffs, and notifications.
 *
 * Usage:
 *   codehive relay --port 4819
 *   codehive relay --host 0.0.0.0 --port 4819
 */

import { WebSocketServer, type WebSocket } from "ws";
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import {
  CloseCodes,
  buildInviteLink,
  decodeClientMessage,
  DEFAULT_RELAY_HOST,
  DEFAULT_RELAY_PORT,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  MAX_TERMINAL_OUTPUT,
  ROOM_EXPIRY_CHECK_MS,
} from "../shared/protocol.js";
import type {
  AnyClientMessage,
  AnyServerMessage,
  DeviceId,
  WebhookConfig,
} from "../shared/types.js";
import { generateRoomCode, now } from "../shared/utils.js";
import { RoomManager, Room } from "./room.js";

interface RelayOptions {
  host?: string;
  port?: number;
  persistPath?: string;
}

interface ClientState {
  deviceId: DeviceId | null;
  roomCode: string | null;
}

const clientStates = new WeakMap<WebSocket, ClientState>();

/**
 * Start the CodeHive relay server.
 */
export function startRelayServer(options: RelayOptions = {}): WebSocketServer {
  const host = options.host ?? DEFAULT_RELAY_HOST;
  const port = options.port ?? DEFAULT_RELAY_PORT;

  const rooms = new RoomManager();
  const wss = new WebSocketServer({ host, port, maxPayload: 1024 * 1024 }); // 1 MB limit

  wss.on("error", (err) => {
    console.error(`[CodeHive Relay] server error: ${err.message}`);
  });

  console.log(`[CodeHive Relay] listening on ws://${host}:${port}`);
  console.log(`[CodeHive Relay] waiting for connections...`);

  // -----------------------------------------------------------------------
  // Room persistence — save rooms to disk periodically
  // -----------------------------------------------------------------------
  const persistPath = options.persistPath ?? join(process.cwd(), ".codehive-rooms.json");

  async function saveRooms(): Promise<void> {
    try {
      await mkdir(dirname(persistPath), { recursive: true });
      await writeFile(persistPath, JSON.stringify(rooms.toJSON(), null, 2));
    } catch {
      // Non-critical — persistence is best-effort
    }
  }

  // Load persisted rooms on startup
  void (async () => {
    try {
      const data = await readFile(persistPath, "utf-8");
      const saved = JSON.parse(data) as Array<{ code: string; createdBy: string; password?: string; isPublic?: boolean; expiresInHours?: number }>;
      for (const r of saved) {
        if (!rooms.hasRoom(r.code)) {
          rooms.createRoom(r.code, r.createdBy, r.password, r.isPublic ?? false, r.expiresInHours ?? 0);
          console.log(`[CodeHive Relay] restored room ${r.code}`);
        }
      }
    } catch {
      // No saved rooms — normal on first run
    }
  })();

  // Save periodically
  const persistInterval = setInterval(() => {
    void saveRooms();
  }, 60_000);

  // -----------------------------------------------------------------------
  // Heartbeat: detect and clean up dead connections
  // -----------------------------------------------------------------------
  const heartbeatInterval = setInterval(() => {
    for (const [code, room] of rooms) {
      const dead = room.findDeadClients(HEARTBEAT_TIMEOUT_MS);
      for (const deviceId of dead) {
        const member = room.removeMember(deviceId);
        if (member) {
          console.log(`[CodeHive Relay] timeout: ${member.name} in ${code}`);
          room.broadcast({
            type: "member_left",
            code,
            member,
            timestamp: now(),
          });
        }
      }
    }
    rooms.pruneEmptyRooms();
  }, HEARTBEAT_INTERVAL_MS);

  // -----------------------------------------------------------------------
  // Room expiry: delete inactive rooms
  // -----------------------------------------------------------------------
  const expiryInterval = setInterval(() => {
    rooms.pruneExpiredRooms();
  }, ROOM_EXPIRY_CHECK_MS);

  wss.on("close", () => {
    clearInterval(heartbeatInterval);
    clearInterval(expiryInterval);
    clearInterval(persistInterval);
    void saveRooms();
    console.log("[CodeHive Relay] server closed");
  });

  // -----------------------------------------------------------------------
  // Connection handler
  // -----------------------------------------------------------------------
  wss.on("connection", (ws: WebSocket) => {
    const state: ClientState = { deviceId: null, roomCode: null };
    clientStates.set(ws, state);

    ws.on("error", (err) => {
      console.error("[CodeHive Relay] client error:", err.message);
    });

    ws.on("close", () => {
      handleDisconnect(ws, state, rooms);
    });

    ws.on("message", (raw) => {
      const data = typeof raw === "string" ? raw : raw.toString("utf-8");
      const msg = decodeClientMessage(data);

      if (!msg) {
        sendError(ws, "Invalid message format");
        return;
      }

      state.deviceId = msg.deviceId;
      handleMessage(ws, state, msg, rooms, host, port);
    });
  });

  return wss;
}

// ---------------------------------------------------------------------------
// Webhook helper
// ---------------------------------------------------------------------------

async function fireWebhook(room: Room, eventType: string, payload: Record<string, unknown>): Promise<void> {
  if (!room.webhook) return;
  const wh = room.webhook;
  if (!wh.events.includes("all") && !wh.events.includes(eventType)) return;

  try {
    await fetch(wh.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: eventType, room: room.code, timestamp: now(), ...payload }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Webhook delivery is best-effort
  }
}

// ---------------------------------------------------------------------------
// Message dispatcher
// ---------------------------------------------------------------------------

function handleMessage(
  ws: WebSocket,
  state: ClientState,
  msg: AnyClientMessage,
  rooms: RoomManager,
  host: string,
  port: number,
): void {
  switch (msg.type) {
    case "create_room":
      handleCreateRoom(ws, state, msg, rooms, host, port);
      break;
    case "join_room":
      handleJoinRoom(ws, state, msg, rooms);
      break;
    case "leave_room":
      handleLeaveRoom(ws, state, msg, rooms);
      break;
    case "heartbeat":
      handleHeartbeat(ws, state, msg, rooms);
      break;
    case "file_change":
      handleFileChange(ws, state, msg, rooms);
      break;
    case "declare_working":
      handleDeclareWorking(ws, state, msg, rooms);
      break;
    case "chat_message":
      handleChatMessage(ws, state, msg, rooms);
      break;
    case "request_status":
      handleRequestStatus(ws, state, msg, rooms);
      break;
    case "sync_request":
      handleSyncRequest(ws, state, msg, rooms);
      break;
    case "declare_typing":
      handleDeclareTyping(ws, state, msg, rooms);
      break;
    case "lock_file":
      handleLockFile(ws, state, msg, rooms);
      break;
    case "unlock_file":
      handleUnlockFile(ws, state, msg, rooms);
      break;
    case "update_cursor":
      handleUpdateCursor(ws, state, msg, rooms);
      break;
    case "share_terminal":
      handleShareTerminal(ws, state, msg, rooms);
      break;
    case "list_rooms":
      handleListRooms(ws, state, msg, rooms);
      break;
    case "get_timeline":
      handleGetTimeline(ws, state, msg, rooms);
      break;
    case "set_webhook":
      handleSetWebhook(ws, state, msg, rooms);
      break;
    case "set_room_visibility":
      handleSetRoomVisibility(ws, state, msg, rooms);
      break;
  }
}

// ---------------------------------------------------------------------------
// Individual message handlers
// ---------------------------------------------------------------------------

function handleCreateRoom(
  ws: WebSocket,
  state: ClientState,
  msg: Extract<AnyClientMessage, { type: "create_room" }>,
  rooms: RoomManager,
  host: string,
  port: number,
): void {
  if (!msg.name || msg.name.length > 50) {
    sendError(ws, "Name must be 1–50 characters");
    return;
  }

  let code = generateRoomCode();
  let attempts = 0;
  while (rooms.hasRoom(code) && attempts < 50) {
    code = generateRoomCode();
    attempts++;
  }

  if (rooms.hasRoom(code)) {
    sendError(ws, "Unable to generate unique room code, try again");
    return;
  }

  const room = rooms.createRoom(code, msg.name, msg.password, msg.isPublic ?? false, msg.expiresInHours ?? 0);
  const err = room.addMember(msg.deviceId, msg.name, ws, msg.branch);
  if (err) {
    rooms.deleteRoom(code);
    sendError(ws, err);
    return;
  }

  state.roomCode = code;

  console.log(`[CodeHive Relay] room ${code} created by ${msg.name}`);

  const inviteLink = buildInviteLink(host, port, code, msg.password);

  sendMessage(ws, {
    type: "room_created",
    room: room.toRoomInfo(),
    inviteLink,
    timestamp: now(),
  });
}

function handleJoinRoom(
  ws: WebSocket,
  state: ClientState,
  msg: Extract<AnyClientMessage, { type: "join_room" }>,
  rooms: RoomManager,
): void {
  if (!msg.name || msg.name.length > 50) {
    sendError(ws, "Name must be 1–50 characters");
    return;
  }

  const room = rooms.getRoom(msg.code);
  if (!room) {
    sendError(ws, `Room ${msg.code} not found`);
    return;
  }

  if (!room.checkPassword(msg.password)) {
    sendError(ws, `Wrong password for room ${msg.code}`);
    return;
  }

  const err = room.addMember(msg.deviceId, msg.name, ws, msg.branch);
  if (err) {
    sendError(ws, err);
    return;
  }

  state.roomCode = msg.code;

  console.log(`[CodeHive Relay] ${msg.name} joined ${msg.code}`);

  sendMessage(ws, {
    type: "room_joined",
    room: room.toRoomInfo(),
    timestamp: now(),
  });

  const member = room.getMember(msg.deviceId);
  if (member) {
    room.broadcast(
      {
        type: "member_joined",
        code: msg.code,
        member,
        timestamp: now(),
      },
      msg.deviceId,
    );

    // Check branch divergence
    const branchCheck = room.checkBranchDivergence();
    if (branchCheck.diverged) {
      room.broadcast({
        type: "branch_warning",
        code: msg.code,
        message: branchCheck.message,
        branches: branchCheck.branches,
        timestamp: now(),
      });
    }
  }

  void fireWebhook(room, "join", { member: msg.name });
}

function handleLeaveRoom(
  ws: WebSocket,
  state: ClientState,
  msg: Extract<AnyClientMessage, { type: "leave_room" }>,
  rooms: RoomManager,
): void {
  const room = rooms.getRoom(msg.code);
  if (!room) return;

  const member = room.removeMember(msg.deviceId);
  state.roomCode = null;

  if (member) {
    console.log(`[CodeHive Relay] ${member.name} left ${msg.code}`);

    room.broadcast({
      type: "member_left",
      code: msg.code,
      member,
      timestamp: now(),
    });

    void fireWebhook(room, "leave", { member: member.name });
  }

  sendMessage(ws, {
    type: "room_left",
    code: msg.code,
    timestamp: now(),
  });

  if (room.isEmpty) {
    rooms.deleteRoom(msg.code);
    console.log(`[CodeHive Relay] room ${msg.code} deleted (empty)`);
  }
}

function handleHeartbeat(
  ws: WebSocket,
  _state: ClientState,
  msg: Extract<AnyClientMessage, { type: "heartbeat" }>,
  rooms: RoomManager,
): void {
  const room = rooms.getRoom(msg.code);
  if (!room) return;

  const oldBranch = room.getMember(msg.deviceId)?.branch;
  room.updateHeartbeat(msg.deviceId, msg.status, msg.branch);

  // Check for branch change
  if (msg.branch && oldBranch && msg.branch !== oldBranch) {
    const branchCheck = room.checkBranchDivergence();
    if (branchCheck.diverged) {
      room.broadcast({
        type: "branch_warning",
        code: msg.code,
        message: branchCheck.message,
        branches: branchCheck.branches,
        timestamp: now(),
      });
    }
  }

  sendMessage(ws, {
    type: "heartbeat_ack",
    code: msg.code,
    timestamp: now(),
  });
}

function handleFileChange(
  ws: WebSocket,
  _state: ClientState,
  msg: Extract<AnyClientMessage, { type: "file_change" }>,
  rooms: RoomManager,
): void {
  const room = rooms.getRoom(msg.code);
  if (!room) return;

  // Check if file is locked by someone else
  const lock = room.getFileLock(msg.change.path);
  if (lock && lock.deviceId !== msg.deviceId) {
    sendError(ws, `File "${msg.change.path}" is locked by ${lock.lockedBy}`);
    return;
  }

  const conflictingDevs = room.recordFileChange(msg.change);

  room.broadcast(
    {
      type: "file_changed",
      code: msg.code,
      change: msg.change,
      timestamp: now(),
    },
    msg.deviceId,
  );

  if (conflictingDevs.length > 0) {
    const allAuthors = [msg.change.author, ...conflictingDevs];
    const warning: AnyServerMessage = {
      type: "conflict_warning",
      code: msg.code,
      file: msg.change.path,
      authors: allAuthors,
      message:
        `File "${msg.change.path}" is being edited by multiple developers: ${allAuthors.join(", ")}. Coordinate to avoid conflicts.`,
      timestamp: now(),
    };
    room.broadcast(warning);

    void fireWebhook(room, "conflict", { file: msg.change.path, authors: allAuthors });
  }

  void fireWebhook(room, "file_change", { file: msg.change.path, author: msg.change.author, type: msg.change.type });
}

function handleDeclareWorking(
  ws: WebSocket,
  _state: ClientState,
  msg: Extract<AnyClientMessage, { type: "declare_working" }>,
  rooms: RoomManager,
): void {
  const room = rooms.getRoom(msg.code);
  if (!room) return;

  if (Array.isArray(msg.files) && msg.files.length > 100) {
    sendError(ws, "Too many files declared (max 100)");
    return;
  }
  if (Array.isArray(msg.files) && msg.files.some((f: string) => f.length > 500)) {
    sendError(ws, "File path too long (max 500 characters)");
    return;
  }

  const { conflicts } = room.updateWorkingFiles(
    msg.deviceId,
    msg.name,
    msg.files,
  );

  const member = room.getMember(msg.deviceId);
  if (member) {
    room.broadcast(
      {
        type: "member_updated",
        code: msg.code,
        member,
        timestamp: now(),
      },
      msg.deviceId,
    );
  }

  for (const conflict of conflicts) {
    const allAuthors = [msg.name, ...conflict.otherDevs];
    room.broadcast({
      type: "conflict_warning",
      code: msg.code,
      file: conflict.file,
      authors: allAuthors,
      message:
        `File "${conflict.file}" is being worked on by: ${allAuthors.join(", ")}. Coordinate to avoid conflicts.`,
      timestamp: now(),
    });
  }
}

function handleChatMessage(
  ws: WebSocket,
  _state: ClientState,
  msg: Extract<AnyClientMessage, { type: "chat_message" }>,
  rooms: RoomManager,
): void {
  const room = rooms.getRoom(msg.code);
  if (!room) return;

  if (!msg.content || msg.content.length > 10_000) {
    sendError(ws, "Chat message must be 1–10000 characters");
    return;
  }

  console.log(`[CodeHive Relay] chat in ${msg.code} from ${msg.name} (${msg.content.length} chars)`);

  room.addTimelineEvent("chat", msg.name, `${msg.name}: ${msg.content.slice(0, 100)}`);

  room.broadcast(
    {
      type: "chat_received",
      code: msg.code,
      from: msg.name,
      content: msg.content,
      timestamp: now(),
    },
    msg.deviceId,
  );

  void fireWebhook(room, "chat", { from: msg.name, content: msg.content });
}

function handleRequestStatus(
  ws: WebSocket,
  _state: ClientState,
  msg: Extract<AnyClientMessage, { type: "request_status" }>,
  rooms: RoomManager,
): void {
  const room = rooms.getRoom(msg.code);
  if (!room) {
    sendError(ws, `Room ${msg.code} not found`);
    return;
  }

  sendMessage(ws, {
    type: "room_status",
    room: room.toRoomInfo(),
    timestamp: now(),
  });
}

function handleSyncRequest(
  ws: WebSocket,
  _state: ClientState,
  msg: Extract<AnyClientMessage, { type: "sync_request" }>,
  rooms: RoomManager,
): void {
  const room = rooms.getRoom(msg.code);
  if (!room) {
    sendError(ws, `Room ${msg.code} not found`);
    return;
  }

  sendMessage(ws, {
    type: "room_status",
    room: room.toRoomInfo(),
    timestamp: now(),
  });
}

// ---------------------------------------------------------------------------
// NEW: Typing indicators
// ---------------------------------------------------------------------------

function handleDeclareTyping(
  ws: WebSocket,
  _state: ClientState,
  msg: Extract<AnyClientMessage, { type: "declare_typing" }>,
  rooms: RoomManager,
): void {
  const room = rooms.getRoom(msg.code);
  if (!room) return;

  room.setTyping(msg.deviceId, msg.file);

  room.broadcast(
    {
      type: "typing_indicator",
      code: msg.code,
      name: msg.name,
      file: msg.file,
      timestamp: now(),
    },
    msg.deviceId,
  );
}

// ---------------------------------------------------------------------------
// NEW: File locking
// ---------------------------------------------------------------------------

function handleLockFile(
  ws: WebSocket,
  _state: ClientState,
  msg: Extract<AnyClientMessage, { type: "lock_file" }>,
  rooms: RoomManager,
): void {
  const room = rooms.getRoom(msg.code);
  if (!room) return;

  const result = room.lockFile(msg.deviceId, msg.name, msg.file);

  if (result.success) {
    const lock = room.getFileLock(msg.file);
    if (lock) {
      room.broadcast({
        type: "file_locked",
        code: msg.code,
        lock,
        timestamp: now(),
      });
    }
  } else {
    sendMessage(ws, {
      type: "lock_error",
      code: msg.code,
      file: msg.file,
      error: result.error || "Lock failed",
      lockedBy: result.lockedBy || "unknown",
      timestamp: now(),
    });
  }
}

function handleUnlockFile(
  ws: WebSocket,
  _state: ClientState,
  msg: Extract<AnyClientMessage, { type: "unlock_file" }>,
  rooms: RoomManager,
): void {
  const room = rooms.getRoom(msg.code);
  if (!room) return;

  const result = room.unlockFile(msg.deviceId, msg.name, msg.file);

  if (result.success) {
    room.broadcast({
      type: "file_unlocked",
      code: msg.code,
      file: msg.file,
      unlockedBy: msg.name,
      timestamp: now(),
    });
  } else {
    sendError(ws, result.error || "Unlock failed");
  }
}

// ---------------------------------------------------------------------------
// NEW: Cursor sharing
// ---------------------------------------------------------------------------

function handleUpdateCursor(
  ws: WebSocket,
  _state: ClientState,
  msg: Extract<AnyClientMessage, { type: "update_cursor" }>,
  rooms: RoomManager,
): void {
  const room = rooms.getRoom(msg.code);
  if (!room) return;

  room.updateCursor(msg.deviceId, msg.cursor);

  room.broadcast(
    {
      type: "cursor_updated",
      code: msg.code,
      name: msg.name,
      cursor: msg.cursor,
      timestamp: now(),
    },
    msg.deviceId,
  );
}

// ---------------------------------------------------------------------------
// NEW: Terminal sharing
// ---------------------------------------------------------------------------

function handleShareTerminal(
  ws: WebSocket,
  _state: ClientState,
  msg: Extract<AnyClientMessage, { type: "share_terminal" }>,
  rooms: RoomManager,
): void {
  const room = rooms.getRoom(msg.code);
  if (!room) return;

  // Limit terminal output size
  if (msg.terminal.output.length > MAX_TERMINAL_OUTPUT) {
    sendError(ws, `Terminal output too large (max ${MAX_TERMINAL_OUTPUT} chars)`);
    return;
  }

  room.broadcast(
    {
      type: "terminal_shared",
      code: msg.code,
      terminal: msg.terminal,
      timestamp: now(),
    },
    msg.deviceId,
  );
}

// ---------------------------------------------------------------------------
// NEW: Room discovery
// ---------------------------------------------------------------------------

function handleListRooms(
  ws: WebSocket,
  _state: ClientState,
  _msg: Extract<AnyClientMessage, { type: "list_rooms" }>,
  rooms: RoomManager,
): void {
  sendMessage(ws, {
    type: "room_list",
    rooms: rooms.getPublicRooms(),
    timestamp: now(),
  });
}

// ---------------------------------------------------------------------------
// NEW: Timeline
// ---------------------------------------------------------------------------

function handleGetTimeline(
  ws: WebSocket,
  _state: ClientState,
  msg: Extract<AnyClientMessage, { type: "get_timeline" }>,
  rooms: RoomManager,
): void {
  const room = rooms.getRoom(msg.code);
  if (!room) {
    sendError(ws, `Room ${msg.code} not found`);
    return;
  }

  sendMessage(ws, {
    type: "timeline",
    code: msg.code,
    events: room.getTimeline(msg.limit ?? 50),
    timestamp: now(),
  });
}

// ---------------------------------------------------------------------------
// NEW: Webhook configuration
// ---------------------------------------------------------------------------

function handleSetWebhook(
  ws: WebSocket,
  _state: ClientState,
  msg: Extract<AnyClientMessage, { type: "set_webhook" }>,
  rooms: RoomManager,
): void {
  const room = rooms.getRoom(msg.code);
  if (!room) {
    sendError(ws, `Room ${msg.code} not found`);
    return;
  }

  room.webhook = msg.webhook;
  console.log(`[CodeHive Relay] webhook ${msg.webhook ? "set" : "removed"} for ${msg.code}`);
}

// ---------------------------------------------------------------------------
// NEW: Room visibility
// ---------------------------------------------------------------------------

function handleSetRoomVisibility(
  ws: WebSocket,
  _state: ClientState,
  msg: Extract<AnyClientMessage, { type: "set_room_visibility" }>,
  rooms: RoomManager,
): void {
  const room = rooms.getRoom(msg.code);
  if (!room) {
    sendError(ws, `Room ${msg.code} not found`);
    return;
  }

  room.isPublic = msg.isPublic;
  console.log(`[CodeHive Relay] room ${msg.code} visibility: ${msg.isPublic ? "public" : "private"}`);
}

// ---------------------------------------------------------------------------
// Disconnect handler
// ---------------------------------------------------------------------------

function handleDisconnect(
  ws: WebSocket,
  state: ClientState,
  rooms: RoomManager,
): void {
  if (!state.roomCode || !state.deviceId) return;

  const room = rooms.getRoom(state.roomCode);
  if (!room) return;

  const member = room.removeMember(state.deviceId);
  if (member) {
    console.log(
      `[CodeHive Relay] ${member.name} disconnected from ${state.roomCode}`,
    );

    room.broadcast({
      type: "member_left",
      code: state.roomCode,
      member,
      timestamp: now(),
    });

    void fireWebhook(room, "leave", { member: member.name });
  }

  if (room.isEmpty) {
    rooms.deleteRoom(state.roomCode);
    console.log(`[CodeHive Relay] room ${state.roomCode} deleted (empty)`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sendMessage(ws: WebSocket, msg: AnyServerMessage): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function sendError(ws: WebSocket, error: string): void {
  sendMessage(ws, {
    type: "error",
    error,
    timestamp: now(),
  });
}

// ---------------------------------------------------------------------------
// Direct execution
// ---------------------------------------------------------------------------

import { fileURLToPath } from "node:url";
import { basename } from "node:path";

const selfName = basename(fileURLToPath(import.meta.url));
const argName = process.argv[1] ? basename(process.argv[1]) : "";
const isDirectRun =
  selfName === argName ||
  argName === "codehive-relay.js" ||
  argName === "codehive-relay";

if (isDirectRun) {
  const port = parseInt(process.env["CODEHIVE_PORT"] ?? String(DEFAULT_RELAY_PORT), 10);
  const host = process.env["CODEHIVE_HOST"] ?? DEFAULT_RELAY_HOST;
  startRelayServer({ host, port });
}
