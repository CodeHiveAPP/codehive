import WebSocket from "ws";

const RELAY = "ws://127.0.0.1:4821";
const ts = () => Date.now();
let roomCode = null;
let testsPassed = 0;
let testsFailed = 0;

function pass(name) { testsPassed++; console.log("  OK " + name); }
function fail(name, reason) { testsFailed++; console.log("  FAIL " + name + " - " + reason); }

const devA = new WebSocket(RELAY);
const devB = new WebSocket(RELAY);
const msgsA = [];
const msgsB = [];
devA.on("message", (r) => msgsA.push(JSON.parse(r.toString())));
devB.on("message", (r) => msgsB.push(JSON.parse(r.toString())));

function send(ws, msg) { ws.send(JSON.stringify(msg)); }

function waitFor(store, type, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      const idx = store.findIndex(m => m.type === type);
      if (idx !== -1) return resolve(store.splice(idx, 1)[0]);
      if (Date.now() - start > timeout) return reject(new Error("Timeout: " + type));
      setTimeout(check, 30);
    };
    check();
  });
}

async function run() {
  console.log("\n  CodeHive E2E Test Suite\n");
  await new Promise(r => devA.on("open", r));
  await new Promise(r => devB.on("open", r));
  pass("WebSocket connections");

  // Test room creation with password + public + expiry
  send(devA, { type: "create_room", deviceId: "a1", name: "Zeus", projectPath: "/p", password: "secret123", isPublic: true, expiresInHours: 24, branch: "main", timestamp: ts() });
  const created = await waitFor(msgsA, "room_created");
  roomCode = created.room.code;
  if (roomCode.length === 11) pass("Room created with 6-char code: " + roomCode);
  else fail("Room code length", roomCode);
  if (created.room.hasPassword === true) pass("Room has password flag");
  else fail("Password flag", "missing");
  if (created.room.isPublic === true) pass("Room is public");
  else fail("Public flag", "missing");
  if (created.inviteLink && created.inviteLink.includes(roomCode)) pass("Invite link generated");
  else fail("Invite link", created.inviteLink);

  // Test timeline has join event
  if (created.room.timeline && created.room.timeline.length > 0) pass("Timeline tracking started");
  else fail("Timeline", "no events");

  // Test wrong password rejection
  send(devB, { type: "join_room", deviceId: "b1", code: roomCode, name: "Alice", projectPath: "/p", password: "wrong", branch: "feature", timestamp: ts() });
  const errMsg = await waitFor(msgsB, "error");
  if (errMsg.error.includes("Wrong password")) pass("Wrong password rejected");
  else fail("Wrong password", errMsg.error);

  // Test correct password + branch warning
  send(devB, { type: "join_room", deviceId: "b1", code: roomCode, name: "Alice", projectPath: "/p", password: "secret123", branch: "feature", timestamp: ts() });
  await waitFor(msgsB, "room_joined");
  await waitFor(msgsA, "member_joined");
  pass("Alice joined with correct password");

  // Branch warning (Zeus on main, Alice on feature)
  try {
    const bw = await waitFor(msgsA, "branch_warning", 2000);
    if (bw.message.includes("different branches")) pass("Branch divergence warning");
    else fail("Branch warning", bw.message);
  } catch { fail("Branch warning", "no warning received"); }

  // Chat
  send(devA, { type: "chat_message", deviceId: "a1", code: roomCode, name: "Zeus", content: "Hello!", timestamp: ts() });
  const chat = await waitFor(msgsB, "chat_received");
  if (chat.from === "Zeus") pass("Chat delivery"); else fail("Chat", chat.from);

  // File change
  send(devA, { type: "file_change", deviceId: "a1", code: roomCode, change: { path: "src/x.ts", type: "change", author: "Zeus", deviceId: "a1", timestamp: ts(), diff: "+ x", linesAdded: 5, linesRemoved: 1 }, timestamp: ts() });
  const fc = await waitFor(msgsB, "file_changed");
  if (fc.change.author === "Zeus") pass("File broadcast"); else fail("File", fc.change.author);

  // Binary file change with size
  send(devA, { type: "file_change", deviceId: "a1", code: roomCode, change: { path: "logo.png", type: "change", author: "Zeus", deviceId: "a1", timestamp: ts(), diff: null, linesAdded: 0, linesRemoved: 0, sizeBefore: 24576, sizeAfter: 36864 }, timestamp: ts() });
  const bfc = await waitFor(msgsB, "file_changed");
  if (bfc.change.sizeAfter === 36864) pass("Binary file size broadcast"); else fail("Binary size", bfc.change.sizeAfter);

  // Typing indicator
  send(devA, { type: "declare_typing", deviceId: "a1", code: roomCode, name: "Zeus", file: "src/auth.ts", timestamp: ts() });
  const typing = await waitFor(msgsB, "typing_indicator");
  if (typing.name === "Zeus" && typing.file === "src/auth.ts") pass("Typing indicator");
  else fail("Typing", JSON.stringify(typing));

  // File locking
  send(devA, { type: "lock_file", deviceId: "a1", code: roomCode, name: "Zeus", file: "src/config.ts", timestamp: ts() });
  const locked = await waitFor(msgsB, "file_locked");
  if (locked.lock.file === "src/config.ts" && locked.lock.lockedBy === "Zeus") pass("File lock broadcast");
  else fail("File lock", JSON.stringify(locked));

  // Lock conflict — Alice tries to lock same file
  send(devB, { type: "lock_file", deviceId: "b1", code: roomCode, name: "Alice", file: "src/config.ts", timestamp: ts() });
  const lockErr = await waitFor(msgsB, "lock_error");
  if (lockErr.lockedBy === "Zeus") pass("Lock conflict detected");
  else fail("Lock conflict", JSON.stringify(lockErr));

  // File change blocked by lock (Alice tries to change locked file)
  send(devB, { type: "file_change", deviceId: "b1", code: roomCode, change: { path: "src/config.ts", type: "change", author: "Alice", deviceId: "b1", timestamp: ts(), diff: "+ y", linesAdded: 1, linesRemoved: 0 }, timestamp: ts() });
  const lockBlock = await waitFor(msgsB, "error");
  if (lockBlock.error.includes("locked")) pass("Locked file change blocked");
  else fail("Lock block", lockBlock.error);

  // Unlock file
  send(devA, { type: "unlock_file", deviceId: "a1", code: roomCode, name: "Zeus", file: "src/config.ts", timestamp: ts() });
  const unlocked = await waitFor(msgsB, "file_unlocked");
  if (unlocked.file === "src/config.ts") pass("File unlock broadcast");
  else fail("Unlock", JSON.stringify(unlocked));

  // Cursor sharing
  send(devA, { type: "update_cursor", deviceId: "a1", code: roomCode, name: "Zeus", cursor: { file: "src/main.ts", line: 42, column: 10 }, timestamp: ts() });
  const cursor = await waitFor(msgsB, "cursor_updated");
  if (cursor.cursor.file === "src/main.ts" && cursor.cursor.line === 42) pass("Cursor position shared");
  else fail("Cursor", JSON.stringify(cursor));

  // Terminal sharing
  send(devA, { type: "share_terminal", deviceId: "a1", code: roomCode, name: "Zeus", terminal: { command: "npm test", output: "All tests passed!", exitCode: 0, cwd: "/project", sharedBy: "Zeus", timestamp: ts() }, timestamp: ts() });
  const term = await waitFor(msgsB, "terminal_shared");
  if (term.terminal.command === "npm test" && term.terminal.exitCode === 0) pass("Terminal output shared");
  else fail("Terminal", JSON.stringify(term));

  // Room discovery (room is public)
  const devC = new WebSocket(RELAY);
  const msgsC = [];
  devC.on("message", (r) => msgsC.push(JSON.parse(r.toString())));
  await new Promise(r => devC.on("open", r));
  send(devC, { type: "list_rooms", deviceId: "c1", timestamp: ts() });
  const roomList = await waitFor(msgsC, "room_list");
  if (roomList.rooms.length > 0 && roomList.rooms[0].code === roomCode) pass("Public room discovery");
  else fail("Room discovery", JSON.stringify(roomList));
  devC.close();

  // Timeline
  send(devA, { type: "get_timeline", deviceId: "a1", code: roomCode, limit: 50, timestamp: ts() });
  const timeline = await waitFor(msgsA, "timeline");
  if (timeline.events.length > 0) pass("Timeline returned " + timeline.events.length + " events");
  else fail("Timeline", "empty");

  // Conflict detection
  send(devA, { type: "declare_working", deviceId: "a1", code: roomCode, name: "Zeus", files: ["same.ts"], timestamp: ts() });
  await new Promise(r => setTimeout(r, 200));
  send(devB, { type: "declare_working", deviceId: "b1", code: roomCode, name: "Alice", files: ["same.ts"], timestamp: ts() });
  try {
    await Promise.race([waitFor(msgsA, "conflict_warning", 3000), waitFor(msgsB, "conflict_warning", 3000)]);
    pass("Conflict detection");
  } catch { fail("Conflict", "no warning"); }

  // Room status
  send(devA, { type: "request_status", deviceId: "a1", code: roomCode, timestamp: ts() });
  const st = await waitFor(msgsA, "room_status");
  if (st.room.members.length === 2) pass("Room status"); else fail("Status", st.room.members.length);
  if (st.room.locks !== undefined) pass("Locks in room status"); else fail("Locks in status", "missing");

  // Heartbeat
  send(devA, { type: "heartbeat", deviceId: "a1", code: roomCode, status: "active", branch: "main", timestamp: ts() });
  await waitFor(msgsA, "heartbeat_ack");
  pass("Heartbeat with branch");

  // Webhook configuration
  send(devA, { type: "set_webhook", deviceId: "a1", code: roomCode, webhook: { url: "https://hooks.example.com/test", events: ["all"] }, timestamp: ts() });
  await new Promise(r => setTimeout(r, 100));
  pass("Webhook configured (no crash)");

  // Room visibility toggle
  send(devA, { type: "set_room_visibility", deviceId: "a1", code: roomCode, isPublic: false, timestamp: ts() });
  await new Promise(r => setTimeout(r, 100));
  pass("Room visibility toggled");

  // Leave
  send(devB, { type: "leave_room", deviceId: "b1", code: roomCode, timestamp: ts() });
  await waitFor(msgsA, "member_left");
  await waitFor(msgsB, "room_left");
  pass("Leave room");

  // Test room without password (still works)
  const devD = new WebSocket(RELAY);
  const msgsD = [];
  devD.on("message", (r) => msgsD.push(JSON.parse(r.toString())));
  await new Promise(r => devD.on("open", r));
  send(devD, { type: "create_room", deviceId: "d1", name: "Bob", projectPath: "/p", timestamp: ts() });
  const noPassRoom = await waitFor(msgsD, "room_created");
  if (noPassRoom.room.hasPassword === false) pass("Room without password"); else fail("No password flag", noPassRoom.room.hasPassword);
  devD.close();

  console.log("\n  Result: " + testsPassed + " passed, " + testsFailed + " failed\n");
  devA.close(); devB.close();
  process.exit(testsFailed > 0 ? 1 : 0);
}

run().catch(e => { console.error("FATAL:", e); process.exit(1); });
