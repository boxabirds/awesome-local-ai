// node --test tools/vidi-gallery/tests/  — the review player's time maths (src/player.js).
const test = require("node:test");
const assert = require("node:assert");
const { frameAt, timeline, defaultSpeed, nextCheck, nextSpot, keyAction, nextFrame, scrubStep, placeToHash, placeFromHash, SCRUB, FINE_SCRUB } = require("../src/player.js");

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
  // In the tests pane a scrub carries on into the next or previous test at either end.
  assert.deepStrictEqual(keyAction(key("ArrowRight", "ArrowRight"), "tests"), { do: "scrub", frac: SCRUB, cross: true });
  assert.deepStrictEqual(keyAction(key("ArrowLeft", "ArrowLeft", SH), "tests"), { do: "scrub", frac: -FINE_SCRUB, cross: true });
  assert.deepStrictEqual(keyAction(key("Tab", "Tab"), "tests"), { do: "pane", to: "steps" });
  assert.deepStrictEqual(keyAction(key("Tab", "Tab", SH), "tests"), { do: "pane", to: "stories" });
});

test("steps pane: up/down pick the step, left/right scrub, shift-Tab or Esc back to the tests", () => {
  assert.deepStrictEqual(keyAction(key("ArrowDown", "ArrowDown"), "steps"), { do: "step", dir: 1 });
  assert.deepStrictEqual(keyAction(key("ArrowUp", "ArrowUp"), "steps"), { do: "step", dir: -1 });
  assert.deepStrictEqual(keyAction(key("ArrowLeft", "ArrowLeft"), "steps"), { do: "scrub", frac: -SCRUB });
  assert.deepStrictEqual(keyAction(key("ArrowRight", "ArrowRight", SH), "steps"), { do: "scrub", frac: FINE_SCRUB });
  assert.deepStrictEqual(keyAction(key("Tab", "Tab", SH), "steps"), { do: "pane", to: "tests" });
  assert.deepStrictEqual(keyAction(key("Escape", "Escape"), "steps"), { do: "pane", to: "tests" });
  assert.deepStrictEqual(keyAction(key("Tab", "Tab"), "steps"), { do: "none" });  // already the last pane
});

test("in every pane: digits jump, frames, speed, stories by bracket", () => {
  for (const pane of ["stories", "tests", "steps"]) {
    assert.deepStrictEqual(keyAction(key("5", "Digit5"), pane), { do: "jump", frac: 0.5 });
    assert.deepStrictEqual(keyAction(key("End", "End"), pane), { do: "jump", frac: 1 });
    assert.deepStrictEqual(keyAction(key(".", "Period"), pane), { do: "frame", dir: 1 });
    assert.deepStrictEqual(keyAction(key(">", "Period", SH), pane), { do: "speed", dir: 1 });
    assert.deepStrictEqual(keyAction(key("]", "BracketRight"), pane), { do: "story", dir: 1 });
    assert.deepStrictEqual(keyAction(key("?", "Slash", SH), pane), { do: "help" });
  }
  assert.ok(FINE_SCRUB < SCRUB);
});

test("verdicts move on: a d s score and go to the next test", () => {
  for (const pane of ["tests", "steps"]) {
    assert.deepStrictEqual(keyAction(key("a", "KeyA"), pane), { do: "verdict", v: "agree", next: true });
    assert.deepStrictEqual(keyAction(key("d", "KeyD"), pane), { do: "verdict", v: "disagree", next: true });
    assert.deepStrictEqual(keyAction(key("s", "KeyS"), pane), { do: "verdict", v: "skip", next: true });
  }
  assert.deepStrictEqual(keyAction(key("n", "KeyN"), "tests"), { do: "note" });
  assert.deepStrictEqual(keyAction(key("o", "KeyO"), "tests"), { do: "open" });
  assert.deepStrictEqual(keyAction(key("w", "KeyW"), "steps"), { do: "waits" });
});

test("= agrees and - disagrees, and each goes straight on to the next test", () => {
  for (const pane of ["tests", "steps"]) {
    assert.deepStrictEqual(keyAction(key("=", "Equal"), pane), { do: "verdict", v: "agree", next: true });
    assert.deepStrictEqual(keyAction(key("-", "Minus"), pane), { do: "verdict", v: "disagree", next: true });
    assert.deepStrictEqual(keyAction(key("+", "Equal", SH), pane), { do: "verdict", v: "agree", next: true });
  }
  assert.strictEqual(keyAction(key("=", "Equal"), "stories"), null);  // no test to score from the stories
});

test("the place in the review survives a reload: story, test and pane in the address", () => {
  const place = { story: 3, key: 0, idx: 4, pane: "tests" };
  assert.strictEqual(placeToHash(place), "#story=3&key=0&idx=4&pane=tests");
  assert.deepStrictEqual(placeFromHash(placeToHash(place)), place);
  assert.deepStrictEqual(placeFromHash("#story=5&pane=stories"), { story: 5, key: null, idx: null, pane: "stories" });
  assert.deepStrictEqual(placeFromHash(""), { story: null, key: null, idx: null, pane: null });
  assert.strictEqual(placeFromHash("#pane=bogus").pane, null);
});

test("a scrub stops at an end; one more press in the same direction goes to the next or previous test", () => {
  const EPS = 1e-9;
  assert.deepStrictEqual(scrubStep(0.5, SCRUB, true), { pos: 0.5 + SCRUB });
  assert.deepStrictEqual(scrubStep(1 - SCRUB / 2, SCRUB, true), { pos: 1 });        // lands on the end first
  assert.deepStrictEqual(scrubStep(1, SCRUB, true), { path: 1 });                   // then on to the next test
  assert.deepStrictEqual(scrubStep(1 - EPS, SCRUB, true), { path: 1 });
  assert.deepStrictEqual(scrubStep(0, -SCRUB, true), { path: -1 });                 // before the start: the previous test
  assert.deepStrictEqual(scrubStep(1, SCRUB, false), { pos: 1 });                   // without cross it stays put
  assert.deepStrictEqual(scrubStep(0, -SCRUB, false), { pos: 0 });
});

test("cmd/ctrl = or Return agrees with every test of the story; cmd/ctrl - disagrees; cmd/ctrl Esc clears", () => {
  for (const mod of [{ metaKey: true }, { ctrlKey: true }]) for (const pane of ["stories", "tests", "steps"]) {
    assert.deepStrictEqual(keyAction(key("=", "Equal", mod), pane), { do: "all", v: "agree" });
    assert.deepStrictEqual(keyAction(key("Enter", "Enter", mod), pane), { do: "all", v: "agree" });
    assert.deepStrictEqual(keyAction(key("-", "Minus", mod), pane), { do: "all", v: "disagree" });
    assert.deepStrictEqual(keyAction(key("Escape", "Escape", mod), pane), { do: "all", v: "" });
  }
});

test("browser and system shortcuts pass through untouched", () => {
  assert.strictEqual(keyAction(key("r", "KeyR", { metaKey: true }), "tests"), null);
  assert.strictEqual(keyAction(key("0", "Digit0", { metaKey: true }), "tests"), null);  // reset zoom stays the browser's
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

test("a scrub moves a share of the recording, so one press never crosses a short test end to end", () => {
  assert.ok(SCRUB > 0 && SCRUB <= 0.1, "a press moves at most a tenth of the recording");
  assert.ok(FINE_SCRUB < SCRUB);
  const tl = timeline(0, 100, [], 0);          // a 0.1 s recording
  const from = tl.pos(0), to = tl.timeAt(from + SCRUB);
  assert.ok(to > 0 && to < 100, `one press lands inside the recording, at ${to} ms`);
});

test("Space plays and stops in every pane; p does too", () => {
  for (const pane of ["stories", "tests", "steps"]) {
    assert.deepStrictEqual(keyAction(key(" ", "Space"), pane), { do: "play" });
    assert.deepStrictEqual(keyAction(key("p", "KeyP"), pane), { do: "play" });
  }
});

test("Return is = in the tests (agree and on), the right arrow in the stories, the down arrow in the steps", () => {
  assert.deepStrictEqual(keyAction(key("Enter", "Enter"), "tests"), keyAction(key("=", "Equal"), "tests"));
  assert.deepStrictEqual(keyAction(key("Enter", "Enter"), "stories"), keyAction(key("ArrowRight", "ArrowRight"), "stories"));
  assert.deepStrictEqual(keyAction(key("Enter", "Enter"), "steps"), keyAction(key("ArrowDown", "ArrowDown"), "steps"));
  assert.deepStrictEqual(keyAction(key("Enter", "Enter", SH), "tests"), { do: "verdict", v: "disagree", note: true });
});

test("Esc on a held-out test clears its verdict back to 'to review'; in the steps it goes back to the tests", () => {
  assert.deepStrictEqual(keyAction(key("Escape", "Escape"), "tests"), { do: "verdict", v: "" });
  assert.deepStrictEqual(keyAction(key("Escape", "Escape"), "steps"), { do: "pane", to: "tests" });
  assert.deepStrictEqual(keyAction(key("Escape", "Escape"), "stories"), { do: "escape" });
});
