/**
 * Minimal Telegram Bot API types for CodeHive integration.
 * Only the subset needed for long polling and sending messages.
 */

/** Telegram User object. */
export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}

/** Telegram Chat object. */
export interface TelegramChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

/** Telegram Message object. */
export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  entities?: TelegramMessageEntity[];
}

/** Telegram MessageEntity (for detecting /commands). */
export interface TelegramMessageEntity {
  type: string;
  offset: number;
  length: number;
}

/** Telegram Update object from getUpdates. */
export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

/** Generic Telegram API response envelope. */
export interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}
