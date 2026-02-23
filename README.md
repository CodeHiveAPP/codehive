<div align="center">

```
    ____          _      _   _ _
   / ___|___   __| | ___| | | (_)_   _____
  | |   / _ \ / _` |/ _ \ |_| | \ \ / / _ \
  | |__| (_) | (_| |  __/  _  | |\ V /  __/
   \____\___/ \__,_|\___|_| |_|_| \_/ \___|
```

### Real-time multi-developer collaboration for Claude Code

**See your teammates' changes. Lock files. Get conflict warnings. Share terminal output.**
**Git branch awareness. Activity timeline. Telegram notifications. Webhook integrations.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-green.svg)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-compatible-blue.svg)](https://modelcontextprotocol.io)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org)

</div>

---

## The Problem

You and your teammates both use Claude Code on the same project. But Claude Code doesn't know what the other person is doing. You edit the same file. You overwrite each other's work. You waste time on merge conflicts.

**CodeHive fixes this.**

---

## What It Does

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│   You: "Who's in the room?"                                            │
│                                                                         │
│   Claude: Room HIVE-A3K7XY — 3 members:                                │
│                                                                         │
│     Alice (active) [main]                                               │
│       Working on: src/auth.ts, src/middleware.ts                        │
│       Cursor: src/auth.ts:42:10                                         │
│       Last seen: 14:32:01                                               │
│                                                                         │
│     Bob (active) [feature/api]                                          │
│       Working on: src/api/routes.ts                                     │
│       Last seen: 14:32:05                                               │
│                                                                         │
│     Charlie (idle)                                                      │
│       Working on: none declared                                         │
│       Last seen: 14:28:12                                               │
│                                                                         │
│   Locked files:                                                         │
│     🔒 src/config.ts (by Alice)                                         │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   You: "What did my teammates change?"                                  │
│                                                                         │
│   Claude: Recent changes:                                               │
│     [14:31:42] Alice changed src/auth.ts (+8 -2)                       │
│       + export function hashPassword(pwd: string): string {             │
│       +   return bcrypt.hashSync(pwd, 12);                              │
│       + }                                                               │
│     [14:32:01] Bob changed src/api/routes.ts (+15 -0)                  │
│       + router.post('/login', validateBody, loginHandler);              │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   [!] CONFLICT WARNING                                                  │
│   File "src/auth.ts" is being edited by Alice and You.                 │
│   Coordinate to avoid conflicts.                                        │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## How It Works

```
                        THE BIG PICTURE
  ═══════════════════════════════════════════════════════

  Dev A (Paris)                         Dev B (Tokyo)
  ┌──────────────────┐                  ┌──────────────────┐
  │                  │                  │                  │
  │   Claude Code    │                  │   Claude Code    │
  │   ┌──────────┐   │                  │   ┌──────────┐   │
  │   │ CodeHive │   │                  │   │ CodeHive │   │
  │   │   MCP    │   │                  │   │   MCP    │   │
  │   │  Server  │   │                  │   │  Server  │   │
  │   └────┬─────┘   │                  │   └────┬─────┘   │
  │        │         │                  │        │         │
  │   ┌────┴─────┐   │                  │   ┌────┴─────┐   │
  │   │  File    │   │                  │   │  File    │   │
  │   │ Watcher  │   │                  │   │ Watcher  │   │
  │   └──────────┘   │                  │   └──────────┘   │
  │                  │                  │                  │
  └───────┬──────────┘                  └───────┬──────────┘
          │                                     │
          │         WebSocket (real-time)        │
          │                                     │
          └──────────────┐     ┌────────────────┘
                         │     │
                         ▼     ▼
                  ┌─────────────────┐        ┌────────────────┐
                  │                 │        │   Telegram Bot  │
                  │  CodeHive Relay │◄──────►│   (optional)   │
                  │    (server)     │        │ Mobile notifs   │
                  │                 │        └────────────────┘
                  │  ┌───────────┐  │
                  │  │   Rooms   │  │        ┌────────────────┐
                  │  │ HIVE-A3K7 │  │───────►│   Webhooks     │
                  │  │ HIVE-9FMN │  │        │ Slack/Discord  │
                  │  └───────────┘  │        └────────────────┘
                  │                 │
                  │  ┌───────────┐  │
                  │  │ Conflict  │  │
                  │  │ Detection │  │
                  │  └───────────┘  │
                  │                 │
                  └─────────────────┘
                   Cloud / Local / VPS
```

---

## Quick Start

### 1 minute setup (same network)

```bash
# Both developers run this:
npm install -g codehive && codehive init

# In Claude Code:
#   Dev A → "Create a CodeHive room"         → gets HIVE-A3K7XY
#   Dev B → "Join CodeHive room HIVE-A3K7XY" → connected!
```

### Remote teams (across the internet)

```bash
# ── ONE-TIME: Deploy a relay server (pick one) ──────────────

# Option A: Fly.io (free)
cd codehive && fly launch --name my-relay && fly deploy

# Option B: Docker
docker run -d -p 4819:4819 ghcr.io/CodeHiveAPP/codehive-relay

# Option C: Any VPS
npm install -g codehive && codehive relay --public

# ── EVERY DEVELOPER ─────────────────────────────────────────

npm install -g codehive
codehive init --relay ws://my-relay.fly.dev:4819

# ── IN CLAUDE CODE ──────────────────────────────────────────

#   Dev A → "Create a CodeHive room"         → HIVE-A3K7XY
#   Dev B → "Join CodeHive room HIVE-A3K7XY" → connected!
```

### Works on ANY existing project

```bash
cd my-react-app          # or Python, Rust, Go, Java, anything
codehive init            # adds .mcp.json (60 bytes), touches nothing else
```

---

## Features

### 14 MCP Tools + 2 Live Resources

These are the tools your AI editor (Claude Code, Cursor, Windsurf, VS Code + Copilot) can call:

| Tool | Parameters | What it does |
|------|-----------|-------------|
| `create_room` | `password?`, `is_public?`, `expires_in_hours?` | Create a room with optional password, public visibility, and auto-expiry |
| `join_room` | `code`, `password?` | Join a room with a code like `HIVE-A3K7XY` |
| `leave_room` | — | Leave the current room and stop file watching |
| `get_team_status` | — | See members, git branches, cursor positions, typing status, working files, locks |
| `get_recent_changes` | — | View teammates' file changes with line-by-line diffs |
| `send_message` | `message` | Send a chat message to all teammates in the room |
| `declare_working` | `files` (comma-separated) | Declare files you're editing — triggers conflict alerts if someone else touches them |
| `get_notifications` | — | Check unread: file changes, chat messages, conflict warnings, lock events, branch warnings |
| `lock_file` | `file` | Lock a file so only you can edit it — teammates are blocked from modifying it |
| `unlock_file` | `file` | Unlock a previously locked file, allowing teammates to edit again |
| `get_timeline` | `limit?` (default: 30) | View chronological activity: joins, leaves, file changes, chats, locks, conflicts |
| `share_terminal` | `command`, `output`, `exit_code?` | Share terminal output (test results, build logs) with teammates |
| `browse_rooms` | — | Discover public rooms available on the relay server |
| `set_webhook` | `url`, `events?` | Configure webhook URL for room events (Slack, Discord, or custom) |

**MCP Resources** (live subscribable data):
- `codehive://room/status` — real-time room state (members, changes, locks)
- `codehive://notifications` — unread notification feed

### Room features

**Passwords** — Protect rooms with a password. Only people with the password can join.

```
You: "Create a password-protected room with password secret123"
Claude: Room HIVE-A3K7XY created! Password protected: yes
        Invite link: codehive://127.0.0.1:4819/join/HIVE-A3K7XY?p=secret123
```

**Public rooms** — Make rooms discoverable by other developers on the same relay.

```
You: "Create a public room"
Claude: Room HIVE-B5N9QR created! Visibility: PUBLIC (discoverable)

# Others can find it:
You: "Browse public CodeHive rooms"
Claude: 2 public room(s) found:
  HIVE-B5N9QR — 3 members
    Created by: Alice
    Members: Alice, Bob, Charlie
```

**Room expiry** — Rooms auto-delete after configurable hours of inactivity.

```
You: "Create a room that expires after 24 hours"
Claude: Room HIVE-C7P2KM created! Expires: after 24h of inactivity
```

**Invite links** — Generated automatically when creating a room.

```
codehive://127.0.0.1:4819/join/HIVE-A3K7XY
codehive://my-relay.fly.dev:4819/join/HIVE-A3K7XY?p=secret123
```

### Conflict detection

```
  Dev A declares: "I'm working on auth.ts"
  Dev B declares: "I'm working on auth.ts"
                          │
                          ▼
            ┌─────────────────────────┐
            │  ⚠ CONFLICT WARNING    │
            │                         │
            │  File: auth.ts          │
            │  Edited by: Dev A, Dev B│
            │                         │
            │  Coordinate to avoid    │
            │  merge conflicts!       │
            └─────────────────────────┘
            (sent to BOTH developers)
```

### File locking

```
You: "Lock src/config.ts so nobody else changes it"

Claude: Locked src/config.ts. Only you can edit it now. Use unlock_file when done.

# If a teammate tries to edit it:
#   ⚠ File "src/config.ts" is locked by Alice

# When you're done:
You: "Unlock src/config.ts"
Claude: Unlocked src/config.ts. Teammates can now edit it.
```

### Git branch awareness

Auto-detects your git branch and warns when teammates are on different branches:

```
Room HIVE-A3K7XY — 2 members:

  Alice (active) [main]
    Working on: src/auth.ts

  Bob (active) [feature/api]
    Working on: src/routes.ts

⚠ BRANCH WARNING: Team members are on different branches:
  Alice: main, Bob: feature/api. Coordinate before merging.
```

Branch is refreshed every 30 seconds automatically.

### Activity timeline

```
You: "Show me the room timeline"

Activity timeline:
  + [14:20:01] Zeus joined the room
  + [14:21:15] Alice joined the room
  ~ [14:22:03] Zeus changed src/auth.ts
  # [14:23:11] Alice locked src/config.ts
  > [14:24:02] Zeus: "Done with auth module"
  . [14:25:30] Alice unlocked src/config.ts
  ! [14:26:00] CONFLICT: src/api.ts edited by Zeus and Alice
```

### Terminal output sharing

```
You: "Share the test results with the team"

Claude: Shared terminal output: `npm test` (1200 chars)

# Teammates see:
#   [Terminal] Alice shared: `npm test` (exit 0)
```

### Typing indicators & cursor sharing

See what your teammates are typing in real-time:

```
  Alice is typing in src/auth.ts
  Bob's cursor: src/routes.ts:42:10
```

### Webhook notifications

Send room events to Slack, Discord, or any HTTP endpoint:

```
You: "Set a webhook to https://hooks.slack.com/services/xxx"

Claude: Webhook configured: https://hooks.slack.com/services/xxx
        Events: all

# Every room event is POSTed as JSON:
{
  "event": "file_change",
  "room": "HIVE-A3K7XY",
  "timestamp": 1706123456789,
  "file": "src/auth.ts",
  "author": "Alice",
  "type": "change"
}
```

Supported webhook events: `all`, `join`, `leave`, `chat`, `file_change`, `conflict`

### Real-time file watching

CodeHive watches your project files and automatically notifies teammates when you save:

- Detects file additions, modifications, and deletions
- Computes lightweight diffs (only changed lines, not full files)
- Reports binary file sizes (images, fonts, etc.)
- Ignores `node_modules`, `.git`, `dist`, binary files, lock files
- Per-file debounce to avoid flooding on rapid saves

### Team chat

```
You: "Tell the team I'm done with the auth module"

Claude: Message sent to HIVE-A3K7XY: "I'm done with the auth module"

# All teammates see:
#   [Chat] Alice: I'm done with the auth module
```

---

## Telegram Bot (optional)

Monitor your rooms and send commands from your phone via Telegram. **100% optional** — if you don't configure it, everything works the same.

### Setup

```bash
# Step 1: Create a bot on Telegram
# → Open Telegram, search for @BotFather
# → Send /newbot, follow the prompts
# → Copy the token (e.g. 123456:ABC-DEF1234...)

# Step 2: Configure the token (pick one method)

# Method A: Environment variable
export CODEHIVE_TELEGRAM_TOKEN="123456:ABC-DEF1234..."
codehive telegram

# Method B: codehive.json
echo '{ "telegramToken": "123456:ABC-DEF1234..." }' > codehive.json
codehive telegram

# Step 3: Send /start to your bot in Telegram
# → The bot will auto-detect your chat
```

### Telegram commands

| Command | What it does |
|---------|-------------|
| `/start` | Welcome message + list of commands |
| `/join HIVE-XXXXXX` | Join a room (no password) |
| `/join HIVE-XXXXXX mypassword` | Join a password-protected room |
| `/leave` | Leave the current room |
| `/status` | Show room members, branches, locks, working files |
| `/chat Hello team!` | Send a message to all room members |
| `/files` | Show recent file changes with diffs |
| `/timeline` | Show activity timeline (joins, leaves, changes, locks) |
| `/locks` | Show currently locked files |
| `/help` | List all available commands |

### Events forwarded to Telegram

When you're in a room, the bot sends you real-time notifications:

| Event | Telegram message example |
|-------|------------------------|
| Member joins | **Alice** joined the room [main] |
| Member leaves | **Bob** left the room |
| File changed | **Alice** changed `src/auth.ts` (`+8 -2`) |
| Chat message | **Bob**: "Done with the API" |
| Conflict | **CONFLICT WARNING** — `src/auth.ts` edited by Alice and Bob |
| File locked | **Alice** locked `src/config.ts` |
| File unlocked | **Alice** unlocked `src/config.ts` |
| Terminal shared | **Alice** shared terminal (exit 0): `npm test` |
| Branch warning | **BRANCH WARNING** — Alice: main, Bob: feature/api |

### Running in background

```bash
codehive telegram --background     # Run as a detached process
```

---

## CLI Reference

### `codehive init` — Setup CodeHive

```bash
codehive init                              # Auto-detect editor, start local relay
codehive init --relay ws://host:4819       # Use a remote relay server
codehive init --name "Alice"               # Set your display name
codehive init --port 5000                  # Custom local relay port
codehive init --global                     # Install globally (~/.claude.json)
codehive init --editor claude-code         # Force a specific editor
codehive init --editor cursor              # Supported: claude-code, cursor, windsurf, copilot
codehive init --no-auto-relay              # Don't auto-start local relay
```

### `codehive relay` — Relay Server

```bash
codehive relay                             # Start relay (foreground, localhost:4819)
codehive relay --public                    # Bind to 0.0.0.0 (accessible from network)
codehive relay --port 5000                 # Custom port
codehive relay --host 192.168.1.100        # Custom host
codehive relay --background                # Run in background (detached)
```

### `codehive telegram` — Telegram Bot Bridge

```bash
codehive telegram                          # Start Telegram bot (foreground)
codehive telegram --background             # Run in background (detached)

# Requires CODEHIVE_TELEGRAM_TOKEN env var or telegramToken in codehive.json
# Get a token from @BotFather on Telegram: https://t.me/BotFather
```

### `codehive deploy` — Cloud Deployment Guide

```bash
codehive deploy                            # Show Fly.io, Docker, and VPS instructions
```

### `codehive status` — Check Configuration

```bash
codehive status                            # Show configured editors + relay connectivity
```

### `codehive doctor` — Full Diagnostics

```bash
codehive doctor                            # Check Node.js version, editors, relay, git
```

### `codehive uninstall` — Remove CodeHive

```bash
codehive uninstall                         # Remove from all editors (project config)
codehive uninstall --global                # Remove from global configs
codehive uninstall --editor cursor         # Remove from a specific editor only
```

---

## Works with everything

CodeHive is **language-agnostic** and **framework-agnostic**. It watches files — it doesn't care what's in them.

```
  ┌─────────────────────────────────────────────────────────┐
  │                    Compatible with                       │
  ├─────────────────────────────────────────────────────────┤
  │                                                         │
  │  AI Editors         Languages        Frameworks         │
  │  ──────────         ──────────       ──────────         │
  │  Claude Code        JavaScript       React / Next.js    │
  │  Cursor             TypeScript       Vue / Nuxt         │
  │  Windsurf           Python           Angular            │
  │  VS Code + Copilot  Rust             Django / Flask     │
  │                     Go               Express / Fastify  │
  │                     Java             Spring Boot        │
  │                     C# / .NET        Rails / Laravel    │
  │                     Swift / Kotlin   Any framework      │
  │                     Any language     Any project        │
  │                                                         │
  └─────────────────────────────────────────────────────────┘
```

### What CodeHive adds to your project

```
  your-project/
  ├── .mcp.json       ← CodeHive config (60 bytes, commit this!)
  ├── codehive.json   ← Optional: relay host, dev name, telegram token
  ├── src/             ← untouched
  ├── package.json     ← untouched
  └── ...              ← everything untouched
```

---

## Architecture

```
  src/
  ├── shared/              Shared across all modules
  │   ├── types.ts         30+ TypeScript interfaces (fully typed protocol)
  │   ├── protocol.ts      Message encoding, constants, type guards
  │   └── utils.ts         Room codes, debounce, diff computation
  │
  ├── relay/               WebSocket relay server
  │   ├── room.ts          Room class (members, locks, timeline, conflicts)
  │   └── server.ts        Server (routing, heartbeat, persistence, webhooks)
  │
  ├── mcp/                 Claude Code integration
  │   ├── client.ts        WebSocket client (auto-reconnect, heartbeat, queuing)
  │   ├── tools.ts         14 MCP tools + 2 resources
  │   └── index.ts         MCP server entry point (stdio transport)
  │
  ├── watcher/             File system monitoring
  │   └── index.ts         chokidar-based watcher with diff computation
  │
  ├── telegram/            Telegram bot bridge (optional)
  │   ├── bot.ts           TelegramBot class (long polling + relay bridge)
  │   ├── api.ts           Telegram Bot API wrapper (native fetch, zero deps)
  │   ├── formatter.ts     HTML message formatting for Telegram
  │   └── types.ts         Telegram API type definitions
  │
  ├── cli/                 Command-line interface
  │   └── index.ts         All commands (init, relay, telegram, deploy, doctor...)
  │
  └── index.ts             Public API for programmatic usage
```

### Tech Stack

| Component | Technology | Why |
|-----------|-----------|-----|
| Runtime | Node.js >= 20 | Universal, fast startup, native fetch |
| Language | TypeScript 5.9 (strict) | Type safety across the entire protocol |
| MCP SDK | @modelcontextprotocol/sdk 1.26 | Official Claude Code integration |
| WebSocket | ws 8.19 | Battle-tested, zero dependencies |
| File watching | chokidar 4 | Cross-platform, high performance |
| CLI | commander 14 | Industry standard |
| Validation | zod 3.25 | Schema validation for MCP tools |
| Telegram | Native fetch() | Zero dependencies, Telegram Bot API |
| Build | tsup 8.5 | Fast ESM builds with declaration files |

---

## Deployment

### Fly.io (free tier)

```bash
git clone https://github.com/CodeHiveAPP/codehive.git
cd codehive
fly launch --name my-codehive-relay
fly deploy
# → ws://my-codehive-relay.fly.dev:4819
```

### Docker

```bash
docker build -t codehive-relay .
docker run -d -p 4819:4819 --name codehive codehive-relay
# → ws://YOUR_SERVER_IP:4819
```

### PM2 (any VPS)

```bash
npm install -g codehive pm2
pm2 start codehive -- relay --public
pm2 save
# → ws://YOUR_SERVER_IP:4819
```

---

## Configuration

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CODEHIVE_RELAY_HOST` | `127.0.0.1` | Relay server host |
| `CODEHIVE_RELAY_PORT` | `4819` | Relay server port |
| `CODEHIVE_DEV_NAME` | system username | Your display name in rooms |
| `CODEHIVE_PROJECT` | cwd | Project root path |
| `CODEHIVE_HOST` | `127.0.0.1` | Relay bind host (server-side) |
| `CODEHIVE_PORT` | `4819` | Relay bind port (server-side) |
| `CODEHIVE_TELEGRAM_TOKEN` | — | Telegram bot token (from @BotFather) |

### `.mcp.json` (project config — commit this!)

```json
{
  "mcpServers": {
    "codehive": {
      "command": "codehive-mcp",
      "env": {
        "CODEHIVE_RELAY_HOST": "my-relay.fly.dev",
        "CODEHIVE_RELAY_PORT": "4819",
        "CODEHIVE_DEV_NAME": "Alice"
      }
    }
  }
}
```

This file is auto-generated by `codehive init`. Commit it — when teammates clone the project, CodeHive is pre-configured.

### `codehive.json` (optional project config)

```json
{
  "relayHost": "my-relay.fly.dev",
  "relayPort": 4819,
  "devName": "Alice",
  "telegramToken": "123456:ABC-DEF...",
  "telegramChatId": 987654321
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `relayHost` | No | Relay server hostname (overrides env var) |
| `relayPort` | No | Relay server port (overrides env var) |
| `devName` | No | Your display name in rooms |
| `telegramToken` | No | Telegram bot token for mobile notifications |
| `telegramChatId` | No | Telegram chat ID (auto-detected from first `/start` if omitted) |

Place in your project root. Config priority: environment variables > codehive.json > defaults.

---

## Testing

```bash
# Run all tests (builds, starts relay, runs all suites)
npm test

# 64 tests total:
#   29 E2E tests — full WebSocket protocol testing
#   13 edge case tests — invalid input, limits, error handling
#   22 Telegram tests — formatter, API wrapper, command parsing
```

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## License

MIT — see [LICENSE](LICENSE).

---

<div align="center">

**Built for developers who ship together.**

[Report Bug](../../issues/new?template=bug_report.md) · [Request Feature](../../issues/new?template=feature_request.md)

</div>
