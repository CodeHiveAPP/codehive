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
import {
  CloseCodes,
  decodeClientMessage,
  DEFAULT_RELAY_HOST,
  DEFAULT_RELAY_PORT,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
} from "../shared/protocol.js";
import type {
  AnyClientMessage,
  AnyServerMessage,
  DeviceId,
} from "../shared/types.js";
import { generateRoomCode, now } from "../shared/utils.js";
import { RoomManager } from "./room.js";

interface RelayOptions {
  host?: string;
  port?: number;
}

interface ClientState {
  deviceId: DeviceId;
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
  const wss = new WebSocketServer({ host, port });

  console.log(`[CodeHive Relay] listening on ws://${host}:${port}`);
  console.log(`[CodeHive Relay] waiting for connections...`);

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

  wss.on("close", () => {
    clearInterval(heartbeatInterval);
    console.log("[CodeHive Relay] server closed");
  });

  // -----------------------------------------------------------------------
  // Connection handler
  // -----------------------------------------------------------------------
  wss.on("connection", (ws: WebSocket) => {
    const state: ClientState = { deviceId: "", roomCode: null };
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
      handleMessage(ws, state, msg, rooms);
    });
  });

  return wss;
}

// ---------------------------------------------------------------------------
// Message dispatcher
// ---------------------------------------------------------------------------

function handleMessage(
  ws: WebSocket,
  state: ClientState,
  msg: AnyClientMessage,
  rooms: RoomManager,
): void {
  switch (msg.type) {
    case "create_room":
      handleCreateRoom(ws, state, msg, rooms);
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
): void {
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

  const room = rooms.createRoom(code, msg.name);
  const err = room.addMember(msg.deviceId, msg.name, ws);
  if (err) {
    rooms.deleteRoom(code);
    sendError(ws, err);
    return;
  }

  state.roomCode = code;

  console.log(`[CodeHive Relay] room ${code} created by ${msg.name}`);

  sendMessage(ws, {
    type: "room_created",
    room: room.toRoomInfo(),
    timestamp: now(),
  });
}

function handleJoinRoom(
  ws: WebSocket,
  state: ClientState,
  msg: Extract<AnyClientMessage, { type: "join_room" }>,
  rooms: RoomManager,
): void {
  const room = rooms.getRoom(msg.code);
  if (!room) {
    sendError(ws, `Room ${msg.code} not found`);
    return;
  }

  const err = room.addMember(msg.deviceId, msg.name, ws);
  if (err) {
    sendError(ws, err);
    return;
  }

  state.roomCode = msg.code;

  console.log(`[CodeHive Relay] ${msg.name} joined ${msg.code}`);

  // Notify the joiner
  sendMessage(ws, {
    type: "room_joined",
    room: room.toRoomInfo(),
    timestamp: now(),
  });

  // Notify existing members
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
  }
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

  room.updateHeartbeat(msg.deviceId, msg.status);

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

  const conflictingDevs = room.recordFileChange(msg.change);

  // Broadcast the change to all other members
  room.broadcast(
    {
      type: "file_changed",
      code: msg.code,
      change: msg.change,
      timestamp: now(),
    },
    msg.deviceId,
  );

  // Warn about conflicts
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

    // Send to everyone involved
    room.broadcast(warning);
  }
}

function handleDeclareWorking(
  ws: WebSocket,
  _state: ClientState,
  msg: Extract<AnyClientMessage, { type: "declare_working" }>,
  rooms: RoomManager,
): void {
  const room = rooms.getRoom(msg.code);
  if (!room) return;

  const { conflicts } = room.updateWorkingFiles(
    msg.deviceId,
    msg.name,
    msg.files,
  );

  // Notify all members about the update
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

  // Warn about conflicts
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

  console.log(`[CodeHive Relay] chat in ${msg.code}: ${msg.name}: ${msg.content}`);

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
// Disconnect handler
// ---------------------------------------------------------------------------

function handleDisconnect(
  ws: WebSocket,
  state: ClientState,
  rooms: RoomManager,
): void {
  if (!state.roomCode) return;

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

const isDirectRun =
  process.argv[1]?.includes("relay") ||
  process.argv[1]?.includes("codehive-relay");

if (isDirectRun) {
  const port = parseInt(process.env["CODEHIVE_PORT"] ?? String(DEFAULT_RELAY_PORT), 10);
  const host = process.env["CODEHIVE_HOST"] ?? DEFAULT_RELAY_HOST;
  startRelayServer({ host, port });
}
