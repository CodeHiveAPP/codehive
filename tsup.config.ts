import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "relay/server": "src/relay/server.ts",
    "mcp/index": "src/mcp/index.ts",
    "cli/index": "src/cli/index.ts",
    "watcher/index": "src/watcher/index.ts",
  },
  format: ["esm"],
  target: "node20",
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  shims: false,
});
