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
  DeviceId,
  DevName,
  DevStatus,
  FileChange,
  RelativePath,
  RoomCode,
} from "../shared/types.js";
import { now } from "../shared/utils.js";

export type ServerEventHandler = (msg: AnyServerMessage) => void;

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

  private onMessage: ServerEventHandler;
  private onConnect: () => void;
  private onDisconnect: () => void;

  constructor(options: RelayClientOptions) {
    this.host = options.host ?? DEFAULT_RELAY_HOST;
    this.port = options.port ?? DEFAULT_RELAY_PORT;
    this.deviceId = options.deviceId;
    this.devName = options.devName;
    this.projectPath = options.projectPath;
    this.onMessage = options.onMessage ?? (() => {});
    this.onConnect = options.onConnect ?? (() => {});
    this.onDisconnect = options.onDisconnect ?? (() => {});
  }

  /** Whether the client is currently connected to the relay. */
  get connected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /** The room this client is currently in, or null. */
  get roomCode(): RoomCode | null {
    return this.currentRoom;
  }

  /**
   * Connect to the relay server.
   */
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
        resolve();
      });

      this.ws.on("message", (raw) => {
        const data = typeof raw === "string" ? raw : raw.toString("utf-8");
        const msg = decodeServerMessage(data);
        if (msg) {
          this.handleServerMessage(msg);
          this.onMessage(msg);
        }
      });

      this.ws.on("close", () => {
        this.stopHeartbeat();
        this.onDisconnect();
        this.scheduleReconnect();
      });

      this.ws.on("error", (err) => {
        if (this.reconnectAttempts === 0) {
          reject(new Error(`Failed to connect to relay at ${url}: ${err.message}`));
        }
      });
    });
  }

  /**
   * Disconnect from the relay server.
   */
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
  }

  /**
   * Create a new collaboration room.
   */
  createRoom(): void {
    this.send({
      type: "create_room",
      deviceId: this.deviceId,
      name: this.devName,
      projectPath: this.projectPath,
      timestamp: now(),
    });
  }

  /**
   * Join an existing room by code.
   */
  joinRoom(code: RoomCode): void {
    this.send({
      type: "join_room",
      code,
      deviceId: this.deviceId,
      name: this.devName,
      projectPath: this.projectPath,
      timestamp: now(),
    });
  }

  /**
   * Leave the current room.
   */
  leaveRoom(): void {
    if (!this.currentRoom) return;

    this.send({
      type: "leave_room",
      code: this.currentRoom,
      deviceId: this.deviceId,
      timestamp: now(),
    });

    this.currentRoom = null;
  }

  /**
   * Report a file change to teammates.
   */
  reportFileChange(change: FileChange): void {
    if (!this.currentRoom) return;

    this.send({
      type: "file_change",
      code: this.currentRoom,
      deviceId: this.deviceId,
      change,
      timestamp: now(),
    });
  }

  /**
   * Declare which files you are currently working on.
   */
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

  /**
   * Send a chat message to all room members.
   */
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

  /**
   * Request the current room status from the relay.
   */
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

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.currentRoom) {
        this.send({
          type: "heartbeat",
          code: this.currentRoom,
          deviceId: this.deviceId,
          status: this.currentStatus,
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
      this.connect().catch(() => {
        // Will retry via the close handler
      });
    }, delay);
  }
}
