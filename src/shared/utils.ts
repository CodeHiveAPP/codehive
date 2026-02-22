/**
 * Shared utility functions for CodeHive.
 */

import { nanoid } from "nanoid";
import type { DeviceId, RoomCode } from "./types.js";

/**
 * Generate a human-readable room code.
 *
 * Format: `HIVE-XXXX` where X is an uppercase alphanumeric character.
 * Uses a reduced alphabet to avoid ambiguous characters (0/O, 1/I/L).
 */
export function generateRoomCode(): RoomCode {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `HIVE-${code}`;
}

/**
 * Generate a unique device identifier for this machine + session.
 */
export function generateDeviceId(): DeviceId {
  return nanoid(16);
}

/**
 * Validate that a string looks like a valid room code.
 */
export function isValidRoomCode(code: string): code is RoomCode {
  return /^HIVE-[A-Z2-9]{4}$/.test(code);
}

/**
 * Get the current Unix timestamp in milliseconds.
 */
export function now(): number {
  return Date.now();
}

/**
 * Format a timestamp into a human-readable time string.
 */
export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

/**
 * Truncate a string to a maximum length, adding ellipsis if needed.
 */
export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + "...";
}

/**
 * Simple debounce utility for file watcher events.
 */
export function debounce<T extends (...args: never[]) => void>(
  fn: T,
  delayMs: number,
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, delayMs);
  };
}

/**
 * Compute a simple line-based diff summary between two strings.
 * Returns the diff as a unified-style string and line counts.
 */
export function computeDiffSummary(
  oldContent: string,
  newContent: string,
): { diff: string; linesAdded: number; linesRemoved: number } {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");

  const added: string[] = [];
  const removed: string[] = [];

  const oldSet = new Set(oldLines);
  const newSet = new Set(newLines);

  for (const line of newLines) {
    if (!oldSet.has(line)) added.push(line);
  }
  for (const line of oldLines) {
    if (!newSet.has(line)) removed.push(line);
  }

  const parts: string[] = [];
  for (const line of removed) parts.push(`- ${line}`);
  for (const line of added) parts.push(`+ ${line}`);

  return {
    diff: parts.join("\n"),
    linesAdded: added.length,
    linesRemoved: removed.length,
  };
}
