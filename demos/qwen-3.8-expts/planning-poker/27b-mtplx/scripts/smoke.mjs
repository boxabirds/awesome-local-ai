// End-to-end smoke test against a running `wrangler dev` (default port 8787).
// Usage: npm run dev:worker, then: node scripts/smoke.mjs
const BASE = process.env.BASE ?? "http://127.0.0.1:8787";
const TIMEOUT_MS = 5000;

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function waitFor(ws, predicate, label, timeoutMs = TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${label}`)), timeoutMs);
    const prev = ws.onmessage;
    ws.onmessage = (event) => {
      prev?.(event);
      const msg = JSON.parse(String(event.data));
      if (predicate(msg)) {
        clearTimeout(timer);
        ws.onmessage = prev;
        resolve(msg);
      }
    };
  });
}

function client() {
  const url = BASE.replace(/^http/, "ws");
  let gameId = null;
  const ws = new WebSocket(`${url}/api/games/`);
  return ws;
}

async function main() {
  const health = await fetch(`${BASE}/health`);
  if (!health.ok) fail(`health check failed (${health.status})`);
  console.log("health ok");

  const res = await fetch(`${BASE}/api/games`, { method: "POST" });
  if (!res.ok) fail(`create game failed (${res.status})`);
  const { gameId } = await res.json();
  console.log("created game:", gameId);

  const wsUrl = `${BASE.replace(/^http/, "ws")}/api/games/${gameId}/ws`;
  const alice = new WebSocket(wsUrl);
  const bob = new WebSocket(wsUrl);

  const state = {};
  for (const [who, ws] of [["alice", alice], ["bob", bob]]) {
    ws.onmessage = (event) => {
      const msg = JSON.parse(String(event.data));
      if (msg.type === "state") state[who] = msg.state;
    };
  }

  const open = (ws) => new Promise((resolve) => (ws.onopen = resolve));
  await Promise.all([open(alice), open(bob)]);

  const aliceJoined = waitFor(alice, (m) => m.type === "joined", "alice joined");
  const bobJoined = waitFor(bob, (m) => m.type === "joined", "bob joined");
  alice.send(JSON.stringify({ type: "join", name: "Alice" }));
  bob.send(JSON.stringify({ type: "join", name: "Bob" }));
  const [ja, jb] = await Promise.all([aliceJoined, bobJoined]);
  console.log("joined:", ja.playerId, jb.playerId);

  const aliceIsFacilitator = waitFor(alice, (m) => m.type === "state" && m.state.facilitatorId === ja.playerId, "facilitator");
  await aliceIsFacilitator;
  console.log("alice is facilitator");

  const hasIssue = waitFor(alice, (m) => m.type === "state" && m.state.issues.length === 1, "issue added");
  alice.send(JSON.stringify({ type: "addIssue", title: "Build login", description: "OAuth + session" }));
  await hasIssue;
  const issueId = state.alice.issues[0].id;
  console.log("issue added:", issueId);

  const voting = waitFor(alice, (m) => m.type === "state" && m.state.phase === "voting", "round started");
  alice.send(JSON.stringify({ type: "startRound", issueId }));
  await voting;
  console.log("round started");

  const votingForBob = waitFor(bob, (m) => m.type === "state" && m.state.phase === "voting", "bob sees voting");
  await votingForBob;

  const revealedForBoth = Promise.all([
    waitFor(alice, (m) => m.type === "state" && m.state.phase === "revealed", "alice sees revealed"),
    waitFor(bob, (m) => m.type === "state" && m.state.phase === "revealed", "bob sees revealed"),
  ]);
  alice.send(JSON.stringify({ type: "vote", value: 5 }));
  bob.send(JSON.stringify({ type: "vote", value: 5 }));
  await revealedForBoth;
  console.log("revealed, estimate:", state.alice.issues[0].estimate);
  if (state.alice.issues[0].estimate !== 5) fail("expected estimate 5");

  const waiting = waitFor(alice, (m) => m.type === "state" && m.state.phase === "waiting", "next issue");
  alice.send(JSON.stringify({ type: "nextIssue" }));
  await waiting;
  if (state.alice.issues[0].status !== "done") fail(`expected done, got ${state.alice.issues[0].status}`);
  console.log("issue done");

  // Non-facilitator actions must be rejected with an error message.
  const bobError = waitFor(bob, (m) => m.type === "error", "bob addIssue rejected");
  bob.send(JSON.stringify({ type: "addIssue", title: "nope", description: "" }));
  const err = await bobError;
  console.log("bob rejected as expected:", err.message);

  alice.close();
  bob.close();
  console.log("PASS: smoke test complete");
  process.exit(0);
}

main().catch((e) => fail(e.message));
