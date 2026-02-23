/**
 * Format CodeHive events as Telegram HTML messages.
 *
 * Telegram HTML supports: <b>, <i>, <u>, <s>, <code>, <pre>, <a href="">, <blockquote>.
 * All other content must have HTML special chars escaped.
 */

import type {
  FileChange,
  RoomInfo,
  FileLock,
  TimelineEvent,
} from "../shared/types.js";
import { formatTime, truncate } from "../shared/utils.js";

/** Escape HTML special characters for Telegram. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Format a file change event. */
export function formatFileChange(change: FileChange): string {
  const path = escapeHtml(change.path);
  const author = escapeHtml(change.author);
  const isBinary = change.sizeAfter !== undefined && change.sizeAfter !== null;

  let stats: string;
  if (isBinary) {
    const kb = Math.round((change.sizeAfter as number) / 1024);
    stats = `${kb}KB`;
  } else {
    stats = `<code>+${change.linesAdded} -${change.linesRemoved}</code>`;
  }

  const lines: string[] = [
    `\u{1F4DD} <b>${author}</b> ${change.type}d <code>${path}</code> (${stats})`,
  ];

  if (change.diff) {
    const diffLines = change.diff.split("\n").slice(0, 8);
    const escaped = diffLines.map((l) => escapeHtml(l)).join("\n");
    lines.push(`<pre>${escaped}</pre>`);
  }

  return lines.join("\n");
}

/** Format a member joined event. */
export function formatMemberJoined(name: string, branch?: string): string {
  const branchTag = branch ? ` [${escapeHtml(branch)}]` : "";
  return `\u{2705} <b>${escapeHtml(name)}</b> joined the room${branchTag}`;
}

/** Format a member left event. */
export function formatMemberLeft(name: string): string {
  return `\u{1F44B} <b>${escapeHtml(name)}</b> left the room`;
}

/** Format a chat message. */
export function formatChatMessage(from: string, content: string): string {
  return `\u{1F4AC} <b>${escapeHtml(from)}</b>:\n<blockquote>${escapeHtml(truncate(content, 500))}</blockquote>`;
}

/** Format a conflict warning. */
export function formatConflictWarning(file: string, authors: string[], message: string): string {
  return `\u{26A0}\u{FE0F} <b>CONFLICT WARNING</b>\n<code>${escapeHtml(file)}</code>\n${escapeHtml(message)}`;
}

/** Format file locked event. */
export function formatFileLocked(lock: FileLock): string {
  return `\u{1F512} <b>${escapeHtml(lock.lockedBy)}</b> locked <code>${escapeHtml(lock.file)}</code>`;
}

/** Format file unlocked event. */
export function formatFileUnlocked(file: string, unlockedBy: string): string {
  return `\u{1F513} <b>${escapeHtml(unlockedBy)}</b> unlocked <code>${escapeHtml(file)}</code>`;
}

/** Format terminal shared event. */
export function formatTerminalShared(
  sharedBy: string,
  command: string,
  output: string,
  exitCode: number | null,
): string {
  const truncOutput = truncate(output, 500);
  const exitStr = exitCode !== null ? ` (exit ${exitCode})` : "";
  return [
    `\u{1F4BB} <b>${escapeHtml(sharedBy)}</b> shared terminal${exitStr}:`,
    `<pre>$ ${escapeHtml(command)}\n${escapeHtml(truncOutput)}</pre>`,
  ].join("\n");
}

/** Format a branch warning. */
export function formatBranchWarning(message: string, branches: Record<string, string>): string {
  const branchList = Object.entries(branches)
    .map(([name, branch]) => `  ${escapeHtml(name)}: <code>${escapeHtml(branch)}</code>`)
    .join("\n");
  return `\u{26A0}\u{FE0F} <b>BRANCH WARNING</b>\n${escapeHtml(message)}\n${branchList}`;
}

/** Format room status for /status command response. */
export function formatRoomStatus(room: RoomInfo): string {
  const lines: string[] = [
    `<b>Room ${escapeHtml(room.code)}</b>`,
    `Members: ${room.members.length}`,
    ``,
  ];

  for (const member of room.members) {
    const branch = member.branch ? ` [${escapeHtml(member.branch)}]` : "";
    const icon = member.status === "active" ? "\u{1F7E2}" : member.status === "idle" ? "\u{1F7E1}" : "\u{26AB}";
    lines.push(`${icon} <b>${escapeHtml(member.name)}</b>${branch}`);
    if (member.workingOn.length > 0) {
      lines.push(`   Working on: ${member.workingOn.map((f) => `<code>${escapeHtml(f)}</code>`).join(", ")}`);
    }
  }

  if (room.locks.length > 0) {
    lines.push(``);
    lines.push(`<b>Locked files:</b>`);
    for (const lock of room.locks) {
      lines.push(`  \u{1F512} <code>${escapeHtml(lock.file)}</code> by ${escapeHtml(lock.lockedBy)}`);
    }
  }

  return lines.join("\n");
}

/** Format locks list for /locks command. */
export function formatLocks(locks: FileLock[]): string {
  if (locks.length === 0) {
    return "No files are currently locked.";
  }
  const lines = ["<b>Locked files:</b>"];
  for (const lock of locks) {
    lines.push(`  \u{1F512} <code>${escapeHtml(lock.file)}</code> by <b>${escapeHtml(lock.lockedBy)}</b> (since ${formatTime(lock.lockedAt)})`);
  }
  return lines.join("\n");
}

/** Format recent file changes for /files command. */
export function formatRecentChanges(changes: FileChange[]): string {
  if (changes.length === 0) {
    return "No recent file changes.";
  }
  const lines = ["<b>Recent file changes:</b>"];
  for (const change of changes.slice(-15)) {
    const time = formatTime(change.timestamp);
    const isBinary = change.sizeAfter !== undefined && change.sizeAfter !== null;
    const stats = isBinary
      ? `${Math.round((change.sizeAfter as number) / 1024)}KB`
      : `+${change.linesAdded} -${change.linesRemoved}`;
    lines.push(`[${time}] <b>${escapeHtml(change.author)}</b> ${change.type}d <code>${escapeHtml(change.path)}</code> (${stats})`);
  }
  return lines.join("\n");
}

/** Format timeline events for /timeline command. */
export function formatTimeline(events: TimelineEvent[]): string {
  if (events.length === 0) {
    return "No activity in the timeline yet.";
  }
  const lines = ["<b>Activity Timeline:</b>"];
  for (const event of events) {
    const time = formatTime(event.timestamp);
    const icon = timelineIcon(event.type);
    lines.push(`${icon} [${time}] ${escapeHtml(event.detail)}`);
  }
  return lines.join("\n");
}

function timelineIcon(type: TimelineEvent["type"]): string {
  switch (type) {
    case "join": return "\u{2705}";
    case "leave": return "\u{1F44B}";
    case "chat": return "\u{1F4AC}";
    case "file_change": return "\u{1F4DD}";
    case "lock": return "\u{1F512}";
    case "unlock": return "\u{1F513}";
    case "conflict": return "\u{26A0}\u{FE0F}";
    case "branch_change": return "\u{1F33F}";
    default: return "\u{2022}";
  }
}

/** Format the welcome message for /start. */
export function formatWelcome(botName: string): string {
  return [
    `<b>Welcome to CodeHive!</b> \u{1F41D}`,
    ``,
    `I'm <b>${escapeHtml(botName)}</b>, your CodeHive Telegram bridge.`,
    `I'll forward room events here and let you send commands back.`,
    ``,
    `<b>Commands:</b>`,
    `/join HIVE-XXXXXX [password] \u{2014} Join a room`,
    `/leave \u{2014} Leave the current room`,
    `/status \u{2014} Show room status`,
    `/chat message \u{2014} Send a message to the room`,
    `/files \u{2014} Show recent file changes`,
    `/timeline \u{2014} Show activity timeline`,
    `/locks \u{2014} Show locked files`,
    `/help \u{2014} Show this help`,
  ].join("\n");
}

/** Format the /help response. */
export function formatHelp(): string {
  return [
    `<b>CodeHive Bot Commands:</b>`,
    ``,
    `/join HIVE-XXXXXX [password] \u{2014} Join a room`,
    `/leave \u{2014} Leave the current room`,
    `/status \u{2014} Show room members and status`,
    `/chat message \u{2014} Send a chat message`,
    `/files \u{2014} Show recent file changes`,
    `/timeline \u{2014} Show activity timeline`,
    `/locks \u{2014} Show locked files`,
    `/help \u{2014} This help message`,
  ].join("\n");
}
