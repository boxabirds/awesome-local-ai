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
const SH = { shiftKey: true };

test("stories pane: up/down pick the story; right, Tab or Return go into the held-out tests", () => {
  assert.deepStrictEqual(keyAction(key("ArrowDown", "ArrowDown"), "stories"), { do: "story", dir: 1 });
  assert.deepStrictEqual(keyAction(key("ArrowUp", "ArrowUp"), "stories"), { do: "story", dir: -1 });
  for (const [k, code] of [["ArrowRight", "ArrowRight"], ["Tab", "Tab"], ["Enter", "Enter"]])
    assert.deepStrictEqual(keyAction(key(k, code), "stories"), { do: "pane", to: "tests" });
  assert.deepStrictEqual(keyAction(key("Tab", "Tab", SH), "stories"), { do: "none" });  // already the first pane
});

test("tests pane: up/down pick the test, left/right scrub (shift finer), Tab to the steps, shift-Tab or Esc back", () => {
  assert.deepStrictEqual(keyAction(key("ArrowDown", "ArrowDown"), "tests"), { do: "path", dir: 1 });
  assert.deepStrictEqual(keyAction(key("ArrowUp", "ArrowUp"), "tests"), { do: "path", dir: -1 });
  assert.deepStrictEqual(keyAction(key("ArrowRight", "ArrowRight"), "tests"), { do: "scrub", ms: SCRUB_MS });
  assert.deepStrictEqual(keyAction(key("ArrowLeft", "ArrowLeft", SH), "tests"), { do: "scrub", ms: -FINE_SCRUB_MS });
  assert.deepStrictEqual(keyAction(key("Tab", "Tab"), "tests"), { do: "pane", to: "steps" });
  assert.deepStrictEqual(keyAction(key("Tab", "Tab", SH), "tests"), { do: "pane", to: "stories" });
  assert.deepStrictEqual(keyAction(key("Escape", "Escape"), "tests"), { do: "pane", to: "stories" });
});

test("steps pane: up/down pick the step, left/right scrub, shift-Tab or Esc back to the tests", () => {
  assert.deepStrictEqual(keyAction(key("ArrowDown", "ArrowDown"), "steps"), { do: "step", dir: 1 });
  assert.deepStrictEqual(keyAction(key("ArrowUp", "ArrowUp"), "steps"), { do: "step", dir: -1 });
  assert.deepStrictEqual(keyAction(key("ArrowLeft", "ArrowLeft"), "steps"), { do: "scrub", ms: -SCRUB_MS });
  assert.deepStrictEqual(keyAction(key("ArrowRight", "ArrowRight", SH), "steps"), { do: "scrub", ms: FINE_SCRUB_MS });
  assert.deepStrictEqual(keyAction(key("Tab", "Tab", SH), "steps"), { do: "pane", to: "tests" });
  assert.deepStrictEqual(keyAction(key("Escape", "Escape"), "steps"), { do: "pane", to: "tests" });
  assert.deepStrictEqual(keyAction(key("Tab", "Tab"), "steps"), { do: "none" });  // already the last pane
});

test("in every pane: space plays, - and = scrub, digits jump, frames, speed, stories by bracket", () => {
  for (const pane of ["stories", "tests", "steps"]) {
    assert.deepStrictEqual(keyAction(key(" ", "Space"), pane), { do: "play" });
    assert.deepStrictEqual(keyAction(key("=", "Equal"), pane), { do: "scrub", ms: SCRUB_MS });
    assert.deepStrictEqual(keyAction(key("_", "Minus", SH), pane), { do: "scrub", ms: -FINE_SCRUB_MS });
    assert.deepStrictEqual(keyAction(key("5", "Digit5"), pane), { do: "jump", frac: 0.5 });
    assert.deepStrictEqual(keyAction(key("End", "End"), pane), { do: "jump", frac: 1 });
    assert.deepStrictEqual(keyAction(key(".", "Period"), pane), { do: "frame", dir: 1 });
    assert.deepStrictEqual(keyAction(key(">", "Period", SH), pane), { do: "speed", dir: 1 });
    assert.deepStrictEqual(keyAction(key("]", "BracketRight"), pane), { do: "story", dir: 1 });
    assert.deepStrictEqual(keyAction(key("?", "Slash", SH), pane), { do: "help" });
  }
  assert.ok(FINE_SCRUB_MS < SCRUB_MS);
});

test("verdicts: Return agrees and moves on, shift-Return disagrees and asks why, in the tests and steps panes", () => {
  for (const pane of ["tests", "steps"]) {
    assert.deepStrictEqual(keyAction(key("Enter", "Enter"), pane), { do: "verdict", v: "agree", next: true });
    assert.deepStrictEqual(keyAction(key("Enter", "Enter", SH), pane), { do: "verdict", v: "disagree", note: true });
    assert.deepStrictEqual(keyAction(key("a", "KeyA"), pane), { do: "verdict", v: "agree" });
    assert.deepStrictEqual(keyAction(key("d", "KeyD"), pane), { do: "verdict", v: "disagree" });
    assert.deepStrictEqual(keyAction(key("s", "KeyS"), pane), { do: "verdict", v: "skip" });
  }
  assert.deepStrictEqual(keyAction(key("n", "KeyN"), "tests"), { do: "note" });
  assert.deepStrictEqual(keyAction(key("o", "KeyO"), "tests"), { do: "open" });
  assert.deepStrictEqual(keyAction(key("w", "KeyW"), "steps"), { do: "waits" });
});

test("browser and system shortcuts pass through untouched", () => {
  assert.strictEqual(keyAction(key("r", "KeyR", { metaKey: true }), "tests"), null);
  assert.strictEqual(keyAction(key("=", "Equal", { metaKey: true }), "tests"), null);
  assert.strictEqual(keyAction(key("Tab", "Tab", { ctrlKey: true }), "tests"), null);
  assert.strictEqual(keyAction(key("q", "KeyQ"), "tests"), null);
});

test("the next and previous frame across everyone's screens", () => {
  const people = [[[10, "a"], [30, "b"]], [[20, "x"], [40, "y"]]];
  assert.strictEqual(nextFrame(people, 10, 1), 20);
  assert.strictEqual(nextFrame(people, 25, 1), 30);
  assert.strictEqual(nextFrame(people, 30, -1), 20);
  assert.strictEqual(nextFrame(people, 40, 1), null);
  assert.strictEqual(nextFrame(people, 10, -1), null);
});
