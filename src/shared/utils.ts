/**
 * Shared utility functions for CodeHive.
 */

import { nanoid } from "nanoid";
import { randomInt } from "node:crypto";
import type { DeviceId, RoomCode } from "./types.js";

/** Reduced alphabet — no ambiguous characters (0/O, 1/I/L). */
const ROOM_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/**
 * Generate a human-readable room code.
 *
 * Format: `HIVE-XXXXXX` where X is an uppercase alphanumeric character.
 * 6 chars = 31^6 = ~887 million possible codes.
 * Uses crypto.randomInt for secure randomness.
 */
export function generateRoomCode(): RoomCode {
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += ROOM_ALPHABET[randomInt(ROOM_ALPHABET.length)];
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
 * Matches exact alphabet used by generateRoomCode.
 */
export function isValidRoomCode(code: string): code is RoomCode {
  return /^HIVE-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/.test(code);
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
 * Compute a line-based diff summary between two strings.
 * Uses index-based comparison to correctly handle duplicate lines and ordering.
 */
export function computeDiffSummary(
  oldContent: string,
  newContent: string,
): { diff: string; linesAdded: number; linesRemoved: number } {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");

  // For very large files, skip detailed diff to avoid O(n²) blocking
  const MAX_DIFF_LINES = 2000;
  if (oldLines.length > MAX_DIFF_LINES || newLines.length > MAX_DIFF_LINES) {
    const linesAdded = Math.max(0, newLines.length - oldLines.length);
    const linesRemoved = Math.max(0, oldLines.length - newLines.length);
    // If line counts are equal but content differs, report at least 1 changed
    const changed = linesAdded === 0 && linesRemoved === 0 ? 1 : 0;
    return {
      diff: `(file too large for detailed diff: ${oldLines.length} → ${newLines.length} lines)`,
      linesAdded: linesAdded + changed,
      linesRemoved: linesRemoved + changed,
    };
  }

  const added: string[] = [];
  const removed: string[] = [];

  // Walk through both arrays comparing line by line
  let oi = 0;
  let ni = 0;

  while (oi < oldLines.length || ni < newLines.length) {
    if (oi >= oldLines.length) {
      // Remaining new lines are all additions
      added.push(newLines[ni]!);
      ni++;
    } else if (ni >= newLines.length) {
      // Remaining old lines are all removals
      removed.push(oldLines[oi]!);
      oi++;
    } else if (oldLines[oi] === newLines[ni]) {
      // Lines match, advance both
      oi++;
      ni++;
    } else {
      // Lines differ — look ahead to find if the old line exists later in new
      const lookAheadNew = newLines.indexOf(oldLines[oi]!, ni + 1);
      const lookAheadOld = oldLines.indexOf(newLines[ni]!, oi + 1);

      if (lookAheadNew !== -1 && (lookAheadOld === -1 || lookAheadNew - ni <= lookAheadOld - oi)) {
        // The current new lines are additions until we find the match
        while (ni < lookAheadNew) {
          added.push(newLines[ni]!);
          ni++;
        }
      } else if (lookAheadOld !== -1) {
        // The current old lines are removals until we find the match
        while (oi < lookAheadOld) {
          removed.push(oldLines[oi]!);
          oi++;
        }
      } else {
        // No match found in either direction — treat as remove + add
        removed.push(oldLines[oi]!);
        added.push(newLines[ni]!);
        oi++;
        ni++;
      }
    }
  }

  const parts: string[] = [];
  for (const line of removed.slice(0, 10)) parts.push(`- ${line}`);
  for (const line of added.slice(0, 10)) parts.push(`+ ${line}`);
  if (removed.length > 10 || added.length > 10) {
    parts.push(`... (${removed.length} removed, ${added.length} added total)`);
  }

  return {
    diff: parts.join("\n"),
    linesAdded: added.length,
    linesRemoved: removed.length,
  };
}
