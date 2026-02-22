/**
 * Core types for the CodeHive collaboration protocol.
 *
 * All messages exchanged between clients and the relay server
 * follow a strict typed envelope format defined here.
 */

/** Unique identifier for a collaboration room. Format: "HIVE-XXXX" */
export type RoomCode = string;

/** Unique identifier for a connected developer. */
export type DeviceId = string;

/** Display name chosen by the developer. */
export type DevName = string;

/** A file path relative to the project root. */
export type RelativePath = string;

/** Status of a developer in a room. */
export type DevStatus = "active" | "idle" | "away";

/** Information about a connected developer. */
export interface DevInfo {
  deviceId: DeviceId;
  name: DevName;
  status: DevStatus;
  workingOn: RelativePath[];
  joinedAt: number;
  lastSeen: number;
}

/** A single file change event from a developer. */
export interface FileChange {
  path: RelativePath;
  type: "add" | "change" | "unlink";
  author: DevName;
  deviceId: DeviceId;
  timestamp: number;
  diff: string | null;
  linesAdded: number;
  linesRemoved: number;
}

/** Room metadata visible to all participants. */
export interface RoomInfo {
  code: RoomCode;
  createdAt: number;
  createdBy: DevName;
  members: DevInfo[];
  recentChanges: FileChange[];
}

// ---------------------------------------------------------------------------
// Protocol message types
// ---------------------------------------------------------------------------

export type ClientMessageType =
  | "create_room"
  | "join_room"
  | "leave_room"
  | "heartbeat"
  | "file_change"
  | "declare_working"
  | "chat_message"
  | "request_status"
  | "sync_request";

export type ServerMessageType =
  | "room_created"
  | "room_joined"
  | "room_left"
  | "member_joined"
  | "member_left"
  | "member_updated"
  | "file_changed"
  | "chat_received"
  | "room_status"
  | "conflict_warning"
  | "error"
  | "heartbeat_ack";

/** Base envelope for all client-to-server messages. */
export interface ClientMessage<T extends ClientMessageType = ClientMessageType> {
  type: T;
  deviceId: DeviceId;
  timestamp: number;
}

/** Base envelope for all server-to-client messages. */
export interface ServerMessage<T extends ServerMessageType = ServerMessageType> {
  type: T;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Client → Server payloads
// ---------------------------------------------------------------------------

export interface CreateRoomMessage extends ClientMessage<"create_room"> {
  name: DevName;
  projectPath: string;
}

export interface JoinRoomMessage extends ClientMessage<"join_room"> {
  code: RoomCode;
  name: DevName;
  projectPath: string;
}

export interface LeaveRoomMessage extends ClientMessage<"leave_room"> {
  code: RoomCode;
}

export interface HeartbeatMessage extends ClientMessage<"heartbeat"> {
  code: RoomCode;
  status: DevStatus;
}

export interface FileChangeMessage extends ClientMessage<"file_change"> {
  code: RoomCode;
  change: FileChange;
}

export interface DeclareWorkingMessage extends ClientMessage<"declare_working"> {
  code: RoomCode;
  name: DevName;
  files: RelativePath[];
}

export interface ChatSendMessage extends ClientMessage<"chat_message"> {
  code: RoomCode;
  name: DevName;
  content: string;
}

export interface RequestStatusMessage extends ClientMessage<"request_status"> {
  code: RoomCode;
}

export interface SyncRequestMessage extends ClientMessage<"sync_request"> {
  code: RoomCode;
}

/** Union of every possible client message. */
export type AnyClientMessage =
  | CreateRoomMessage
  | JoinRoomMessage
  | LeaveRoomMessage
  | HeartbeatMessage
  | FileChangeMessage
  | DeclareWorkingMessage
  | ChatSendMessage
  | RequestStatusMessage
  | SyncRequestMessage;

// ---------------------------------------------------------------------------
// Server → Client payloads
// ---------------------------------------------------------------------------

export interface RoomCreatedMessage extends ServerMessage<"room_created"> {
  room: RoomInfo;
}

export interface RoomJoinedMessage extends ServerMessage<"room_joined"> {
  room: RoomInfo;
}

export interface RoomLeftMessage extends ServerMessage<"room_left"> {
  code: RoomCode;
}

export interface MemberJoinedMessage extends ServerMessage<"member_joined"> {
  code: RoomCode;
  member: DevInfo;
}

export interface MemberLeftMessage extends ServerMessage<"member_left"> {
  code: RoomCode;
  member: DevInfo;
}

export interface MemberUpdatedMessage extends ServerMessage<"member_updated"> {
  code: RoomCode;
  member: DevInfo;
}

export interface FileChangedMessage extends ServerMessage<"file_changed"> {
  code: RoomCode;
  change: FileChange;
}

export interface ChatReceivedMessage extends ServerMessage<"chat_received"> {
  code: RoomCode;
  from: DevName;
  content: string;
}

export interface RoomStatusMessage extends ServerMessage<"room_status"> {
  room: RoomInfo;
}

export interface ConflictWarningMessage extends ServerMessage<"conflict_warning"> {
  code: RoomCode;
  file: RelativePath;
  authors: DevName[];
  message: string;
}

export interface ErrorMessage extends ServerMessage<"error"> {
  error: string;
  details?: string;
}

export interface HeartbeatAckMessage extends ServerMessage<"heartbeat_ack"> {
  code: RoomCode;
}

/** Union of every possible server message. */
export type AnyServerMessage =
  | RoomCreatedMessage
  | RoomJoinedMessage
  | RoomLeftMessage
  | MemberJoinedMessage
  | MemberLeftMessage
  | MemberUpdatedMessage
  | FileChangedMessage
  | ChatReceivedMessage
  | RoomStatusMessage
  | ConflictWarningMessage
  | ErrorMessage
  | HeartbeatAckMessage;
