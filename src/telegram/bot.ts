/**
 * CodeHive Telegram Bot
 *
 * Bridges a Telegram chat and a CodeHive room bidirectionally.
 * Uses long polling (getUpdates) for Telegram and WebSocket (RelayClient) for CodeHive.
 *
 * Lifecycle:
 *   1. start() validates the bot token, connects to the relay
 *   2. Polling loop calls getUpdates repeatedly
 *   3. Incoming Telegram commands are parsed and dispatched
 *   4. Relay events (via onMessage callback) are formatted and sent to Telegram
 *   5. stop() gracefully shuts down both connections
 */

import { TelegramApi } from "./api.js";
import type { TelegramMessage } from "./types.js";
import { RelayClient } from "../mcp/client.js";
import type { AnyServerMessage, RoomInfo, TimelineEvent } from "../shared/types.js";
import { generateDeviceId, isValidRoomCode } from "../shared/utils.js";
import {
  DEFAULT_RELAY_HOST,
  DEFAULT_RELAY_PORT,
} from "../shared/protocol.js";
import * as fmt from "./formatter.js";

export interface TelegramBotOptions {
  token: string;
  relayHost?: string;
  relayPort?: number;
  devName?: string;
  projectPath?: string;
  /** Pre-configured chat ID (auto-detected from first message if omitted). */
  chatId?: number;
}

export class TelegramBot {
  private api: TelegramApi;
  private client: RelayClient;
  private chatId: number | null;
  private running = false;
  private pollOffset: number | undefined;
  private botName = "CodeHive Bot";
  private lastRoomInfo: RoomInfo | null = null;

  private readonly token: string;
  private readonly relayHost: string;
  private readonly relayPort: number;
  private readonly devName: string;
  private readonly projectPath: string;

  constructor(options: TelegramBotOptions) {
    this.token = options.token;
    this.relayHost = options.relayHost ?? DEFAULT_RELAY_HOST;
    this.relayPort = options.relayPort ?? DEFAULT_RELAY_PORT;
    this.devName = options.devName ?? "TelegramBot";
    this.projectPath = options.projectPath ?? process.cwd();
    this.chatId = options.chatId ?? null;

    this.api = new TelegramApi(this.token);

    this.client = new RelayClient({
      host: this.relayHost,
      port: this.relayPort,
      deviceId: generateDeviceId(),
      devName: this.devName,
      projectPath: this.projectPath,
      onMessage: (msg) => this.handleRelayEvent(msg),
      onConnect: () => {
        console.log(`[CodeHive Telegram] connected to relay at ${this.relayHost}:${this.relayPort}`);
      },
      onDisconnect: () => {
        console.log("[CodeHive Telegram] disconnected from relay, will reconnect...");
      },
    });
  }

  // -------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------

  async start(): Promise<void> {
    console.log("[CodeHive Telegram] validating bot token...");
    const me = await this.api.getMe();
    this.botName = me.first_name ?? "CodeHive Bot";
    console.log(`[CodeHive Telegram] bot authenticated as @${me.username ?? me.first_name}`);

    console.log(`[CodeHive Telegram] connecting to relay at ${this.relayHost}:${this.relayPort}...`);
    try {
      await this.client.connect();
    } catch {
      console.error("[CodeHive Telegram] relay not available, will retry on reconnect");
    }

    this.running = true;
    console.log("[CodeHive Telegram] starting long polling...");
    void this.pollLoop();

    if (this.chatId) {
      await this.sendToChat(`<b>CodeHive Bot started!</b>\nConnected to relay at ${this.relayHost}:${this.relayPort}`);
    }
  }

  async stop(): Promise<void> {
    console.log("[CodeHive Telegram] shutting down...");
    this.running = false;

    if (this.chatId) {
      await this.sendToChat("<b>CodeHive Bot shutting down.</b>").catch(() => {});
    }

    this.client.disconnect();
  }

  // -------------------------------------------------------------------
  // Long Polling Loop
  // -------------------------------------------------------------------

  private async pollLoop(): Promise<void> {
    while (this.running) {
      try {
        const updates = await this.api.getUpdates(this.pollOffset, 30);

        for (const update of updates) {
          this.pollOffset = update.update_id + 1;

          if (update.message?.text) {
            await this.handleTelegramMessage(update.message);
          }
        }
      } catch (err) {
        if (!this.running) break;

        const message = err instanceof Error ? err.message : String(err);
        console.error(`[CodeHive Telegram] poll error: ${message}`);

        // Back off on errors
        await sleep(5000);
      }
    }
  }

  // -------------------------------------------------------------------
  // Telegram → CodeHive (Command Handling)
  // -------------------------------------------------------------------

  private async handleTelegramMessage(msg: TelegramMessage): Promise<void> {
    const text = msg.text ?? "";
    const chatId = msg.chat.id;

    // Auto-detect chat ID from first message
    if (this.chatId === null) {
      this.chatId = chatId;
      console.log(`[CodeHive Telegram] auto-detected chat ID: ${chatId}`);
    }

    // Only respond to the configured chat
    if (chatId !== this.chatId) return;

    // Must be a command
    if (!text.startsWith("/")) return;

    const parts = text.split(/\s+/);
    const command = parts[0]!.toLowerCase().replace(/@\w+$/, ""); // strip @botname
    const args = parts.slice(1);

    switch (command) {
      case "/start":
        await this.cmdStart();
        break;
      case "/join":
        await this.cmdJoin(args);
        break;
      case "/leave":
        await this.cmdLeave();
        break;
      case "/status":
        await this.cmdStatus();
        break;
      case "/chat":
        await this.cmdChat(args.join(" "));
        break;
      case "/files":
        await this.cmdFiles();
        break;
      case "/timeline":
        await this.cmdTimeline();
        break;
      case "/locks":
        await this.cmdLocks();
        break;
      case "/help":
        await this.cmdHelp();
        break;
      default:
        await this.sendToChat(`Unknown command: <code>${fmt.escapeHtml(command)}</code>\nUse /help for a list of commands.`);
    }
  }

  private async cmdStart(): Promise<void> {
    await this.sendToChat(fmt.formatWelcome(this.botName));
  }

  private async cmdJoin(args: string[]): Promise<void> {
    if (args.length < 1) {
      await this.sendToChat("Usage: /join HIVE-XXXXXX [password]");
      return;
    }

    const code = args[0]!.toUpperCase().trim();
    const password = args[1];

    if (!isValidRoomCode(code)) {
      await this.sendToChat(`Invalid room code: <code>${fmt.escapeHtml(code)}</code>\nExpected format: HIVE-XXXXXX`);
      return;
    }

    if (this.client.roomCode) {
      await this.sendToChat(`Already in room <b>${this.client.roomCode}</b>. Use /leave first.`);
      return;
    }

    if (!this.client.connected) {
      await this.sendToChat("Not connected to relay server. Waiting for reconnection...");
      return;
    }

    const roomInfo = await new Promise<RoomInfo | null>((resolve) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        unsub();
        resolve(null);
      }, 10_000);

      const unsub = this.client.onceMessage(
        (msg) => msg.type === "room_joined" || msg.type === "error",
        (msg) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          if (msg.type === "room_joined") {
            resolve((msg as { room: RoomInfo }).room);
          } else {
            resolve(null);
          }
        },
      );

      this.client.joinRoom(code, password);
    });

    if (roomInfo) {
      this.lastRoomInfo = roomInfo;
      await this.sendToChat(
        `\u{2705} <b>Joined room ${roomInfo.code}</b>\n\n` + fmt.formatRoomStatus(roomInfo),
      );
    } else {
      await this.sendToChat(`Failed to join room <code>${fmt.escapeHtml(code)}</code>. Check the code and password.`);
    }
  }

  private async cmdLeave(): Promise<void> {
    if (!this.client.roomCode) {
      await this.sendToChat("Not currently in any room.");
      return;
    }
    const code = this.client.roomCode;
    this.client.leaveRoom();
    this.lastRoomInfo = null;
    await this.sendToChat(`Left room <b>${code}</b>.`);
  }

  private async cmdStatus(): Promise<void> {
    if (!this.client.roomCode) {
      await this.sendToChat("Not in a room. Use /join HIVE-XXXXXX to join one.");
      return;
    }

    const roomInfo = await this.fetchStatus();
    if (roomInfo) {
      this.lastRoomInfo = roomInfo;
      await this.sendToChat(fmt.formatRoomStatus(roomInfo));
    } else {
      await this.sendToChat("Could not retrieve room status.");
    }
  }

  private async cmdChat(message: string): Promise<void> {
    if (!message.trim()) {
      await this.sendToChat("Usage: /chat message");
      return;
    }
    if (!this.client.roomCode) {
      await this.sendToChat("Not in a room. Use /join first.");
      return;
    }
    this.client.sendChatMessage(message);
    await this.sendToChat("Message sent to room.");
  }

  private async cmdFiles(): Promise<void> {
    if (!this.client.roomCode) {
      await this.sendToChat("Not in a room. Use /join first.");
      return;
    }

    const roomInfo = await this.fetchStatus();
    if (roomInfo) {
      await this.sendToChat(fmt.formatRecentChanges(roomInfo.recentChanges));
    } else {
      await this.sendToChat("Could not retrieve file changes.");
    }
  }

  private async cmdTimeline(): Promise<void> {
    if (!this.client.roomCode) {
      await this.sendToChat("Not in a room. Use /join first.");
      return;
    }

    const events = await new Promise<TimelineEvent[] | null>((resolve) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        unsub();
        resolve(this.lastRoomInfo?.timeline ?? null);
      }, 5_000);

      const unsub = this.client.onceMessage(
        (msg) => msg.type === "timeline",
        (msg) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          resolve((msg as { events: TimelineEvent[] }).events);
        },
      );

      this.client.getTimeline(30);
    });

    if (events) {
      await this.sendToChat(fmt.formatTimeline(events));
    } else {
      await this.sendToChat("Could not retrieve timeline.");
    }
  }

  private async cmdLocks(): Promise<void> {
    if (!this.client.roomCode) {
      await this.sendToChat("Not in a room. Use /join first.");
      return;
    }

    const roomInfo = await this.fetchStatus();
    if (roomInfo) {
      await this.sendToChat(fmt.formatLocks(roomInfo.locks));
    } else {
      await this.sendToChat("Could not retrieve lock information.");
    }
  }

  private async cmdHelp(): Promise<void> {
    await this.sendToChat(fmt.formatHelp());
  }

  /** Request fresh room status and wait for response. */
  private fetchStatus(): Promise<RoomInfo | null> {
    return new Promise<RoomInfo | null>((resolve) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        unsub();
        resolve(this.lastRoomInfo);
      }, 5_000);

      const unsub = this.client.onceMessage(
        (msg) => msg.type === "room_status",
        (msg) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          const status = msg as { room: RoomInfo };
          this.lastRoomInfo = status.room;
          resolve(status.room);
        },
      );

      this.client.requestStatus();
    });
  }

  // -------------------------------------------------------------------
  // CodeHive → Telegram (Event Forwarding)
  // -------------------------------------------------------------------

  private handleRelayEvent(msg: AnyServerMessage): void {
    if (this.chatId === null) return;

    let text: string | null = null;

    switch (msg.type) {
      case "member_joined":
        text = fmt.formatMemberJoined(msg.member.name, msg.member.branch);
        break;

      case "member_left":
        text = fmt.formatMemberLeft(msg.member.name);
        break;

      case "file_changed":
        text = fmt.formatFileChange(msg.change);
        break;

      case "chat_received":
        text = fmt.formatChatMessage(msg.from, msg.content);
        break;

      case "conflict_warning":
        text = fmt.formatConflictWarning(msg.file, msg.authors, msg.message);
        break;

      case "file_locked":
        text = fmt.formatFileLocked(msg.lock);
        break;

      case "file_unlocked":
        text = fmt.formatFileUnlocked(msg.file, msg.unlockedBy);
        break;

      case "terminal_shared":
        text = fmt.formatTerminalShared(
          msg.terminal.sharedBy,
          msg.terminal.command,
          msg.terminal.output,
          msg.terminal.exitCode,
        );
        break;

      case "branch_warning":
        text = fmt.formatBranchWarning(msg.message, msg.branches);
        break;

      case "room_status":
        this.lastRoomInfo = msg.room;
        break;

      // Intentionally not forwarded (too noisy):
      // typing_indicator, cursor_updated, heartbeat_ack, member_updated
    }

    if (text) {
      void this.sendToChat(text).catch((err) => {
        console.error(`[CodeHive Telegram] send failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
  }

  // -------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------

  private async sendToChat(text: string): Promise<void> {
    if (this.chatId === null) return;

    // Telegram has a 4096-character limit per message
    if (text.length > 4000) {
      text = text.slice(0, 3990) + "\n...";
    }

    await this.api.sendMessage(this.chatId, text);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
