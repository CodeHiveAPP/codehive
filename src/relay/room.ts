/**
 * Room management for the CodeHive relay server.
 *
 * Each room tracks its connected members, recent file changes,
 * and handles conflict detection when multiple developers touch
 * the same file simultaneously.
 */

import type WebSocket from "ws";
import {
  encodeServerMessage,
  MAX_RECENT_CHANGES,
  MAX_ROOM_MEMBERS,
} from "../shared/protocol.js";
import type {
  AnyServerMessage,
  DeviceId,
  DevInfo,
  DevName,
  DevStatus,
  FileChange,
  RelativePath,
  RoomCode,
  RoomInfo,
} from "../shared/types.js";
import { now } from "../shared/utils.js";

interface ConnectedClient {
  ws: WebSocket;
  info: DevInfo;
}

export class Room {
  readonly code: RoomCode;
  readonly createdAt: number;
  readonly createdBy: DevName;

  private clients: Map<DeviceId, ConnectedClient> = new Map();
  private recentChanges: FileChange[] = [];

  constructor(code: RoomCode, createdBy: DevName) {
    this.code = code;
    this.createdAt = now();
    this.createdBy = createdBy;
  }

  /** Number of currently connected members. */
  get memberCount(): number {
    return this.clients.size;
  }

  /** Whether the room has no connected clients. */
  get isEmpty(): boolean {
    return this.clients.size === 0;
  }

  /**
   * Add a developer to this room.
   * Returns an error string if the room is full or the device is already connected.
   */
  addMember(deviceId: DeviceId, name: DevName, ws: WebSocket): string | null {
    if (this.clients.size >= MAX_ROOM_MEMBERS) {
      return `Room ${this.code} is full (max ${MAX_ROOM_MEMBERS} members)`;
    }

    if (this.clients.has(deviceId)) {
      return `Device ${deviceId} is already in room ${this.code}`;
    }

    const info: DevInfo = {
      deviceId,
      name,
      status: "active",
      workingOn: [],
      joinedAt: now(),
      lastSeen: now(),
    };

    this.clients.set(deviceId, { ws, info });
    return null;
  }

  /**
   * Remove a developer from this room.
   */
  removeMember(deviceId: DeviceId): DevInfo | null {
    const client = this.clients.get(deviceId);
    if (!client) return null;

    this.clients.delete(deviceId);
    return client.info;
  }

  /**
   * Get information about a specific member.
   */
  getMember(deviceId: DeviceId): DevInfo | null {
    return this.clients.get(deviceId)?.info ?? null;
  }

  /**
   * Update heartbeat timestamp for a member.
   */
  updateHeartbeat(deviceId: DeviceId, status: DevStatus): void {
    const client = this.clients.get(deviceId);
    if (client) {
      client.info.lastSeen = now();
      client.info.status = status;
    }
  }

  /**
   * Update the list of files a developer is working on.
   * Returns a conflict warning if another developer is working on the same files.
   */
  updateWorkingFiles(
    deviceId: DeviceId,
    name: DevName,
    files: RelativePath[],
  ): { conflicts: Array<{ file: RelativePath; otherDevs: DevName[] }> } {
    const client = this.clients.get(deviceId);
    if (client) {
      client.info.workingOn = files;
      client.info.lastSeen = now();
    }

    const conflicts: Array<{ file: RelativePath; otherDevs: DevName[] }> = [];

    for (const file of files) {
      const otherDevs: DevName[] = [];
      for (const [otherId, otherClient] of this.clients) {
        if (otherId !== deviceId && otherClient.info.workingOn.includes(file)) {
          otherDevs.push(otherClient.info.name);
        }
      }
      if (otherDevs.length > 0) {
        conflicts.push({ file, otherDevs });
      }
    }

    return { conflicts };
  }

  /**
   * Record a file change and check for conflicts.
   */
  recordFileChange(change: FileChange): DevName[] {
    this.recentChanges.push(change);
    if (this.recentChanges.length > MAX_RECENT_CHANGES) {
      this.recentChanges = this.recentChanges.slice(-MAX_RECENT_CHANGES);
    }

    // Find other devs working on the same file
    const conflictingDevs: DevName[] = [];
    for (const [, client] of this.clients) {
      if (
        client.info.deviceId !== change.deviceId &&
        client.info.workingOn.includes(change.path)
      ) {
        conflictingDevs.push(client.info.name);
      }
    }

    return conflictingDevs;
  }

  /**
   * Send a message to a specific client.
   */
  sendTo(deviceId: DeviceId, message: AnyServerMessage): void {
    const client = this.clients.get(deviceId);
    if (client && client.ws.readyState === client.ws.OPEN) {
      client.ws.send(encodeServerMessage(message));
    }
  }

  /**
   * Broadcast a message to all clients in the room.
   */
  broadcast(message: AnyServerMessage, excludeDeviceId?: DeviceId): void {
    const payload = encodeServerMessage(message);
    for (const [deviceId, client] of this.clients) {
      if (deviceId !== excludeDeviceId && client.ws.readyState === client.ws.OPEN) {
        client.ws.send(payload);
      }
    }
  }

  /**
   * Find clients that have not sent a heartbeat within the timeout.
   */
  findDeadClients(timeoutMs: number): DeviceId[] {
    const deadline = now() - timeoutMs;
    const dead: DeviceId[] = [];
    for (const [deviceId, client] of this.clients) {
      if (client.info.lastSeen < deadline) {
        dead.push(deviceId);
      }
    }
    return dead;
  }

  /**
   * Build a snapshot of the room's current state.
   */
  toRoomInfo(): RoomInfo {
    const members: DevInfo[] = [];
    for (const [, client] of this.clients) {
      members.push({ ...client.info });
    }

    return {
      code: this.code,
      createdAt: this.createdAt,
      createdBy: this.createdBy,
      members,
      recentChanges: this.recentChanges.slice(-20),
    };
  }
}

/**
 * Manages all active rooms on the relay server.
 */
export class RoomManager {
  private rooms: Map<RoomCode, Room> = new Map();

  /** Create a new room with a unique code. */
  createRoom(code: RoomCode, createdBy: DevName): Room {
    const room = new Room(code, createdBy);
    this.rooms.set(code, room);
    return room;
  }

  /** Get a room by its code. */
  getRoom(code: RoomCode): Room | undefined {
    return this.rooms.get(code);
  }

  /** Delete a room. */
  deleteRoom(code: RoomCode): boolean {
    return this.rooms.delete(code);
  }

  /** Check whether a room code is already in use. */
  hasRoom(code: RoomCode): boolean {
    return this.rooms.has(code);
  }

  /** Total number of active rooms. */
  get roomCount(): number {
    return this.rooms.size;
  }

  /** Remove all empty rooms and return the count of removed rooms. */
  pruneEmptyRooms(): number {
    let pruned = 0;
    for (const [code, room] of this.rooms) {
      if (room.isEmpty) {
        this.rooms.delete(code);
        pruned++;
      }
    }
    return pruned;
  }

  /** Iterate over all rooms. */
  *[Symbol.iterator](): IterableIterator<[RoomCode, Room]> {
    yield* this.rooms;
  }
}
