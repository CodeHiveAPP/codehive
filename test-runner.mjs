/**
 * Test runner for CodeHive.
 * Starts a relay, runs E2E + edge case tests, then cleans up.
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = 4821;

async function run() {
  // Build first
  console.log("Building...");
  const build = spawn("npx", ["tsup"], { stdio: "inherit", shell: true });
  await new Promise((resolve, reject) => {
    build.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`Build failed (${code})`))));
  });

  // Start relay
  console.log("\nStarting relay on port " + PORT + "...");
  const relay = spawn("node", ["dist/relay/server.js"], {
    env: { ...process.env, CODEHIVE_PORT: String(PORT) },
    stdio: "pipe",
  });

  await sleep(1500);

  let exitCode = 0;

  try {
    // Run E2E tests
    console.log("\n=== E2E TESTS ===\n");
    const e2e = spawn("node", ["test-e2e.mjs"], { stdio: "inherit" });
    await new Promise((resolve) => {
      e2e.on("close", (code) => {
        if (code !== 0) exitCode = 1;
        resolve();
      });
    });

    // Run edge case tests
    console.log("\n=== EDGE CASE TESTS ===\n");
    const edge = spawn("node", ["test-edge-cases.mjs"], { stdio: "inherit" });
    await new Promise((resolve) => {
      edge.on("close", (code) => {
        if (code !== 0) exitCode = 1;
        resolve();
      });
    });

    // Run Telegram bot tests (no relay needed — unit tests only)
    console.log("\n=== TELEGRAM TESTS ===\n");
    const tg = spawn("node", ["test-telegram.mjs"], { stdio: "inherit" });
    await new Promise((resolve) => {
      tg.on("close", (code) => {
        if (code !== 0) exitCode = 1;
        resolve();
      });
    });
  } finally {
    relay.kill("SIGTERM");
  }

  process.exit(exitCode);
}

run().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
