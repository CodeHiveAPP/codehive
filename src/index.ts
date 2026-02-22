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
} from "./shared/utils.js";
export {
  DEFAULT_RELAY_HOST,
  DEFAULT_RELAY_PORT,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
} from "./shared/protocol.js";
export type * from "./shared/types.js";
