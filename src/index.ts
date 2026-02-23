/**
 * CodeHive — Real-time multi-developer collaboration for Claude Code
 *
 * Public API surface for programmatic usage.
 */

export { startRelayServer } from "./relay/server.js";
export { Room, RoomManager } from "./relay/room.js";
export { RelayClient, type RelayClientOptions } from "./mcp/client.js";
export { FileWatcher, type WatcherOptions } from "./watcher/index.js";
export {
  generateRoomCode,
  generateDeviceId,
  isValidRoomCode,
  formatTime,
  now,
} from "./shared/utils.js";
export {
  DEFAULT_RELAY_HOST,
  DEFAULT_RELAY_PORT,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  MAX_RECENT_CHANGES,
  MAX_ROOM_MEMBERS,
  MAX_TIMELINE_EVENTS,
  MAX_LOCKS_PER_ROOM,
  MAX_TERMINAL_OUTPUT,
  TYPING_TIMEOUT_MS,
  ROOM_EXPIRY_CHECK_MS,
  DEFAULT_ROOM_EXPIRY_HOURS,
  buildRelayUrl,
  buildInviteLink,
  encodeClientMessage,
  encodeServerMessage,
  decodeClientMessage,
  decodeServerMessage,
  isClientMessageType,
  isServerMessageType,
} from "./shared/protocol.js";
export { TelegramBot, type TelegramBotOptions } from "./telegram/bot.js";
export type * from "./shared/types.js";
