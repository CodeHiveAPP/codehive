/**
 * CodeHive Telegram Bot Tests
 *
 * Tests formatter functions, API wrapper, and command parsing.
 * Uses built dist/ output — run `npm run build` first.
 */

import { setTimeout as sleep } from "node:timers/promises";

const PORT = 4821;
let passed = 0;
let failed = 0;

function pass(name) {
  passed++;
  console.log(`  \u2713 ${name}`);
}

function fail(name, reason) {
  failed++;
  console.log(`  \u2717 ${name} — ${reason}`);
}

function assert(cond, name, reason) {
  if (cond) pass(name);
  else fail(name, reason);
}

async function run() {
  console.log("\n  CodeHive Telegram Tests\n");

  // -----------------------------------------------------------------------
  // Import formatter from built output
  // -----------------------------------------------------------------------
  const fmt = await import("./dist/telegram/formatter.js");

  // -----------------------------------------------------------------------
  // 1. escapeHtml
  // -----------------------------------------------------------------------
  {
    const result = fmt.escapeHtml('<b>test</b> & "quotes"');
    assert(
      result === "&lt;b&gt;test&lt;/b&gt; &amp; \"quotes\"",
      "escapeHtml escapes <, >, &",
      `got: ${result}`,
    );
  }

  // -----------------------------------------------------------------------
  // 2. formatMemberJoined
  // -----------------------------------------------------------------------
  {
    const result = fmt.formatMemberJoined("Alice", "main");
    assert(
      result.includes("<b>Alice</b>") && result.includes("joined") && result.includes("[main]"),
      "formatMemberJoined includes name, action, and branch",
      `got: ${result}`,
    );
  }

  // -----------------------------------------------------------------------
  // 3. formatMemberJoined without branch
  // -----------------------------------------------------------------------
  {
    const result = fmt.formatMemberJoined("Bob");
    assert(
      result.includes("<b>Bob</b>") && result.includes("joined") && !result.includes("["),
      "formatMemberJoined without branch omits branch tag",
      `got: ${result}`,
    );
  }

  // -----------------------------------------------------------------------
  // 4. formatMemberLeft
  // -----------------------------------------------------------------------
  {
    const result = fmt.formatMemberLeft("Charlie");
    assert(
      result.includes("<b>Charlie</b>") && result.includes("left"),
      "formatMemberLeft includes name and action",
      `got: ${result}`,
    );
  }

  // -----------------------------------------------------------------------
  // 5. formatChatMessage
  // -----------------------------------------------------------------------
  {
    const result = fmt.formatChatMessage("Alice", "Hello <world>");
    assert(
      result.includes("<b>Alice</b>") && result.includes("&lt;world&gt;") && result.includes("<blockquote>"),
      "formatChatMessage escapes content and uses blockquote",
      `got: ${result}`,
    );
  }

  // -----------------------------------------------------------------------
  // 6. formatFileChange (text file)
  // -----------------------------------------------------------------------
  {
    const change = {
      path: "src/app.ts",
      type: "change",
      author: "Alice",
      deviceId: "dev1",
      timestamp: Date.now(),
      diff: "+ new line\n- old line",
      linesAdded: 1,
      linesRemoved: 1,
    };
    const result = fmt.formatFileChange(change);
    assert(
      result.includes("<code>src/app.ts</code>") &&
      result.includes("<b>Alice</b>") &&
      result.includes("+1 -1") &&
      result.includes("<pre>"),
      "formatFileChange shows path, author, stats, and diff",
      `got: ${result}`,
    );
  }

  // -----------------------------------------------------------------------
  // 7. formatFileChange (binary file)
  // -----------------------------------------------------------------------
  {
    const change = {
      path: "logo.png",
      type: "add",
      author: "Bob",
      deviceId: "dev2",
      timestamp: Date.now(),
      diff: null,
      linesAdded: 0,
      linesRemoved: 0,
      sizeAfter: 51200,
    };
    const result = fmt.formatFileChange(change);
    assert(
      result.includes("50KB") && result.includes("logo.png"),
      "formatFileChange binary shows size in KB",
      `got: ${result}`,
    );
  }

  // -----------------------------------------------------------------------
  // 8. formatConflictWarning
  // -----------------------------------------------------------------------
  {
    const result = fmt.formatConflictWarning("src/api.ts", ["Alice", "Bob"], "Multiple devs editing src/api.ts");
    assert(
      result.includes("CONFLICT WARNING") && result.includes("src/api.ts"),
      "formatConflictWarning includes warning and file",
      `got: ${result}`,
    );
  }

  // -----------------------------------------------------------------------
  // 9. formatFileLocked / formatFileUnlocked
  // -----------------------------------------------------------------------
  {
    const locked = fmt.formatFileLocked({ file: "config.ts", lockedBy: "Alice", deviceId: "d1", lockedAt: Date.now() });
    const unlocked = fmt.formatFileUnlocked("config.ts", "Alice");
    assert(
      locked.includes("locked") && locked.includes("config.ts") && locked.includes("Alice"),
      "formatFileLocked shows lock info",
      `got: ${locked}`,
    );
    assert(
      unlocked.includes("unlocked") && unlocked.includes("config.ts"),
      "formatFileUnlocked shows unlock info",
      `got: ${unlocked}`,
    );
  }

  // -----------------------------------------------------------------------
  // 10. formatTerminalShared
  // -----------------------------------------------------------------------
  {
    const result = fmt.formatTerminalShared("Alice", "npm test", "All 42 tests passed", 0);
    assert(
      result.includes("Alice") && result.includes("npm test") && result.includes("exit 0") && result.includes("<pre>"),
      "formatTerminalShared shows command, output in pre block, and exit code",
      `got: ${result}`,
    );
  }

  // -----------------------------------------------------------------------
  // 11. formatBranchWarning
  // -----------------------------------------------------------------------
  {
    const result = fmt.formatBranchWarning("Branches diverge", { Alice: "main", Bob: "feature" });
    assert(
      result.includes("BRANCH WARNING") && result.includes("Alice") && result.includes("main") && result.includes("feature"),
      "formatBranchWarning shows warning and branch list",
      `got: ${result}`,
    );
  }

  // -----------------------------------------------------------------------
  // 12. formatRoomStatus
  // -----------------------------------------------------------------------
  {
    const room = {
      code: "HIVE-ABC123",
      createdAt: Date.now(),
      createdBy: "Alice",
      hasPassword: false,
      isPublic: false,
      expiresInHours: 0,
      members: [
        { deviceId: "d1", name: "Alice", status: "active", workingOn: ["src/app.ts"], joinedAt: Date.now(), lastSeen: Date.now(), branch: "main" },
        { deviceId: "d2", name: "Bob", status: "idle", workingOn: [], joinedAt: Date.now(), lastSeen: Date.now() },
      ],
      recentChanges: [],
      locks: [{ file: "config.ts", lockedBy: "Alice", deviceId: "d1", lockedAt: Date.now() }],
      timeline: [],
    };
    const result = fmt.formatRoomStatus(room);
    assert(
      result.includes("HIVE-ABC123") && result.includes("Alice") && result.includes("Bob") &&
      result.includes("src/app.ts") && result.includes("Locked files") && result.includes("config.ts"),
      "formatRoomStatus shows room code, members, working files, and locks",
      `got: ${result}`,
    );
  }

  // -----------------------------------------------------------------------
  // 13. formatLocks (empty)
  // -----------------------------------------------------------------------
  {
    const result = fmt.formatLocks([]);
    assert(
      result.includes("No files"),
      "formatLocks empty returns no-lock message",
      `got: ${result}`,
    );
  }

  // -----------------------------------------------------------------------
  // 14. formatRecentChanges (empty)
  // -----------------------------------------------------------------------
  {
    const result = fmt.formatRecentChanges([]);
    assert(
      result.includes("No recent"),
      "formatRecentChanges empty returns no-changes message",
      `got: ${result}`,
    );
  }

  // -----------------------------------------------------------------------
  // 15. formatTimeline
  // -----------------------------------------------------------------------
  {
    const events = [
      { id: 1, timestamp: Date.now(), type: "join", actor: "Alice", detail: "Alice joined the room" },
      { id: 2, timestamp: Date.now(), type: "chat", actor: "Alice", detail: "Alice: Hello!" },
    ];
    const result = fmt.formatTimeline(events);
    assert(
      result.includes("Activity Timeline") && result.includes("Alice joined") && result.includes("Hello!"),
      "formatTimeline shows events in order",
      `got: ${result}`,
    );
  }

  // -----------------------------------------------------------------------
  // 16. formatWelcome and formatHelp
  // -----------------------------------------------------------------------
  {
    const welcome = fmt.formatWelcome("TestBot");
    const help = fmt.formatHelp();
    assert(
      welcome.includes("Welcome") && welcome.includes("TestBot") && welcome.includes("/join"),
      "formatWelcome includes bot name and commands",
      `got: ${welcome}`,
    );
    assert(
      help.includes("/join") && help.includes("/leave") && help.includes("/status") && help.includes("/chat"),
      "formatHelp lists all commands",
      `got: ${help}`,
    );
  }

  // -----------------------------------------------------------------------
  // 17. TelegramApi URL construction
  // -----------------------------------------------------------------------
  {
    // Import the api module
    const { TelegramApi } = await import("./dist/telegram/api.js");
    const api = new TelegramApi("123:ABC");

    // Mock fetch to capture the URL
    let capturedUrl = "";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      capturedUrl = String(url);
      return new Response(JSON.stringify({ ok: true, result: { id: 1, is_bot: true, first_name: "Test" } }));
    };

    try {
      await api.getMe();
      assert(
        capturedUrl.includes("https://api.telegram.org/bot123:ABC/getMe"),
        "TelegramApi constructs correct getMe URL",
        `got: ${capturedUrl}`,
      );

      capturedUrl = "";
      await api.sendMessage(12345, "Hello");
      assert(
        capturedUrl.includes("/sendMessage") && capturedUrl.includes("chat_id=12345") && capturedUrl.includes("parse_mode=HTML"),
        "TelegramApi sendMessage includes chat_id and parse_mode",
        `got: ${capturedUrl}`,
      );

      capturedUrl = "";
      globalThis.fetch = async (url) => {
        capturedUrl = String(url);
        return new Response(JSON.stringify({ ok: true, result: [] }));
      };
      await api.getUpdates(42, 10);
      assert(
        capturedUrl.includes("/getUpdates") && capturedUrl.includes("offset=42") && capturedUrl.includes("timeout=10"),
        "TelegramApi getUpdates passes offset and timeout",
        `got: ${capturedUrl}`,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  // -----------------------------------------------------------------------
  // 18. TelegramApi error handling
  // -----------------------------------------------------------------------
  {
    const { TelegramApi } = await import("./dist/telegram/api.js");
    const api = new TelegramApi("bad-token");

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      return new Response(JSON.stringify({ ok: false, description: "Unauthorized", error_code: 401 }));
    };

    try {
      let threw = false;
      try {
        await api.getMe();
      } catch (err) {
        threw = true;
        assert(
          err.message.includes("Unauthorized") && err.message.includes("401"),
          "TelegramApi throws on API error with description and code",
          `got: ${err.message}`,
        );
      }
      if (!threw) fail("TelegramApi error handling", "expected to throw");
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  // -----------------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------------
  console.log(`\n  Result: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
