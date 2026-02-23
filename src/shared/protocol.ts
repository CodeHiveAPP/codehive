/**
 * Protocol constants and message serialization for CodeHive.
 *
 * All WebSocket communication uses JSON-encoded envelopes.
 * This module provides helpers to build and parse those envelopes
 * with type safety guarantees.
 */

import type {
  AnyClientMessage,
  AnyServerMessage,
  ClientMessageType,
  ServerMessageType,
} from "./types.js";

/** Default relay server port. */
export const DEFAULT_RELAY_PORT = 4819;

/** Default relay host for local development. */
export const DEFAULT_RELAY_HOST = "127.0.0.1";

/** WebSocket close codes used by the protocol. */
export const CloseCodes = {
  NORMAL: 1000,
  GOING_AWAY: 1001,
  ROOM_CLOSED: 4000,
  INVALID_MESSAGE: 4001,
  ROOM_NOT_FOUND: 4002,
  DUPLICATE_DEVICE: 4003,
} as const;

/** Heartbeat interval in milliseconds. */
export const HEARTBEAT_INTERVAL_MS = 15_000;

/** Time after which a client is considered dead. */
export const HEARTBEAT_TIMEOUT_MS = 45_000;

/** Maximum number of recent changes kept per room. */
export const MAX_RECENT_CHANGES = 100;

/** Maximum number of members per room. */
export const MAX_ROOM_MEMBERS = 20;

/** Maximum number of timeline events kept per room. */
export const MAX_TIMELINE_EVENTS = 200;

/** Maximum number of file locks per room. */
export const MAX_LOCKS_PER_ROOM = 50;

/** Default room expiry TTL in hours (0 = never). */
export const DEFAULT_ROOM_EXPIRY_HOURS = 0;

/** Room expiry check interval in milliseconds (every 5 minutes). */
export const ROOM_EXPIRY_CHECK_MS = 5 * 60 * 1000;

/** Typing indicator timeout in milliseconds (auto-clear after 10s). */
export const TYPING_TIMEOUT_MS = 10_000;

/** Maximum terminal output size in characters. */
export const MAX_TERMINAL_OUTPUT = 50_000;

/**
 * Serialize a client message to a JSON string for transmission.
 */
export function encodeClientMessage(msg: AnyClientMessage): string {
  return JSON.stringify(msg);
}

/**
 * Serialize a server message to a JSON string for transmission.
 */
export function encodeServerMessage(msg: AnyServerMessage): string {
  return JSON.stringify(msg);
}

/**
 * Parse a raw WebSocket payload into a typed client message.
 * Returns `null` if the payload is not valid JSON or lacks a `type` field.
 */
export function decodeClientMessage(raw: string): AnyClientMessage | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "type" in parsed &&
      typeof (parsed as Record<string, unknown>).type === "string"
    ) {
      return parsed as AnyClientMessage;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Parse a raw WebSocket payload into a typed server message.
 * Returns `null` if the payload is not valid JSON or lacks a `type` field.
 */
export function decodeServerMessage(raw: string): AnyServerMessage | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "type" in parsed &&
      typeof (parsed as Record<string, unknown>).type === "string"
    ) {
      return parsed as AnyServerMessage;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Type guard: check whether a message type belongs to the client set.
 */
export function isClientMessageType(type: string): type is ClientMessageType {
  const valid: Set<string> = new Set<ClientMessageType>([
    "create_room",
    "join_room",
    "leave_room",
    "heartbeat",
    "file_change",
    "declare_working",
    "chat_message",
    "request_status",
    "sync_request",
    "declare_typing",
    "lock_file",
    "unlock_file",
    "update_cursor",
    "share_terminal",
    "list_rooms",
    "get_timeline",
    "set_webhook",
    "set_room_visibility",
  ]);
  return valid.has(type);
}

/**
 * Type guard: check whether a message type belongs to the server set.
 */
export function isServerMessageType(type: string): type is ServerMessageType {
  const valid: Set<string> = new Set<ServerMessageType>([
    "room_created",
    "room_joined",
    "room_left",
    "member_joined",
    "member_left",
    "member_updated",
    "file_changed",
    "chat_received",
    "room_status",
    "conflict_warning",
    "error",
    "heartbeat_ack",
    "typing_indicator",
    "file_locked",
    "file_unlocked",
    "lock_error",
    "cursor_updated",
    "terminal_shared",
    "room_list",
    "timeline",
    "branch_warning",
  ]);
  return valid.has(type);
}

/**
 * Build the WebSocket URL for connecting to a relay.
 */
export function buildRelayUrl(host: string, port: number): string {
  return `ws://${host}:${port}`;
}

/**
 * Build an invite link for a room.
 */
export function buildInviteLink(host: string, port: number, code: string, password?: string): string {
  const base = `codehive://${host}:${port}/join/${code}`;
  if (password) {
    return `${base}?password=${encodeURIComponent(password)}`;
  }
  return base;
}
