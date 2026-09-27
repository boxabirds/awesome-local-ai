// node --test tools/vidi-gallery/tests/  — the review player's time maths (src/player.js).
const test = require("node:test");
const assert = require("node:assert");
const { frameAt, timeline, defaultSpeed } = require("../src/player.js");

test("the frame shown at t is the last one at or before t, for each page separately", () => {
  const p1 = [[10, "a"], [20, "b"], [30, "c"]], p2 = [[25, "x"]];
  assert.strictEqual(frameAt(p1, 9), null);      // before its first frame: nothing on screen yet
  assert.strictEqual(frameAt(p1, 10), "a");
  assert.strictEqual(frameAt(p1, 19.9), "a");
  assert.strictEqual(frameAt(p1, 20), "b");
  assert.strictEqual(frameAt(p1, 1e9), "c");
  assert.strictEqual(frameAt(p2, 24), null);
  assert.strictEqual(frameAt(p2, 26), "x");
  assert.strictEqual(frameAt([], 5), null);
});

test("the seek bar maps position to time and back, with long waits drawn narrow", () => {
  const WAIT_SHOWN = 400;
  const tl = timeline(0, 30000, [[1000, 29000]], WAIT_SHOWN);   // 1 s, a 28 s wait, 1 s
  const shown = 1000 + WAIT_SHOWN + 1000;
  assert.strictEqual(tl.pos(0), 0);
  assert.strictEqual(tl.pos(30000), 1);
  assert.ok(Math.abs(tl.pos(1000) - 1000 / shown) < 1e-9);
  assert.ok(Math.abs(tl.pos(29000) - 1400 / shown) < 1e-9);
  for (const t of [0, 500, 1000, 15000, 29000, 29500, 30000]) assert.ok(Math.abs(tl.timeAt(tl.pos(t)) - t) < 1e-6, `round trip at ${t}`);
  assert.strictEqual(tl.timeAt(-1), 0);          // dragging past either end clamps
  assert.strictEqual(tl.timeAt(2), 30000);
});

test("a path without waits is linear", () => {
  const tl = timeline(100, 500, [], 400);
  assert.strictEqual(tl.pos(300), 0.5);
  assert.strictEqual(tl.timeAt(0.25), 200);
});

test("short paths play slowly enough to watch", () => {
  const SPEEDS = [0.1, 0.25, 1, 2, 4, 8], MIN_PLAY_MS = 8000;
  assert.strictEqual(defaultSpeed(400, SPEEDS, MIN_PLAY_MS), 0.1);     // a 0.4 s test: slowest
  assert.strictEqual(defaultSpeed(3000, SPEEDS, MIN_PLAY_MS), 0.25);
  assert.strictEqual(defaultSpeed(30000, SPEEDS, MIN_PLAY_MS), 1);
});
