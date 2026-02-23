/**
 * Room management for the CodeHive relay server.
 *
 * Each room tracks its connected members, recent file changes,
 * file locks, activity timeline, and handles conflict detection
 * when multiple developers touch the same file simultaneously.
 */

import type WebSocket from "ws";
import {
  encodeServerMessage,
  MAX_RECENT_CHANGES,
  MAX_ROOM_MEMBERS,
  MAX_TIMELINE_EVENTS,
  MAX_LOCKS_PER_ROOM,
  TYPING_TIMEOUT_MS,
} from "../shared/protocol.js";
import type {
  AnyServerMessage,
  CursorPosition,
  DeviceId,
  DevInfo,
  DevName,
  DevStatus,
  FileChange,
  FileLock,
  RelativePath,
  RoomCode,
  RoomInfo,
  RoomSummary,
  TimelineEvent,
  WebhookConfig,
} from "../shared/types.js";
import { createHash } from "node:crypto";
import { now } from "../shared/utils.js";

/** Hash a password for disk persistence (not stored plaintext). */
function hashPassword(password: string): string {
  return createHash("sha256").update(password).digest("hex");
}

interface ConnectedClient {
  ws: WebSocket;
  info: DevInfo;
}

export class Room {
  readonly code: RoomCode;
  readonly createdAt: number;
  readonly createdBy: DevName;
  readonly password: string | null;
  isPublic: boolean;
  expiresInHours: number;
  lastActivity: number;

  private clients: Map<DeviceId, ConnectedClient> = new Map();
  private recentChanges: FileChange[] = [];
  private locks: Map<RelativePath, FileLock> = new Map();
  private timeline: TimelineEvent[] = [];
  private timelineCounter = 0;
  private typingTimers: Map<DeviceId, ReturnType<typeof setTimeout>> = new Map();
  webhook: WebhookConfig | null = null;

  constructor(code: RoomCode, createdBy: DevName, password?: string, isPublic = false, expiresInHours = 0) {
    this.code = code;
    this.createdAt = now();
    this.createdBy = createdBy;
    this.password = password || null;
    this.isPublic = isPublic;
    this.expiresInHours = expiresInHours;
    this.lastActivity = now();
  }

  /** Check if a password matches. Returns true if room has no password. */
  checkPassword(password?: string): boolean {
    if (!this.password) return true;
    return this.password === password;
  }

  /** Number of currently connected members. */
  get memberCount(): number {
    return this.clients.size;
  }

  /** Whether the room has no connected clients. */
  get isEmpty(): boolean {
    return this.clients.size === 0;
  }

  /** Whether the room has expired. */
  get isExpired(): boolean {
    if (this.expiresInHours <= 0) return false;
    return now() - this.lastActivity > this.expiresInHours * 3600_000;
  }

  /** Touch activity timestamp. */
  touch(): void {
    this.lastActivity = now();
  }

  // -----------------------------------------------------------------------
  // Members
  // -----------------------------------------------------------------------

  addMember(deviceId: DeviceId, name: DevName, ws: WebSocket, branch?: string): string | null {
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
      branch: branch || undefined,
      typingIn: null,
      cursor: null,
    };

    this.clients.set(deviceId, { ws, info });
    this.touch();
    this.addTimelineEvent("join", name, `${name} joined the room`);
    return null;
  }

  removeMember(deviceId: DeviceId): DevInfo | null {
    const client = this.clients.get(deviceId);
    if (!client) return null;

    // Clear typing timer
    const timer = this.typingTimers.get(deviceId);
    if (timer) {
      clearTimeout(timer);
      this.typingTimers.delete(deviceId);
    }

    // Release all locks held by this device
    for (const [file, lock] of this.locks) {
      if (lock.deviceId === deviceId) {
        this.locks.delete(file);
      }
    }

    this.clients.delete(deviceId);
    this.touch();
    this.addTimelineEvent("leave", client.info.name, `${client.info.name} left the room`);
    return client.info;
  }

  getMember(deviceId: DeviceId): DevInfo | null {
    return this.clients.get(deviceId)?.info ?? null;
  }

  updateHeartbeat(deviceId: DeviceId, status: DevStatus, branch?: string): void {
    const client = this.clients.get(deviceId);
    if (client) {
      const oldBranch = client.info.branch;
      client.info.lastSeen = now();
      client.info.status = status;
      if (branch) {
        client.info.branch = branch;
      }
      this.touch();

      // Detect branch change
      if (branch && oldBranch && branch !== oldBranch) {
        this.addTimelineEvent("branch_change", client.info.name, `${client.info.name} switched from ${oldBranch} to ${branch}`);
      }
    }
  }

  // -----------------------------------------------------------------------
  // Typing indicators
  // -----------------------------------------------------------------------

  setTyping(deviceId: DeviceId, file: RelativePath | null): void {
    const client = this.clients.get(deviceId);
    if (!client) return;

    client.info.typingIn = file;

    // Clear existing timer
    const existing = this.typingTimers.get(deviceId);
    if (existing) clearTimeout(existing);

    if (file) {
      // Auto-clear typing after timeout
      const timer = setTimeout(() => {
        if (client.info.typingIn === file) {
          client.info.typingIn = null;
        }
        this.typingTimers.delete(deviceId);
      }, TYPING_TIMEOUT_MS);
      this.typingTimers.set(deviceId, timer);
    } else {
      this.typingTimers.delete(deviceId);
    }
  }

  // -----------------------------------------------------------------------
  // Cursor sharing
  // -----------------------------------------------------------------------

  updateCursor(deviceId: DeviceId, cursor: CursorPosition | null): void {
    const client = this.clients.get(deviceId);
    if (client) {
      client.info.cursor = cursor;
    }
  }

  // -----------------------------------------------------------------------
  // File locking
  // -----------------------------------------------------------------------

  lockFile(deviceId: DeviceId, name: DevName, file: RelativePath): { success: boolean; error?: string; lockedBy?: DevName } {
    const existing = this.locks.get(file);
    if (existing) {
      if (existing.deviceId === deviceId) {
        return { success: true }; // Already locked by same device
      }
      return { success: false, error: `File "${file}" is locked by ${existing.lockedBy}`, lockedBy: existing.lockedBy };
    }

    if (this.locks.size >= MAX_LOCKS_PER_ROOM) {
      return { success: false, error: `Too many locks in room (max ${MAX_LOCKS_PER_ROOM})` };
    }

    const lock: FileLock = {
      file,
      lockedBy: name,
      deviceId,
      lockedAt: now(),
    };
    this.locks.set(file, lock);
    this.touch();
    this.addTimelineEvent("lock", name, `${name} locked ${file}`);
    return { success: true };
  }

  unlockFile(deviceId: DeviceId, name: DevName, file: RelativePath): { success: boolean; error?: string } {
    const existing = this.locks.get(file);
    if (!existing) {
      return { success: true }; // Not locked, fine
    }
    if (existing.deviceId !== deviceId) {
      return { success: false, error: `File "${file}" is locked by ${existing.lockedBy}, only they can unlock it` };
    }

    this.locks.delete(file);
    this.touch();
    this.addTimelineEvent("unlock", name, `${name} unlocked ${file}`);
    return { success: true };
  }

  getLocks(): FileLock[] {
    return Array.from(this.locks.values());
  }

  getFileLock(file: RelativePath): FileLock | null {
    return this.locks.get(file) ?? null;
  }

  // -----------------------------------------------------------------------
  // Git branch awareness
  // -----------------------------------------------------------------------

  /** Get a map of dev names to their branches. */
  getBranches(): Record<DevName, string> {
    const branches: Record<DevName, string> = {};
    for (const [, client] of this.clients) {
      if (client.info.branch) {
        branches[client.info.name] = client.info.branch;
      }
    }
    return branches;
  }

  /** Check if members are on different branches and return a warning. */
  checkBranchDivergence(): { diverged: boolean; branches: Record<DevName, string>; message: string } {
    const branches = this.getBranches();
    const uniqueBranches = new Set(Object.values(branches));
    if (uniqueBranches.size <= 1) {
      return { diverged: false, branches, message: "" };
    }

    const parts = Object.entries(branches).map(([name, branch]) => `${name}: ${branch}`);
    return {
      diverged: true,
      branches,
      message: `Team members are on different branches: ${parts.join(", ")}. Coordinate before merging.`,
    };
  }

  // -----------------------------------------------------------------------
  // Timeline
  // -----------------------------------------------------------------------

  addTimelineEvent(type: TimelineEvent["type"], actor: DevName, detail: string): TimelineEvent {
    const event: TimelineEvent = {
      id: ++this.timelineCounter,
      timestamp: now(),
      type,
      actor,
      detail,
    };
    this.timeline.push(event);
    if (this.timeline.length > MAX_TIMELINE_EVENTS) {
      this.timeline = this.timeline.slice(-MAX_TIMELINE_EVENTS);
    }
    return event;
  }

  getTimeline(limit = 50): TimelineEvent[] {
    return this.timeline.slice(-limit);
  }

  // -----------------------------------------------------------------------
  // Working files & conflicts
  // -----------------------------------------------------------------------

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

  recordFileChange(change: FileChange): DevName[] {
    this.recentChanges.push(change);
    if (this.recentChanges.length > MAX_RECENT_CHANGES) {
      this.recentChanges = this.recentChanges.slice(-MAX_RECENT_CHANGES);
    }

    this.touch();
    this.addTimelineEvent("file_change", change.author, `${change.author} ${change.type}d ${change.path}`);

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

  // -----------------------------------------------------------------------
  // Messaging
  // -----------------------------------------------------------------------

  sendTo(deviceId: DeviceId, message: AnyServerMessage): void {
    const client = this.clients.get(deviceId);
    if (client && client.ws.readyState === client.ws.OPEN) {
      client.ws.send(encodeServerMessage(message));
    }
  }

  broadcast(message: AnyServerMessage, excludeDeviceId?: DeviceId): void {
    const payload = encodeServerMessage(message);
    for (const [deviceId, client] of this.clients) {
      if (deviceId !== excludeDeviceId && client.ws.readyState === client.ws.OPEN) {
        client.ws.send(payload);
      }
    }
  }

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

  // -----------------------------------------------------------------------
  // Snapshots
  // -----------------------------------------------------------------------

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
      hasPassword: this.password !== null,
      locks: this.getLocks(),
      isPublic: this.isPublic,
      expiresInHours: this.expiresInHours,
      timeline: this.timeline.slice(-20),
    };
  }

  toRoomSummary(): RoomSummary {
    const memberNames: DevName[] = [];
    for (const [, client] of this.clients) {
      memberNames.push(client.info.name);
    }

    return {
      code: this.code,
      createdBy: this.createdBy,
      createdAt: this.createdAt,
      memberCount: this.clients.size,
      memberNames,
      hasPassword: this.password !== null,
    };
  }
}

/**
 * Manages all active rooms on the relay server.
 */
export class RoomManager {
  private rooms: Map<RoomCode, Room> = new Map();

  createRoom(code: RoomCode, createdBy: DevName, password?: string, isPublic = false, expiresInHours = 0): Room {
    const room = new Room(code, createdBy, password, isPublic, expiresInHours);
    this.rooms.set(code, room);
    return room;
  }

  getRoom(code: RoomCode): Room | undefined {
    return this.rooms.get(code);
  }

  deleteRoom(code: RoomCode): boolean {
    return this.rooms.delete(code);
  }

  hasRoom(code: RoomCode): boolean {
    return this.rooms.has(code);
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  /** Get all public rooms for discovery. */
  getPublicRooms(): RoomSummary[] {
    const result: RoomSummary[] = [];
    for (const [, room] of this.rooms) {
      if (room.isPublic && !room.isEmpty) {
        result.push(room.toRoomSummary());
      }
    }
    return result;
  }

  /** Remove expired rooms and return count. */
  pruneExpiredRooms(): number {
    let pruned = 0;
    for (const [code, room] of this.rooms) {
      if (room.isExpired) {
        this.rooms.delete(code);
        pruned++;
        console.log(`[CodeHive Relay] room ${code} expired (inactive ${room.expiresInHours}h)`);
      }
    }
    return pruned;
  }

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

  /** Serialize all rooms for persistence (passwords are hashed, not stored plaintext). */
  toJSON(): object[] {
    const result: object[] = [];
    for (const [, room] of this.rooms) {
      if (!room.isEmpty) {
        result.push({
          code: room.code,
          createdAt: room.createdAt,
          createdBy: room.createdBy,
          hasPassword: room.password !== null,
          passwordHash: room.password ? hashPassword(room.password) : null,
          isPublic: room.isPublic,
          expiresInHours: room.expiresInHours,
          lastActivity: room.lastActivity,
        });
      }
    }
    return result;
  }

  *[Symbol.iterator](): IterableIterator<[RoomCode, Room]> {
    yield* this.rooms;
  }
}
