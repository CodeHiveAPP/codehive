# Contributing to CodeHive

Thanks for your interest in contributing to CodeHive! This guide will help you get started.

## Development Setup

```bash
git clone https://github.com/CodeHiveAPP/codehive.git
cd codehive
npm install
npm run build
```

## Development Workflow

```bash
# Watch mode (auto-rebuild on changes)
npm run dev

# Type check
npm run typecheck

# Build
npm run build

# Test relay locally
npm run relay

# Test CLI
node bin/codehive.js --help
node bin/codehive.js doctor
```

## Project Structure

```
src/
├── shared/          # Types, protocol, utilities (shared by all modules)
│   ├── types.ts     # All TypeScript interfaces and type definitions
│   ├── protocol.ts  # Message encoding/decoding, constants
│   └── utils.ts     # Room codes, debounce, diff computation
├── relay/           # WebSocket relay server
│   ├── room.ts      # Room + RoomManager classes
│   └── server.ts    # WebSocket server, message routing
├── mcp/             # MCP server for Claude Code integration
│   ├── client.ts    # WebSocket client (connects to relay)
│   ├── tools.ts     # MCP tool definitions (8 tools)
│   └── index.ts     # MCP server entry point
├── watcher/         # File system watcher
│   └── index.ts     # chokidar-based file change detection
├── cli/             # Command-line interface
│   └── index.ts     # All CLI commands (init, relay, deploy, etc.)
└── index.ts         # Public API exports
```

## Guidelines

- **TypeScript strict mode** — no `any` types, no type assertions without justification
- **No runtime dependencies unless necessary** — keep the install fast
- **Test your changes** — at minimum, `npm run typecheck && npm run build`
- **Commit messages** — use conventional format: `feat:`, `fix:`, `docs:`, `refactor:`

## Adding a New MCP Tool

1. Define the tool in `src/mcp/tools.ts`
2. Add the corresponding message types in `src/shared/types.ts`
3. Handle the message in `src/relay/server.ts`
4. Update the README

## Submitting a PR

1. Fork the repo
2. Create your branch from `main`
3. Make your changes
4. Run `npm run typecheck && npm run build`
5. Open a PR with a clear description

## Reporting Issues

Use the GitHub issue templates. Include:
- Your OS, Node.js version, and CodeHive version
- Steps to reproduce
- Error logs (`codehive doctor` output is helpful)
