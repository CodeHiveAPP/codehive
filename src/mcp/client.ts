/**
 * CodeHive WebSocket Client
 *
 * Connects to the relay server and manages the bidirectional communication
 * between the local MCP server and the remote relay. Handles reconnection,
 * heartbeat, and event dispatching.
 */

import WebSocket from "ws";
import {
  buildRelayUrl,
  decodeServerMessage,
  DEFAULT_RELAY_HOST,
  DEFAULT_RELAY_PORT,
  encodeClientMessage,
  HEARTBEAT_INTERVAL_MS,
} from "../shared/protocol.js";
import type {
  AnyClientMessage,
  AnyServerMessage,
  CursorPosition,
  DeviceId,
  DevName,
  DevStatus,
  FileChange,
  RelativePath,
  RoomCode,
  SharedTerminal,
  WebhookConfig,
} from "../shared/types.js";
import { now } from "../shared/utils.js";

export type ServerEventHandler = (msg: AnyServerMessage) => void;
export type MessagePredicate = (msg: AnyServerMessage) => boolean;

interface PendingListener {
  predicate: MessagePredicate;
  callback: (msg: AnyServerMessage) => void;
}

export interface RelayClientOptions {
  host?: string;
  port?: number;
  deviceId: DeviceId;
  devName: DevName;
  projectPath: string;
  onMessage?: ServerEventHandler;
  onConnect?: () => void;
  onDisconnect?: () => void;
}

/**
 * Client that maintains a persistent connection to the relay server.
 */
export class RelayClient {
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldReconnect = true;
  private reconnectAttempts = 0;

  private host: string;
  private port: number;

  readonly deviceId: DeviceId;
  readonly devName: DevName;
  readonly projectPath: string;

  private currentRoom: RoomCode | null = null;
  private currentStatus: DevStatus = "active";
  private currentBranch: string | undefined;
  private currentPassword: string | undefined;

  /** Pending one-shot message listeners (for tool responses). */
  private pendingListeners: PendingListener[] = [];

  /** Queue of file changes captured while disconnected. */
  private fileChangeQueue: FileChange[] = [];
  private static readonly MAX_QUEUED_CHANGES = 50;

  private onMessageHandler: ServerEventHandler;
  private onConnect: () => void;
  private onDisconnect: () => void;

  constructor(options: RelayClientOptions) {
    this.host = options.host ?? DEFAULT_RELAY_HOST;
    this.port = options.port ?? DEFAULT_RELAY_PORT;
    this.deviceId = options.deviceId;
    this.devName = options.devName;
    this.projectPath = options.projectPath;
    this.onMessageHandler = options.onMessage ?? (() => {});
    this.onConnect = options.onConnect ?? (() => {});
    this.onDisconnect = options.onDisconnect ?? (() => {});
  }

  get connected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  get roomCode(): RoomCode | null {
    return this.currentRoom;
  }

  /** Set the current git branch for this client. */
  setBranch(branch: string): void {
    this.currentBranch = branch;
  }

  onceMessage(
    predicate: MessagePredicate,
    callback: (msg: AnyServerMessage) => void,
  ): () => void {
    const listener: PendingListener = { predicate, callback };
    this.pendingListeners.push(listener);
    return () => {
      const idx = this.pendingListeners.indexOf(listener);
      if (idx !== -1) this.pendingListeners.splice(idx, 1);
    };
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.connected) {
        resolve();
        return;
      }

      const url = buildRelayUrl(this.host, this.port);
      this.ws = new WebSocket(url);

      this.ws.on("open", () => {
        this.reconnectAttempts = 0;
        this.startHeartbeat();
        this.onConnect();

        if (this.currentRoom) {
          const roomToRejoin = this.currentRoom;
          this.onceMessage(
            (msg) => msg.type === "room_joined" || msg.type === "error",
            (msg) => {
              if (msg.type === "room_joined") {
                this.flushFileChangeQueue();
              } else {
                this.fileChangeQueue = [];
                console.error(`[CodeHive Client] rejoin ${roomToRejoin} failed`);
              }
            },
          );
          this.send({
            type: "join_room",
            code: roomToRejoin,
            deviceId: this.deviceId,
            name: this.devName,
            projectPath: this.projectPath,
            password: this.currentPassword,
            branch: this.currentBranch,
            timestamp: now(),
          });
        }

        resolve();
      });

      this.ws.on("message", (raw) => {
        const data = typeof raw === "string" ? raw : raw.toString("utf-8");
        const msg = decodeServerMessage(data);
        if (msg) {
          this.handleServerMessage(msg);
          this.dispatchToPendingListeners(msg);
          this.onMessageHandler(msg);
        }
      });

      this.ws.on("close", () => {
        this.stopHeartbeat();
        if (this.shouldReconnect) {
          this.onDisconnect();
          this.scheduleReconnect();
        }
      });

      this.ws.on("error", (err) => {
        if (this.reconnectAttempts === 0) {
          this.shouldReconnect = false;
          reject(new Error(`Failed to connect to relay at ${url}: ${err.message}`));
        } else {
          console.error(`[CodeHive Client] reconnect attempt ${this.reconnectAttempts} failed: ${err.message}`);
        }
      });
    });
  }

  disconnect(): void {
    this.shouldReconnect = false;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.stopHeartbeat();

    if (this.currentRoom) {
      this.send({
        type: "leave_room",
        code: this.currentRoom,
        deviceId: this.deviceId,
        timestamp: now(),
      });
    }

    if (this.ws) {
      this.ws.close(1000, "Client disconnect");
      this.ws = null;
    }

    this.currentRoom = null;
    this.pendingListeners = [];
    this.fileChangeQueue = [];
  }

  // -----------------------------------------------------------------------
  // Room operations
  // -----------------------------------------------------------------------

  createRoom(password?: string, isPublic?: boolean, expiresInHours?: number): void {
    this.currentPassword = password;
    this.send({
      type: "create_room",
      deviceId: this.deviceId,
      name: this.devName,
      projectPath: this.projectPath,
      password,
      isPublic,
      expiresInHours,
      branch: this.currentBranch,
      timestamp: now(),
    });
  }

  joinRoom(code: RoomCode, password?: string): void {
    this.currentPassword = password;
    this.send({
      type: "join_room",
      code,
      deviceId: this.deviceId,
      name: this.devName,
      projectPath: this.projectPath,
      password,
      branch: this.currentBranch,
      timestamp: now(),
    });
  }

  leaveRoom(): void {
    if (!this.currentRoom) return;

    this.send({
      type: "leave_room",
      code: this.currentRoom,
      deviceId: this.deviceId,
      timestamp: now(),
    });

    this.currentRoom = null;
    this.currentPassword = undefined;
  }

  // -----------------------------------------------------------------------
  // File operations
  // -----------------------------------------------------------------------

  reportFileChange(change: FileChange): void {
    if (!this.currentRoom || !this.connected) {
      if (this.currentRoom) {
        this.fileChangeQueue.push(change);
        if (this.fileChangeQueue.length > RelayClient.MAX_QUEUED_CHANGES) {
          this.fileChangeQueue.shift();
        }
      }
      return;
    }

    this.send({
      type: "file_change",
      code: this.currentRoom,
      deviceId: this.deviceId,
      change,
      timestamp: now(),
    });
  }

  declareWorkingOn(files: RelativePath[]): void {
    if (!this.currentRoom) return;

    this.send({
      type: "declare_working",
      code: this.currentRoom,
      deviceId: this.deviceId,
      name: this.devName,
      files,
      timestamp: now(),
    });
  }

  // -----------------------------------------------------------------------
  // Chat
  // -----------------------------------------------------------------------

  sendChatMessage(content: string): void {
    if (!this.currentRoom) return;

    this.send({
      type: "chat_message",
      code: this.currentRoom,
      deviceId: this.deviceId,
      name: this.devName,
      content,
      timestamp: now(),
    });
  }

  // -----------------------------------------------------------------------
  // Status
  // -----------------------------------------------------------------------

  requestStatus(): void {
    if (!this.currentRoom) return;

    this.send({
      type: "request_status",
      code: this.currentRoom,
      deviceId: this.deviceId,
      timestamp: now(),
    });
  }

  // -----------------------------------------------------------------------
  // NEW: Typing indicators
  // -----------------------------------------------------------------------

  declareTyping(file: RelativePath | null): void {
    if (!this.currentRoom) return;

    this.send({
      type: "declare_typing",
      code: this.currentRoom,
      deviceId: this.deviceId,
      name: this.devName,
      file,
      timestamp: now(),
    });
  }

  // -----------------------------------------------------------------------
  // NEW: File locking
  // -----------------------------------------------------------------------

  lockFile(file: RelativePath): void {
    if (!this.currentRoom) return;

    this.send({
      type: "lock_file",
      code: this.currentRoom,
      deviceId: this.deviceId,
      name: this.devName,
      file,
      timestamp: now(),
    });
  }

  unlockFile(file: RelativePath): void {
    if (!this.currentRoom) return;

    this.send({
      type: "unlock_file",
      code: this.currentRoom,
      deviceId: this.deviceId,
      name: this.devName,
      file,
      timestamp: now(),
    });
  }

  // -----------------------------------------------------------------------
  // NEW: Cursor sharing
  // -----------------------------------------------------------------------

  updateCursor(cursor: CursorPosition | null): void {
    if (!this.currentRoom) return;

    this.send({
      type: "update_cursor",
      code: this.currentRoom,
      deviceId: this.deviceId,
      name: this.devName,
      cursor,
      timestamp: now(),
    });
  }

  // -----------------------------------------------------------------------
  // NEW: Terminal sharing
  // -----------------------------------------------------------------------

  shareTerminal(terminal: SharedTerminal): void {
    if (!this.currentRoom) return;

    this.send({
      type: "share_terminal",
      code: this.currentRoom,
      deviceId: this.deviceId,
      name: this.devName,
      terminal,
      timestamp: now(),
    });
  }

  // -----------------------------------------------------------------------
  // NEW: Room discovery
  // -----------------------------------------------------------------------

  listRooms(): void {
    this.send({
      type: "list_rooms",
      deviceId: this.deviceId,
      timestamp: now(),
    });
  }

  // -----------------------------------------------------------------------
  // NEW: Timeline
  // -----------------------------------------------------------------------

  getTimeline(limit?: number): void {
    if (!this.currentRoom) return;

    this.send({
      type: "get_timeline",
      code: this.currentRoom,
      deviceId: this.deviceId,
      limit,
      timestamp: now(),
    });
  }

  // -----------------------------------------------------------------------
  // NEW: Webhook
  // -----------------------------------------------------------------------

  setWebhook(webhook: WebhookConfig | null): void {
    if (!this.currentRoom) return;

    this.send({
      type: "set_webhook",
      code: this.currentRoom,
      deviceId: this.deviceId,
      webhook,
      timestamp: now(),
    });
  }

  // -----------------------------------------------------------------------
  // NEW: Room visibility
  // -----------------------------------------------------------------------

  setRoomVisibility(isPublic: boolean): void {
    if (!this.currentRoom) return;

    this.send({
      type: "set_room_visibility",
      code: this.currentRoom,
      deviceId: this.deviceId,
      isPublic,
      timestamp: now(),
    });
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private send(msg: AnyClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(encodeClientMessage(msg));
    }
  }

  private handleServerMessage(msg: AnyServerMessage): void {
    switch (msg.type) {
      case "room_created":
        this.currentRoom = msg.room.code;
        break;
      case "room_joined":
        this.currentRoom = msg.room.code;
        break;
      case "room_left":
        this.currentRoom = null;
        break;
    }
  }

  private dispatchToPendingListeners(msg: AnyServerMessage): void {
    const toRemove: number[] = [];
    for (let i = 0; i < this.pendingListeners.length; i++) {
      const listener = this.pendingListeners[i]!;
      if (listener.predicate(msg)) {
        listener.callback(msg);
        toRemove.push(i);
      }
    }
    for (let i = toRemove.length - 1; i >= 0; i--) {
      this.pendingListeners.splice(toRemove[i]!, 1);
    }
  }

  private flushFileChangeQueue(): void {
    if (!this.currentRoom || this.fileChangeQueue.length === 0) return;

    for (const change of this.fileChangeQueue) {
      this.send({
        type: "file_change",
        code: this.currentRoom,
        deviceId: this.deviceId,
        change,
        timestamp: now(),
      });
    }
    this.fileChangeQueue = [];
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.currentRoom) {
        this.send({
          type: "heartbeat",
          code: this.currentRoom,
          deviceId: this.deviceId,
          status: this.currentStatus,
          branch: this.currentBranch,
          timestamp: now(),
        });
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect) return;
    if (this.reconnectAttempts >= 10) {
      console.error("[CodeHive Client] max reconnection attempts reached");
      return;
    }

    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 30_000);
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      if (!this.shouldReconnect) return;
      this.connect().catch(() => {});
    }, delay);
  }
}
