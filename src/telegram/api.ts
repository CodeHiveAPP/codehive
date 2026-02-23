/**
 * Telegram Bot API client using native fetch().
 * Zero dependencies. Node 20+ required.
 */

import type {
  TelegramApiResponse,
  TelegramUpdate,
  TelegramMessage,
  TelegramUser,
} from "./types.js";

const BASE_URL = "https://api.telegram.org";

export class TelegramApi {
  private readonly baseUrl: string;

  constructor(token: string) {
    this.baseUrl = `${BASE_URL}/bot${token}`;
  }

  /** Verify the bot token is valid and return bot info. */
  async getMe(): Promise<TelegramUser> {
    return this.call<TelegramUser>("getMe");
  }

  /**
   * Long-poll for updates.
   * @param offset - Pass the last update_id + 1 to acknowledge previous updates
   * @param timeout - Long poll timeout in seconds (Telegram server holds the connection)
   */
  async getUpdates(offset?: number, timeout = 30): Promise<TelegramUpdate[]> {
    const params: Record<string, string> = {
      timeout: String(timeout),
      allowed_updates: JSON.stringify(["message"]),
    };
    if (offset !== undefined) {
      params["offset"] = String(offset);
    }
    return this.call<TelegramUpdate[]>("getUpdates", params);
  }

  /**
   * Send an HTML-formatted message to a chat.
   * Telegram supports: <b>, <i>, <u>, <s>, <code>, <pre>, <a href="">, <blockquote>.
   */
  async sendMessage(chatId: number, text: string): Promise<TelegramMessage> {
    return this.call<TelegramMessage>("sendMessage", {
      chat_id: String(chatId),
      text,
      parse_mode: "HTML",
      disable_web_page_preview: "true",
    });
  }

  /** Generic API call helper with timeout and error handling. */
  private async call<T>(method: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${this.baseUrl}/${method}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v);
      }
    }

    // Longer timeout for getUpdates (long polling), shorter for other methods
    const timeoutMs = method === "getUpdates" ? 35_000 : 10_000;

    const response = await fetch(url.toString(), {
      signal: AbortSignal.timeout(timeoutMs),
    });

    const body = (await response.json()) as TelegramApiResponse<T>;

    if (!body.ok) {
      throw new Error(`Telegram API error: ${body.description ?? "unknown"} (${body.error_code ?? 0})`);
    }

    return body.result as T;
  }
}
