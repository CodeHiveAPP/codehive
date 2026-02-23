import WebSocket from "ws";

const RELAY = "ws://127.0.0.1:4821";
const ts = () => Date.now();
let testsPassed = 0;
let testsFailed = 0;

function pass(name) { testsPassed++; console.log("  OK " + name); }
function fail(name, reason) { testsFailed++; console.log("  FAIL " + name + " - " + reason); }

function send(ws, msg) { ws.send(JSON.stringify(msg)); }

function waitFor(ws, type, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const handler = (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === type) {
        ws.removeListener("message", handler);
        resolve(msg);
      }
    };
    ws.on("message", handler);
    const check = () => {
      if (Date.now() - start > timeout) {
        ws.removeListener("message", handler);
        reject(new Error("Timeout: " + type));
      } else {
        setTimeout(check, 50);
      }
    };
    check();
  });
}

async function run() {
  console.log("\n  CodeHive Edge Case Tests\n");

  // Test 1: Empty name rejected
  const ws1 = new WebSocket(RELAY);
  await new Promise(r => ws1.on("open", r));
  send(ws1, { type: "create_room", deviceId: "dev1", name: "", projectPath: "/p", timestamp: ts() });
  try {
    const err = await waitFor(ws1, "error", 2000);
    if (err.error.includes("Name")) pass("Empty name rejected");
    else fail("Empty name", err.error);
  } catch { fail("Empty name", "no error received"); }
  ws1.close();

  // Test 2: Long name rejected (>50 chars)
  const ws2 = new WebSocket(RELAY);
  await new Promise(r => ws2.on("open", r));
  send(ws2, { type: "create_room", deviceId: "dev2", name: "x".repeat(60), projectPath: "/p", timestamp: ts() });
  try {
    const err = await waitFor(ws2, "error", 2000);
    if (err.error.includes("Name")) pass("Long name rejected");
    else fail("Long name", err.error);
  } catch { fail("Long name", "no error received"); }
  ws2.close();

  // Test 3: Chat message too long rejected
  const ws3 = new WebSocket(RELAY);
  await new Promise(r => ws3.on("open", r));
  send(ws3, { type: "create_room", deviceId: "dev3", name: "Test", projectPath: "/p", timestamp: ts() });
  const created = await waitFor(ws3, "room_created", 3000);
  const code = created.room.code;
  send(ws3, { type: "chat_message", deviceId: "dev3", code, name: "Test", content: "x".repeat(11000), timestamp: ts() });
  try {
    const err = await waitFor(ws3, "error", 2000);
    if (err.error.includes("10000")) pass("Long chat message rejected");
    else fail("Long chat", err.error);
  } catch { fail("Long chat", "no error received"); }
  ws3.close();

  // Test 4: Invalid JSON handled gracefully
  const ws4 = new WebSocket(RELAY);
  await new Promise(r => ws4.on("open", r));
  ws4.send("not json at all {{{{");
  try {
    await waitFor(ws4, "error", 2000);
    pass("Invalid JSON handled gracefully");
  } catch { fail("Invalid JSON", "no error or crash"); }
  ws4.close();

  // Test 5: Password protection — wrong password rejected
  const ws5 = new WebSocket(RELAY);
  await new Promise(r => ws5.on("open", r));
  send(ws5, { type: "create_room", deviceId: "dev5", name: "Owner", projectPath: "/p", password: "mypass", timestamp: ts() });
  const room5 = await waitFor(ws5, "room_created", 3000);

  const ws5b = new WebSocket(RELAY);
  await new Promise(r => ws5b.on("open", r));
  send(ws5b, { type: "join_room", deviceId: "dev5b", code: room5.room.code, name: "Intruder", projectPath: "/p", password: "wrongpass", timestamp: ts() });
  try {
    const err = await waitFor(ws5b, "error", 2000);
    if (err.error.includes("Wrong password")) pass("Wrong password rejected");
    else fail("Wrong password", err.error);
  } catch { fail("Wrong password", "no error received"); }
  ws5b.close();

  // Test 6: Password protection — no password rejected
  const ws6 = new WebSocket(RELAY);
  await new Promise(r => ws6.on("open", r));
  send(ws6, { type: "join_room", deviceId: "dev6", code: room5.room.code, name: "NoPass", projectPath: "/p", timestamp: ts() });
  try {
    const err = await waitFor(ws6, "error", 2000);
    if (err.error.includes("Wrong password")) pass("Missing password rejected");
    else fail("Missing password", err.error);
  } catch { fail("Missing password", "no error received"); }
  ws6.close();
  ws5.close();

  // Test 7: Joining non-existent room rejected
  const ws7 = new WebSocket(RELAY);
  await new Promise(r => ws7.on("open", r));
  send(ws7, { type: "join_room", deviceId: "dev7", code: "HIVE-ZZZZZZ", name: "Ghost", projectPath: "/p", timestamp: ts() });
  try {
    const err = await waitFor(ws7, "error", 2000);
    if (err.error.includes("not found")) pass("Non-existent room rejected");
    else fail("Non-existent room", err.error);
  } catch { fail("Non-existent room", "no error received"); }
  ws7.close();

  // Test 8: Lock file then try to lock from another device
  const ws8a = new WebSocket(RELAY);
  const ws8b = new WebSocket(RELAY);
  await new Promise(r => ws8a.on("open", r));
  await new Promise(r => ws8b.on("open", r));
  send(ws8a, { type: "create_room", deviceId: "lock1", name: "Locker", projectPath: "/p", timestamp: ts() });
  const lockRoom = await waitFor(ws8a, "room_created", 3000);
  send(ws8b, { type: "join_room", deviceId: "lock2", code: lockRoom.room.code, name: "Other", projectPath: "/p", timestamp: ts() });
  await waitFor(ws8b, "room_joined", 3000);
  send(ws8a, { type: "lock_file", deviceId: "lock1", code: lockRoom.room.code, name: "Locker", file: "important.ts", timestamp: ts() });
  await waitFor(ws8b, "file_locked", 3000);
  send(ws8b, { type: "lock_file", deviceId: "lock2", code: lockRoom.room.code, name: "Other", file: "important.ts", timestamp: ts() });
  try {
    const lockErr = await waitFor(ws8b, "lock_error", 2000);
    if (lockErr.lockedBy === "Locker") pass("Double lock prevented");
    else fail("Double lock", JSON.stringify(lockErr));
  } catch { fail("Double lock", "no error received"); }
  ws8a.close();
  ws8b.close();

  // Test 9: Terminal output too large rejected
  const ws9 = new WebSocket(RELAY);
  await new Promise(r => ws9.on("open", r));
  send(ws9, { type: "create_room", deviceId: "term1", name: "TermUser", projectPath: "/p", timestamp: ts() });
  const termRoom = await waitFor(ws9, "room_created", 3000);
  send(ws9, { type: "share_terminal", deviceId: "term1", code: termRoom.room.code, name: "TermUser", terminal: { command: "cat bigfile", output: "x".repeat(60000), exitCode: 0, cwd: "/p", sharedBy: "TermUser", timestamp: ts() }, timestamp: ts() });
  try {
    const err = await waitFor(ws9, "error", 2000);
    if (err.error.includes("too large")) pass("Large terminal output rejected");
    else fail("Terminal limit", err.error);
  } catch { fail("Terminal limit", "no error received"); }
  ws9.close();

  // Test 10: Full workflow still works after edge cases
  const wsA = new WebSocket(RELAY);
  const wsB = new WebSocket(RELAY);
  await new Promise(r => wsA.on("open", r));
  await new Promise(r => wsB.on("open", r));
  send(wsA, { type: "create_room", deviceId: "a1", name: "Zeus", projectPath: "/p", timestamp: ts() });
  const room = await waitFor(wsA, "room_created", 3000);
  send(wsB, { type: "join_room", deviceId: "b1", code: room.room.code, name: "Alice", projectPath: "/p", timestamp: ts() });
  await waitFor(wsB, "room_joined", 3000);
  send(wsA, { type: "chat_message", deviceId: "a1", code: room.room.code, name: "Zeus", content: "Works!", timestamp: ts() });
  const chatMsg = await waitFor(wsB, "chat_received", 3000);
  if (chatMsg.from === "Zeus" && chatMsg.content === "Works!") pass("Full workflow after edge cases");
  else fail("Full workflow", "unexpected response");
  wsA.close();
  wsB.close();

  // Test 11: Room code is 6 characters
  const ws11 = new WebSocket(RELAY);
  await new Promise(r => ws11.on("open", r));
  send(ws11, { type: "create_room", deviceId: "dev11", name: "Test", projectPath: "/p", timestamp: ts() });
  const room11 = await waitFor(ws11, "room_created", 3000);
  const codeLen = room11.room.code.replace("HIVE-", "").length;
  if (codeLen === 6) pass("Room code is 6 characters (" + room11.room.code + ")");
  else fail("Room code length", "got " + codeLen);
  ws11.close();

  // Test 12: Public room discovery
  const ws12 = new WebSocket(RELAY);
  await new Promise(r => ws12.on("open", r));
  send(ws12, { type: "create_room", deviceId: "pub1", name: "PubUser", projectPath: "/p", isPublic: true, timestamp: ts() });
  const pubRoom = await waitFor(ws12, "room_created", 3000);
  if (pubRoom.room.isPublic === true) pass("Public room created");
  else fail("Public room", "not public");

  const ws12b = new WebSocket(RELAY);
  await new Promise(r => ws12b.on("open", r));
  send(ws12b, { type: "list_rooms", deviceId: "disc1", timestamp: ts() });
  const list = await waitFor(ws12b, "room_list", 3000);
  if (list.rooms.some(r => r.code === pubRoom.room.code)) pass("Room discoverable in list");
  else fail("Room discovery", "not in list");
  ws12.close();
  ws12b.close();

  await new Promise(r => setTimeout(r, 500));
  console.log("\n  Result: " + testsPassed + " passed, " + testsFailed + " failed\n");
  process.exit(testsFailed > 0 ? 1 : 0);
}

run().catch(e => { console.error("FATAL:", e); process.exit(1); });
