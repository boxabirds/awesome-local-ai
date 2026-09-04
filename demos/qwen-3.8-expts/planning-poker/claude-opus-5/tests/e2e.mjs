#!/usr/bin/env node
/**
 * End-to-end smoke test against a running server.
 *
 *   npm run build && npx wrangler dev      # terminal 1
 *   node tests/e2e.mjs                     # terminal 2
 *
 * Drives two real WebSocket clients through a full round and asserts the one
 * property that matters most: a hidden vote never reaches another player.
 */
import assert from "node:assert/strict";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:8787";
const WS_BASE = BASE.replace(/^http/, "ws");
const SETTLE_MS = 250;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class Player {
  constructor(name, role = "voter") {
    this.name = name;
    this.role = role;
    this.state = null;
  }

  async join(code) {
    const params = new URLSearchParams({
      name: this.name,
      role: this.role,
      cid: `e2e-${this.name}-${Date.now()}`,
    });
    this.socket = new WebSocket(`${WS_BASE}/api/rooms/${code}/ws?${params}`);
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.t === "state") {
        this.state = message.room;
        this.id = message.youId;
      }
    });
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    await sleep(SETTLE_MS);
  }

  send(message) {
    this.socket.send(JSON.stringify(message));
  }

  seat(name) {
    return this.state?.players.find((p) => p.name === name);
  }

  close() {
    this.socket?.close();
  }
}

let failures = 0;
async function step(label, fn) {
  try {
    await fn();
    console.log(`  ok  ${label}`);
  } catch (error) {
    failures++;
    console.error(`FAIL  ${label}\n      ${error.message}`);
  }
}

async function main() {
  console.log(`Running against ${BASE}\n`);

  const health = await fetch(`${BASE}/health`).then((r) => r.json());
  assert.equal(health.status, "ok", "server is not healthy");
  console.log(`  ok  health: ${health.environment} ${health.version}\n`);

  const created = await fetch(`${BASE}/api/rooms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "E2E session", deckId: "fibonacci" }),
  }).then((r) => r.json());
  assert.match(created.code, /^[a-z0-9]{3}-[a-z0-9]{3}-[a-z0-9]{3}$/);
  console.log(`  ok  created room ${created.code}\n`);

  const ada = new Player("Ada");
  const alan = new Player("Alan");
  const grace = new Player("Grace", "spectator");

  await ada.join(created.code);
  await alan.join(created.code);
  await grace.join(created.code);
  await sleep(SETTLE_MS);

  await step("everyone sees three seats", () => {
    assert.equal(ada.state.players.length, 3);
    assert.equal(alan.state.players.length, 3);
  });

  await step("the first player to arrive facilitates", () => {
    assert.equal(ada.seat("Ada").isFacilitator, true);
    assert.equal(alan.seat("Alan").isFacilitator, false);
  });

  // Auto-reveal is on by default, so turn it off to test the hidden phase.
  ada.send({ t: "setAutoReveal", enabled: false });
  await sleep(SETTLE_MS);

  ada.send({ t: "vote", value: "5" });
  await sleep(SETTLE_MS);

  await step("a hidden vote is never sent to another player", () => {
    const adaSeenByAlan = alan.seat("Ada");
    assert.equal(adaSeenByAlan.hasVoted, true, "Alan should see that Ada has played");
    assert.equal(adaSeenByAlan.vote, undefined, "Alan must not receive Ada's card");
  });

  await step("a player can see their own hidden card", () => {
    assert.equal(ada.seat("Ada").vote, "5");
  });

  await step("a spectator cannot play a card", async () => {
    grace.send({ t: "vote", value: "8" });
    await sleep(SETTLE_MS);
    assert.equal(ada.seat("Grace").hasVoted, false);
  });

  await step("a non-facilitator cannot reveal", async () => {
    alan.send({ t: "reveal" });
    await sleep(SETTLE_MS);
    assert.equal(ada.state.revealed, false);
  });

  alan.send({ t: "vote", value: "8" });
  await sleep(SETTLE_MS);
  ada.send({ t: "reveal" });
  await sleep(SETTLE_MS);

  await step("reveal releases every card and the round stats", () => {
    assert.equal(alan.state.revealed, true);
    assert.equal(alan.seat("Ada").vote, "5");
    assert.equal(alan.state.stats.average, 6.5);
    assert.equal(alan.state.stats.consensus, false);
    assert.deepEqual(alan.state.stats.spread, { low: "5", high: "8" });
  });

  await step("a new round clears every card", async () => {
    ada.send({ t: "newRound" });
    await sleep(SETTLE_MS);
    assert.equal(ada.state.revealed, false);
    assert.equal(ada.state.players.every((p) => !p.hasVoted), true);
  });

  await step("the backlog records the agreed estimate", async () => {
    ada.send({ t: "addIssues", issues: [{ key: "E2E-1", title: "Ship it" }] });
    await sleep(SETTLE_MS);
    ada.send({ t: "vote", value: "3" });
    alan.send({ t: "vote", value: "3" });
    await sleep(SETTLE_MS);
    ada.send({ t: "reveal" });
    await sleep(SETTLE_MS);
    assert.equal(ada.state.stats.consensus, true);
    ada.send({ t: "commitEstimate" });
    await sleep(SETTLE_MS);
    assert.equal(ada.state.issues[0].estimate, "3");
  });

  await step("changing the deck starts a clean round", async () => {
    ada.send({ t: "setDeck", deckId: "t-shirt" });
    await sleep(SETTLE_MS);
    assert.equal(ada.state.deckId, "t-shirt");
    assert.equal(ada.state.revealed, false);
    assert.ok(ada.state.cards.includes("XL"));
  });

  await step("the facilitator can remove a player", async () => {
    ada.send({ t: "kick", playerId: alan.id });
    await sleep(SETTLE_MS * 2);
    assert.equal(ada.seat("Alan"), undefined);
  });

  for (const player of [ada, alan, grace]) player.close();

  console.log(failures === 0 ? "\nAll e2e checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
