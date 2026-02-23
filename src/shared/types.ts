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
  /** Current git branch, if detected. */
  branch?: string;
  /** File the dev is currently typing in. */
  typingIn?: RelativePath | null;
  /** Cursor position in the editor. */
  cursor?: CursorPosition | null;
}

/** Cursor/selection position in a file. */
export interface CursorPosition {
  file: RelativePath;
  line: number;
  column: number;
  /** If there's a selection, end position. */
  endLine?: number;
  endColumn?: number;
}

/** A file lock held by a developer. */
export interface FileLock {
  file: RelativePath;
  lockedBy: DevName;
  deviceId: DeviceId;
  lockedAt: number;
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
  /** For binary files: size in bytes before and after. */
  sizeBefore?: number | null;
  sizeAfter?: number | null;
}

/** A single event in the room activity timeline. */
export interface TimelineEvent {
  id: number;
  timestamp: number;
  type: "join" | "leave" | "chat" | "file_change" | "lock" | "unlock" | "conflict" | "branch_change";
  actor: DevName;
  detail: string;
}

/** Room metadata visible to all participants. */
export interface RoomInfo {
  code: RoomCode;
  createdAt: number;
  createdBy: DevName;
  members: DevInfo[];
  recentChanges: FileChange[];
  hasPassword: boolean;
  /** Files currently locked in the room. */
  locks: FileLock[];
  /** Whether the room is publicly discoverable. */
  isPublic: boolean;
  /** Room expiry TTL in hours (0 = no expiry). */
  expiresInHours: number;
  /** Recent timeline events. */
  timeline: TimelineEvent[];
}

/** A file change event for binary files (size-based instead of line-based). */
export interface FileChangeSize {
  sizeBefore: number | null;
  sizeAfter: number | null;
}

/** Room summary for discovery (no sensitive data). */
export interface RoomSummary {
  code: RoomCode;
  createdBy: DevName;
  createdAt: number;
  memberCount: number;
  memberNames: DevName[];
  hasPassword: boolean;
}

/** Webhook configuration for a room. */
export interface WebhookConfig {
  url: string;
  events: string[]; // "all" | "join" | "leave" | "chat" | "file_change" | "conflict"
}

/** Terminal output shared with teammates. */
export interface SharedTerminal {
  command: string;
  output: string;
  exitCode: number | null;
  cwd: string;
  sharedBy: DevName;
  timestamp: number;
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
  | "sync_request"
  | "declare_typing"
  | "lock_file"
  | "unlock_file"
  | "update_cursor"
  | "share_terminal"
  | "list_rooms"
  | "get_timeline"
  | "set_webhook"
  | "set_room_visibility";

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
  | "heartbeat_ack"
  | "typing_indicator"
  | "file_locked"
  | "file_unlocked"
  | "lock_error"
  | "cursor_updated"
  | "terminal_shared"
  | "room_list"
  | "timeline"
  | "branch_warning";

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
  password?: string;
  isPublic?: boolean;
  expiresInHours?: number;
  branch?: string;
}

export interface JoinRoomMessage extends ClientMessage<"join_room"> {
  code: RoomCode;
  name: DevName;
  projectPath: string;
  password?: string;
  branch?: string;
}

export interface LeaveRoomMessage extends ClientMessage<"leave_room"> {
  code: RoomCode;
}

export interface HeartbeatMessage extends ClientMessage<"heartbeat"> {
  code: RoomCode;
  status: DevStatus;
  branch?: string;
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

export interface DeclareTypingMessage extends ClientMessage<"declare_typing"> {
  code: RoomCode;
  name: DevName;
  file: RelativePath | null;
}

export interface LockFileMessage extends ClientMessage<"lock_file"> {
  code: RoomCode;
  name: DevName;
  file: RelativePath;
}

export interface UnlockFileMessage extends ClientMessage<"unlock_file"> {
  code: RoomCode;
  name: DevName;
  file: RelativePath;
}

export interface UpdateCursorMessage extends ClientMessage<"update_cursor"> {
  code: RoomCode;
  name: DevName;
  cursor: CursorPosition | null;
}

export interface ShareTerminalMessage extends ClientMessage<"share_terminal"> {
  code: RoomCode;
  name: DevName;
  terminal: SharedTerminal;
}

export interface ListRoomsMessage extends ClientMessage<"list_rooms"> {}

export interface GetTimelineMessage extends ClientMessage<"get_timeline"> {
  code: RoomCode;
  limit?: number;
}

export interface SetWebhookMessage extends ClientMessage<"set_webhook"> {
  code: RoomCode;
  webhook: WebhookConfig | null;
}

export interface SetRoomVisibilityMessage extends ClientMessage<"set_room_visibility"> {
  code: RoomCode;
  isPublic: boolean;
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
  | SyncRequestMessage
  | DeclareTypingMessage
  | LockFileMessage
  | UnlockFileMessage
  | UpdateCursorMessage
  | ShareTerminalMessage
  | ListRoomsMessage
  | GetTimelineMessage
  | SetWebhookMessage
  | SetRoomVisibilityMessage;

// ---------------------------------------------------------------------------
// Server → Client payloads
// ---------------------------------------------------------------------------

export interface RoomCreatedMessage extends ServerMessage<"room_created"> {
  room: RoomInfo;
  inviteLink: string;
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

export interface TypingIndicatorMessage extends ServerMessage<"typing_indicator"> {
  code: RoomCode;
  name: DevName;
  file: RelativePath | null;
}

export interface FileLockedMessage extends ServerMessage<"file_locked"> {
  code: RoomCode;
  lock: FileLock;
}

export interface FileUnlockedMessage extends ServerMessage<"file_unlocked"> {
  code: RoomCode;
  file: RelativePath;
  unlockedBy: DevName;
}

export interface LockErrorMessage extends ServerMessage<"lock_error"> {
  code: RoomCode;
  file: RelativePath;
  error: string;
  lockedBy: DevName;
}

export interface CursorUpdatedMessage extends ServerMessage<"cursor_updated"> {
  code: RoomCode;
  name: DevName;
  cursor: CursorPosition | null;
}

export interface TerminalSharedMessage extends ServerMessage<"terminal_shared"> {
  code: RoomCode;
  terminal: SharedTerminal;
}

export interface RoomListMessage extends ServerMessage<"room_list"> {
  rooms: RoomSummary[];
}

export interface TimelineMessage extends ServerMessage<"timeline"> {
  code: RoomCode;
  events: TimelineEvent[];
}

export interface BranchWarningMessage extends ServerMessage<"branch_warning"> {
  code: RoomCode;
  message: string;
  branches: Record<DevName, string>;
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
  | HeartbeatAckMessage
  | TypingIndicatorMessage
  | FileLockedMessage
  | FileUnlockedMessage
  | LockErrorMessage
  | CursorUpdatedMessage
  | TerminalSharedMessage
  | RoomListMessage
  | TimelineMessage
  | BranchWarningMessage;
