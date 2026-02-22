<div align="center">

```
    ____          _      _   _ _
   / ___|___   __| | ___| | | (_)_   _____
  | |   / _ \ / _` |/ _ \ |_| | \ \ / / _ \
  | |__| (_) | (_| |  __/  _  | |\ V /  __/
   \____\___/ \__,_|\___|_| |_|_| \_/ \___|
```

### Real-time multi-developer collaboration for Claude Code

**See your teammates' changes. Get conflict warnings. Chat from the terminal.**
**Works on any project. Local or remote.**

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
│   Claude: Room HIVE-A3K7 — 3 members:                                  │
│                                                                         │
│     Alice (active)                                                      │
│       Working on: src/auth.ts, src/middleware.ts                        │
│       Last seen: 14:32:01                                               │
│                                                                         │
│     Bob (active)                                                        │
│       Working on: src/api/routes.ts                                     │
│       Last seen: 14:32:05                                               │
│                                                                         │
│     Charlie (idle)                                                      │
│       Working on: none declared                                         │
│       Last seen: 14:28:12                                               │
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
                  ┌─────────────────┐
                  │                 │
                  │  CodeHive Relay │
                  │    (server)     │
                  │                 │
                  │  ┌───────────┐  │
                  │  │   Rooms   │  │
                  │  │ HIVE-A3K7 │  │
                  │  │ HIVE-9FMN │  │
                  │  └───────────┘  │
                  │                 │
                  │  ┌───────────┐  │
                  │  │ Conflict  │  │
                  │  │ Detection │  │
                  │  └───────────┘  │
                  │                 │
                  │  ┌───────────┐  │
                  │  │ Message   │  │
                  │  │ Routing   │  │
                  │  └───────────┘  │
                  │                 │
                  └─────────────────┘
                   Cloud / Local / VPS
```

### Step by step

```
  STEP 1                    STEP 2                    STEP 3
  ══════                    ══════                    ══════

  Dev A creates             Dev B joins               They collaborate
  a room                    the room                  in real-time

  ┌──────────┐              ┌──────────┐              ┌──────────────────┐
  │ "Create  │              │ "Join    │              │ Dev A saves      │
  │  a room" │──┐           │  room    │──┐           │ auth.ts          │
  └──────────┘  │           │ HIVE-    │  │           └────────┬─────────┘
                │           │  A3K7"   │  │                    │
                ▼           └──────────┘  │                    ▼
         ┌────────────┐                   │           ┌──────────────────┐
         │ Room code: │                   ▼           │ Dev B receives:  │
         │ HIVE-A3K7  │          ┌──────────────┐     │ "Dev A modified  │
         │            │          │  Connected!  │     │  auth.ts (+8-2)" │
         │ Share this │          │  2 members   │     └──────────────────┘
         │ with your  │          │  online      │
         │ teammate   │          └──────────────┘
         └────────────┘
```

### The message flow

```
  Dev A edits auth.ts
       │
       ▼
  File Watcher detects change
       │
       ▼
  Computes diff:
  ┌──────────────────────────────┐
  │ + function validateToken() { │
  │ +   return jwt.verify(...)   │
  │ + }                          │
  │ - // TODO: add validation    │
  └──────────┬───────────────────┘
             │
             ▼
  MCP Server sends to Relay ──── WebSocket ────► Relay Server
                                                      │
                                                      │ broadcasts to
                                                      │ all room members
                                                      │
                                Dev B ◄───────────────┘
                                Dev C ◄───────────────┘
                                  │
                                  ▼
                           ┌─────────────────────┐
                           │ Notification:        │
                           │ "Dev A changed       │
                           │  auth.ts (+3 -1)"    │
                           │                      │
                           │ + function validate  │
                           │ +   Token() { ...    │
                           └─────────────────────┘

  If Dev B is ALSO editing auth.ts:
                                  │
                                  ▼
                           ┌─────────────────────┐
                           │ ⚠ CONFLICT WARNING  │
                           │ auth.ts is being     │
                           │ edited by Dev A      │
                           │ AND Dev B            │
                           └─────────────────────┘
```

---

## Quick Start

### 1 minute setup (same network)

```bash
# Both developers run this:
npm install -g codehive && codehive init

# In Claude Code:
#   Dev A → "Create a CodeHive room"         → gets HIVE-A3K7
#   Dev B → "Join CodeHive room HIVE-A3K7"   → connected!
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

#   Dev A → "Create a CodeHive room"         → HIVE-A3K7
#   Dev B → "Join CodeHive room HIVE-A3K7"   → connected!
```

### Works on ANY existing project

```bash
cd my-react-app          # or Python, Rust, Go, Java, anything
codehive init            # adds .mcp.json (60 bytes), touches nothing else
```

---

## Features

### 8 Claude Code tools

| Tool | What it does |
|------|-------------|
| `create_room` | Create a new collaboration room, get a shareable code |
| `join_room` | Join a room with a code like `HIVE-A3K7` |
| `leave_room` | Leave the current room |
| `get_team_status` | See who's connected, their status, and their current files |
| `get_recent_changes` | View teammates' file changes with line-by-line diffs |
| `send_message` | Send a chat message to all teammates in the room |
| `declare_working` | Declare which files you're editing (triggers conflict alerts) |
| `get_notifications` | Check unread notifications (changes, messages, warnings) |

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

### Real-time file watching

CodeHive watches your project files and automatically notifies teammates when you save:

- Detects file additions, modifications, and deletions
- Computes lightweight diffs (only changed lines, not full files)
- Ignores `node_modules`, `.git`, `dist`, binary files, lock files
- Debounced to avoid flooding on rapid saves

### Team chat

```
You: "Tell the team I'm done with the auth module"

Claude: Message sent to HIVE-A3K7: "I'm done with the auth module"

# All teammates see:
#   Message from Alice: "I'm done with the auth module"
```

---

## Works with everything

CodeHive is **language-agnostic** and **framework-agnostic**. It watches files — it doesn't care what's in them.

```
  ┌─────────────────────────────────────────────────────────┐
  │                    Compatible with                       │
  ├─────────────────────────────────────────────────────────┤
  │                                                         │
  │  Languages        Frameworks          Tools             │
  │  ──────────       ──────────          ─────             │
  │  JavaScript       React / Next.js     Git               │
  │  TypeScript       Vue / Nuxt          Docker            │
  │  Python           Angular             Kubernetes        │
  │  Rust             Django / Flask      Terraform          │
  │  Go               Express / Fastify   CI/CD pipelines   │
  │  Java             Spring Boot                           │
  │  C# / .NET        Rails                                 │
  │  Swift            Laravel                               │
  │  Kotlin           Any framework                         │
  │  Any language     Any project                           │
  │                                                         │
  └─────────────────────────────────────────────────────────┘
```

### What CodeHive adds to your project

```
  your-project/
  ├── .mcp.json     ← CodeHive config (60 bytes, commit this!)
  ├── src/           ← untouched
  ├── package.json   ← untouched
  ├── Cargo.toml     ← untouched
  ├── requirements.txt ← untouched
  └── ...            ← everything untouched
```

---

## CLI Reference

```bash
codehive init                              # Setup (local relay, auto-start)
codehive init --relay ws://host:4819       # Setup with remote relay
codehive init --name "Alice"               # Set display name
codehive init --global                     # Global config (~/.claude.json)

codehive relay                             # Start relay server (foreground)
codehive relay --public                    # Bind to 0.0.0.0 (remote access)
codehive relay --port 5000                 # Custom port
codehive relay --background                # Run in background (detached)

codehive deploy                            # Show cloud deployment options
codehive status                            # Check config + relay connectivity
codehive doctor                            # Full diagnostics
codehive uninstall                         # Remove from Claude Code config
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
  │   ├── room.ts          Room class (members, conflicts, broadcasting)
  │   └── server.ts        Server (routing, heartbeat, cleanup)
  │
  ├── mcp/                 Claude Code integration
  │   ├── client.ts        WebSocket client (auto-reconnect, heartbeat)
  │   ├── tools.ts         8 MCP tools registered for Claude Code
  │   └── index.ts         MCP server entry point (stdio transport)
  │
  ├── watcher/             File system monitoring
  │   └── index.ts         chokidar-based watcher with diff computation
  │
  ├── cli/                 Command-line interface
  │   └── index.ts         All commands (init, relay, deploy, doctor...)
  │
  └── index.ts             Public API for programmatic usage
```

### Tech Stack

| Component | Technology | Why |
|-----------|-----------|-----|
| Runtime | Node.js >= 20 | Universal, fast startup |
| Language | TypeScript 5.9 (strict) | Type safety across the entire protocol |
| MCP SDK | @modelcontextprotocol/sdk 1.26 | Official Claude Code integration |
| WebSocket | ws 8.19 | Battle-tested, zero dependencies |
| File watching | chokidar 4 | Cross-platform, high performance |
| CLI | commander 14 | Industry standard |
| Validation | zod 3.25 | Schema validation for MCP tools |
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
| `CODEHIVE_DEV_NAME` | system username | Your display name |
| `CODEHIVE_PROJECT` | cwd | Project root path |

### `.mcp.json` (project config)

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

Commit this file. When teammates clone the project, CodeHive is pre-configured.

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
