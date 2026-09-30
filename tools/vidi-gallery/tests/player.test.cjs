// node --test tools/vidi-gallery/tests/  — the review player's time maths (src/player.js).
const test = require("node:test");
const assert = require("node:assert");
const { frameAt, timeline, defaultSpeed, nextCheck, nextSpot, keyAction, nextFrame, SCRUB_MS, FINE_SCRUB_MS } = require("../src/player.js");

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

test("→ and ← step through the checks, then report that the path has run out", () => {
  const checks = [100, 200, 300], EPS = 1;
  assert.strictEqual(nextCheck(checks, 0, 1, EPS), 100);
  assert.strictEqual(nextCheck(checks, 100, 1, EPS), 200);
  assert.strictEqual(nextCheck(checks, 300, 1, EPS), null);    // past the last check: move on
  assert.strictEqual(nextCheck(checks, 300, -1, EPS), 200);
  assert.strictEqual(nextCheck(checks, 100, -1, EPS), null);   // before the first: move back
  assert.strictEqual(nextCheck([], 0, 1, EPS), null);
});

test("moving on from a path goes to the next path, then off the end of the story", () => {
  // three paths in the story; i is the current one's position
  assert.deepStrictEqual(nextSpot(3, 0, 1), {path: 1});
  assert.deepStrictEqual(nextSpot(3, 2, 1), {story: 1});      // last path → next story
  assert.deepStrictEqual(nextSpot(3, 0, -1), {story: -1});    // first path → previous story
  assert.deepStrictEqual(nextSpot(3, -1, 1), {path: 0});      // nothing selected yet → the first
  assert.deepStrictEqual(nextSpot(0, -1, 1), {story: 1});     // a story with no recorded paths
});

const key = (k, code, mods = {}) => ({ key: k, code, shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, ...mods });

test("keys: moving between paths and stories", () => {
  for (const [k, code] of [["ArrowDown", "ArrowDown"], ["j", "KeyJ"], ["Tab", "Tab"]]) assert.deepStrictEqual(keyAction(key(k, code)), { do: "path", dir: 1 });
  for (const [k, code, m] of [["ArrowUp", "ArrowUp", {}], ["k", "KeyK", {}], ["Tab", "Tab", { shiftKey: true }]]) assert.deepStrictEqual(keyAction(key(k, code, m)), { do: "path", dir: -1 });
  assert.deepStrictEqual(keyAction(key("]", "BracketRight")), { do: "story", dir: 1 });
  assert.deepStrictEqual(keyAction(key("PageUp", "PageUp")), { do: "story", dir: -1 });
});

test("keys: playing, checks, steps and frames", () => {
  assert.deepStrictEqual(keyAction(key(" ", "Space")), { do: "play" });
  assert.deepStrictEqual(keyAction(key("ArrowRight", "ArrowRight")), { do: "check", dir: 1 });
  assert.deepStrictEqual(keyAction(key("ArrowLeft", "ArrowLeft", { shiftKey: true })), { do: "step", dir: -1 });
  assert.deepStrictEqual(keyAction(key(".", "Period")), { do: "frame", dir: 1 });
  assert.deepStrictEqual(keyAction(key(",", "Comma")), { do: "frame", dir: -1 });
  assert.deepStrictEqual(keyAction(key(">", "Period", { shiftKey: true })), { do: "speed", dir: 1 });
  assert.deepStrictEqual(keyAction(key("<", "Comma", { shiftKey: true })), { do: "speed", dir: -1 });
});

test("keys: - and = scrub a second; with shift, a tenth; by key position, whatever the layout prints", () => {
  assert.deepStrictEqual(keyAction(key("=", "Equal")), { do: "scrub", ms: SCRUB_MS });
  assert.deepStrictEqual(keyAction(key("-", "Minus")), { do: "scrub", ms: -SCRUB_MS });
  assert.deepStrictEqual(keyAction(key("+", "Equal", { shiftKey: true })), { do: "scrub", ms: FINE_SCRUB_MS });
  assert.deepStrictEqual(keyAction(key("_", "Minus", { shiftKey: true })), { do: "scrub", ms: -FINE_SCRUB_MS });
  assert.ok(FINE_SCRUB_MS < SCRUB_MS);
});

test("keys: digits jump to tenths of the recording; Home and End to its ends", () => {
  assert.deepStrictEqual(keyAction(key("0", "Digit0")), { do: "jump", frac: 0 });
  assert.deepStrictEqual(keyAction(key("5", "Digit5")), { do: "jump", frac: 0.5 });
  assert.deepStrictEqual(keyAction(key("9", "Numpad9")), { do: "jump", frac: 0.9 });
  assert.deepStrictEqual(keyAction(key("Home", "Home")), { do: "jump", frac: 0 });
  assert.deepStrictEqual(keyAction(key("End", "End")), { do: "jump", frac: 1 });
});

test("keys: Return agrees and moves on; shift-Return disagrees and asks why; the rest", () => {
  assert.deepStrictEqual(keyAction(key("Enter", "Enter")), { do: "verdict", v: "agree", next: true });
  assert.deepStrictEqual(keyAction(key("Enter", "Enter", { shiftKey: true })), { do: "verdict", v: "disagree", note: true });
  assert.deepStrictEqual(keyAction(key("a", "KeyA")), { do: "verdict", v: "agree" });
  assert.deepStrictEqual(keyAction(key("d", "KeyD")), { do: "verdict", v: "disagree" });
  assert.deepStrictEqual(keyAction(key("s", "KeyS")), { do: "verdict", v: "skip" });
  assert.deepStrictEqual(keyAction(key("n", "KeyN")), { do: "note" });
  assert.deepStrictEqual(keyAction(key("o", "KeyO")), { do: "open" });
  assert.deepStrictEqual(keyAction(key("w", "KeyW")), { do: "waits" });
  assert.deepStrictEqual(keyAction(key("Escape", "Escape")), { do: "escape" });
  assert.deepStrictEqual(keyAction(key("?", "Slash", { shiftKey: true })), { do: "help" });
});

test("keys: browser and system shortcuts pass through untouched", () => {
  assert.strictEqual(keyAction(key("r", "KeyR", { metaKey: true })), null);   // reload
  assert.strictEqual(keyAction(key("=", "Equal", { metaKey: true })), null);  // zoom
  assert.strictEqual(keyAction(key("Tab", "Tab", { ctrlKey: true })), null);  // next tab
  assert.strictEqual(keyAction(key("q", "KeyQ")), null);
});

test("the next and previous frame across everyone's screens", () => {
  const people = [[[10, "a"], [30, "b"]], [[20, "x"], [40, "y"]]];
  assert.strictEqual(nextFrame(people, 10, 1), 20);
  assert.strictEqual(nextFrame(people, 25, 1), 30);
  assert.strictEqual(nextFrame(people, 30, -1), 20);
  assert.strictEqual(nextFrame(people, 40, 1), null);
  assert.strictEqual(nextFrame(people, 10, -1), null);
});
