// node --test tools/vidi-gallery/tests/  — the review player's time maths (src/player.js).
const test = require("node:test");
const assert = require("node:assert");
const { frameAt, timeline, defaultSpeed, nextCheck, nextSpot, keyAction, nextFrame, scrubStep, placeToHash, placeFromHash, SCRUB, FINE_SCRUB,
  answered, ownOf, pathView, stepMark, bulkTargets, KEYS, describeBuildFailure } = require("../src/player.js");

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

test("verdicts move on: a d s agree / disagree / skip, as before, and go to the next test", () => {
  for (const pane of ["tests", "steps"]) {
    assert.deepStrictEqual(keyAction(key("a", "KeyA"), pane), { do: "verdict", v: "agree", next: true });
    assert.deepStrictEqual(keyAction(key("d", "KeyD"), pane), { do: "verdict", v: "disagree", next: true });
    assert.deepStrictEqual(keyAction(key("s", "KeyS"), pane), { do: "verdict", v: "skip", next: true });
  }
  assert.deepStrictEqual(keyAction(key("n", "KeyN"), "tests"), { do: "note" });
  assert.deepStrictEqual(keyAction(key("o", "KeyO"), "tests"), { do: "open" });
  assert.deepStrictEqual(keyAction(key("w", "KeyW"), "steps"), { do: "waits" });
});

test("= says the test passes and - that it fails, as the judge sees it, and each goes straight on", () => {
  for (const pane of ["tests", "steps"]) {
    assert.deepStrictEqual(keyAction(key("=", "Equal"), pane), { do: "verdict", v: "pass", next: true });
    assert.deepStrictEqual(keyAction(key("-", "Minus"), pane), { do: "verdict", v: "fail", next: true });
    assert.deepStrictEqual(keyAction(key("+", "Equal", SH), pane), { do: "verdict", v: "pass", next: true });
  }
  assert.strictEqual(keyAction(key("=", "Equal"), "stories"), null);  // no test to score from the stories
  assert.strictEqual(keyAction(key("-", "Minus"), "stories"), null);
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
  assert.strictEqual(keyAction(key("=", "Equal", { metaKey: true, altKey: true }), "tests"), null);  // alt: the browser's
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

test("Return is = in the tests (passes, and on), the right arrow in the stories, the down arrow in the steps", () => {
  assert.deepStrictEqual(keyAction(key("Enter", "Enter"), "tests"), keyAction(key("=", "Equal"), "tests"));
  assert.deepStrictEqual(keyAction(key("Enter", "Enter"), "stories"), keyAction(key("ArrowRight", "ArrowRight"), "stories"));
  assert.deepStrictEqual(keyAction(key("Enter", "Enter"), "steps"), keyAction(key("ArrowDown", "ArrowDown"), "steps"));
  assert.deepStrictEqual(keyAction(key("Enter", "Enter", SH), "tests"), { do: "verdict", v: "fail", note: true });
});

test("Esc on a held-out test clears its verdict back to 'to review'; in the steps it goes back to the tests", () => {
  assert.deepStrictEqual(keyAction(key("Escape", "Escape"), "tests"), { do: "verdict", v: "" });
  assert.deepStrictEqual(keyAction(key("Escape", "Escape"), "steps"), { do: "pane", to: "tests" });
  assert.deepStrictEqual(keyAction(key("Escape", "Escape"), "stories"), { do: "escape" });
});

// ---------- the automated result stays hidden until the judge has given their own verdict ----------

// A held-out test as /api/review/paths sends it: title only until answered, then its result too.
const HIDDEN = { title: "two people see the same note", answered: false, video: false };
const SHOWN = (status) => ({ title: "two people see the same note", answered: true, status, error: "boom", trace: "x/trace.zip", video: false });

test("only the judge's own verdict counts as answered: not a skip, a note alone or nothing", () => {
  for (const v of ["agree", "disagree", "pass", "fail"]) assert.strictEqual(answered(v), true, v);
  for (const v of ["", "skip", undefined, null]) assert.strictEqual(answered(v), false, String(v));
});

test("the judge's own pass / fail comes back from the stored agree / disagree and the result", () => {
  assert.strictEqual(ownOf("agree", "passed"), "pass");
  assert.strictEqual(ownOf("disagree", "passed"), "fail");
  assert.strictEqual(ownOf("agree", "failed"), "fail");
  assert.strictEqual(ownOf("disagree", "failed"), "pass");
  assert.strictEqual(ownOf("agree", "timedOut"), "fail");     // a timeout is not a pass
  assert.strictEqual(ownOf("pass", undefined), "pass");       // an earlier verdict given as pass / fail
  assert.strictEqual(ownOf("fail", "passed"), "fail");
  for (const v of ["", "skip", undefined]) assert.strictEqual(ownOf(v, "passed"), null, String(v));
  assert.strictEqual(ownOf("agree", undefined), null, "no result to compare with: no guess");
});

test("an unanswered test shows no result: not in its row, its mark, its tooltip or its colours", () => {
  for (const v of ["", "skip", undefined]) {
    const view = pathView(HIDDEN, v);
    assert.strictEqual(view.automated, null);
    assert.strictEqual(view.own, null);
    assert.strictEqual(view.pill, "?");
    assert.strictEqual(view.pillClass, "hidden");
    assert.strictEqual(view.header, "Automated result: hidden until you judge");
    assert.strictEqual(view.headerClass, "hidden");
    const text = JSON.stringify(view);
    for (const tell of ["passed", "failed", "timedOut", "agree", "boom", "trace"]) assert.ok(!text.includes(tell), `${tell} in ${text}`);
  }
  assert.deepStrictEqual([pathView(HIDDEN, "").mark, pathView(HIDDEN, "").markClass], ["to review", "todo"]);
  assert.deepStrictEqual([pathView(HIDDEN, "skip").mark, pathView(HIDDEN, "skip").markClass], ["skip", "skip"]);
});

test("even a payload that did carry the result shows nothing until the judge answers", () => {
  // The page does not trust the server alone: the row, mark and header ignore a result sent too early.
  const early = { ...SHOWN("failed"), answered: false };
  const view = pathView(early, "");
  assert.strictEqual(view.automated, null);
  assert.ok(!JSON.stringify(view).includes("failed"));
});

test("once answered, the automated result shows beside the judge's own", () => {
  const cases = [
    ["agree", "failed", "fail", "you: fail · agree"],
    ["disagree", "failed", "pass", "you: pass · disagree"],
    ["agree", "passed", "pass", "you: pass · agree"],
    ["disagree", "timedOut", "pass", "you: pass · disagree"],
  ];
  for (const [verdict, status, own, mark] of cases) {
    const view = pathView(SHOWN(status), verdict);
    assert.strictEqual(view.automated, status);
    assert.strictEqual(view.own, own);
    assert.strictEqual(view.mark, mark);
    assert.strictEqual(view.markClass, verdict);
    assert.deepStrictEqual([view.pill, view.pillClass], [status, status]);
    assert.strictEqual(view.header, `Automated: ${status.toUpperCase()} · you: ${own.toUpperCase()}`);
    assert.strictEqual(view.headerClass, status);
  }
});

test("an earlier verdict stored as pass / fail reads as agree or disagree once shown", () => {
  assert.deepStrictEqual([pathView(SHOWN("failed"), "fail").mark, pathView(SHOWN("failed"), "fail").markClass], ["you: fail · agree", "agree"]);
  assert.deepStrictEqual([pathView(SHOWN("failed"), "pass").mark, pathView(SHOWN("failed"), "pass").markClass], ["you: pass · disagree", "disagree"]);
});

test("browser steps: no tick or cross, and one colour for every check, until the judge answers", () => {
  const check = { kind: "check", error: "" }, failedCheck = { kind: "check", error: "expected visible" }, action = { kind: "action", error: "" };
  assert.deepStrictEqual(stepMark(check, false), stepMark(failedCheck, false), "a hidden walkthrough never marks a check");
  assert.deepStrictEqual(stepMark(check, false), { sym: "•", cls: "hid", tick: "chk" });
  assert.deepStrictEqual(stepMark(action, false), { sym: "", cls: "", tick: "act" });
  assert.deepStrictEqual(stepMark(check, true), { sym: "✓", cls: "ok", tick: "ok" });
  assert.deepStrictEqual(stepMark(failedCheck, true), { sym: "✗", cls: "bad", tick: "bad" });
  assert.deepStrictEqual(stepMark(action, true), { sym: "", cls: "", tick: "act" });
});

test("a whole-story agree or disagree covers every test of the story, overwriting earlier verdicts; only changes are saved", () => {
  const verdicts = ["agree", "disagree", "", "skip", undefined, "fail"];
  assert.deepStrictEqual(bulkTargets(verdicts, "agree"), [1, 2, 3, 4, 5], "every test not already agreed, judged or not");
  assert.deepStrictEqual(bulkTargets(verdicts, "disagree"), [0, 2, 3, 4, 5]);
  assert.deepStrictEqual(bulkTargets(verdicts, ""), [0, 1, 3, 5], "only tests with a verdict need clearing");
  assert.deepStrictEqual(bulkTargets([], "agree"), []);
});

test("a bulk agree or disagree is a verdict: each test's result shows after it", () => {
  for (const v of ["agree", "disagree"]) {
    assert.strictEqual(answered(v), true);
    assert.strictEqual(pathView(SHOWN("failed"), v).automated, "failed");
  }
});

test("the keys sheet says what a verdict and the whole-story keys mean with the result hidden", () => {
  const sheet = Object.fromEntries(KEYS);
  assert.match(sheet["Tests: = Return · -"], /passes · fails, as you see it/);
  assert.match(sheet["a d s"], /agree \/ disagree .*without seeing it.* \/ skip/);
  const bulk = sheet["⌘= ⌘Return · ⌘- · ⌘Esc"];
  assert.match(bulk, /agree with every test · disagree with every test/);
  assert.match(bulk, /whatever it is/);
  assert.match(bulk, /overwrites earlier verdicts/);
  assert.match(bulk, /results then show/);
  assert.match(sheet["Hidden"], /automated result.*hidden until you give your own/);
});

// ---------- a build that did not prepare ----------
// The review page showed "failed: failed: npm run build failed: > vidi6@0.0.1 build > tsc --noEmit && vite build":
// the server's error already starts with "failed:", and the page cut it at 80 characters, which keeps the npm
// banner and throws away the compiler errors -- the only part a judge can use. These are the shapes the
// gallery's own `run` helper produces ("<command> failed: <tail of its output>"). The first is the real text
// from v2-q36fork-b-r1, story 1, as the live gallery returned it.

const REAL_TSC = "failed: npm run build failed: \n> vidi6@0.0.1 build\n> tsc --noEmit && vite build\n\n" +
  "tests/e2e/navigation.spec.ts(231,25): error TS2339: Property 'style' does not exist on type 'Element'.\n" +
  "tests/e2e/navigation.spec.ts(232,24): error TS2339: Property 'style' does not exist on type 'Element'.\n" +
  "tests/e2e/navigation.spec.ts(244,21): error TS2552: Cannot find name 'originPos'. Did you mean 'origin'?\n" +
  "tests/e2e/navigation.spec.ts(245,21): error TS2552: Cannot find name 'originPos'. Did you mean 'origin'?\n";

test("a failed type check says how many errors, not the npm banner", () => {
  const d = describeBuildFailure(REAL_TSC);
  assert.strictEqual(d.headline, "build failed: 4 type errors");
  assert.strictEqual(d.errors.length, 4);
  assert.strictEqual(d.more, 0);
  const shown = d.headline + "\n" + d.errors.join("\n");
  assert.ok(!/failed: failed|vidi6@|tsc --noEmit|> /.test(shown), shown);   // no doubled prefix, no banner
});

test("each type error reads as file:line:column and what is wrong, with its code last", () => {
  const [first, , third] = describeBuildFailure(REAL_TSC).errors;
  assert.strictEqual(first, "tests/e2e/navigation.spec.ts:231:25  Property 'style' does not exist on type 'Element'. (TS2339)");
  assert.strictEqual(third, "tests/e2e/navigation.spec.ts:244:21  Cannot find name 'originPos'. Did you mean 'origin'? (TS2552)");
});

test("one error is '1 type error', and a long list is cut to a few with the rest counted", () => {
  const one = "failed: npm run build failed: \n> x\n> check\n\na.ts(1,2): error TS1: bad\n";
  assert.strictEqual(describeBuildFailure(one).headline, "build failed: 1 type error");
  const many = "failed: npm run build failed: \n" + Array.from({ length: 10 }, (_, i) => `a.ts(${i + 1},1): error TS1: bad`).join("\n");
  const d = describeBuildFailure(many);
  assert.strictEqual(d.headline, "build failed: 10 type errors");
  assert.strictEqual(d.errors.length, 6);
  assert.strictEqual(d.more, 4);
});

test("a failed install is an install, and npm's own prefix is dropped from its lines", () => {
  const d = describeBuildFailure("failed: npm ci --ignore-scripts --no-audit --no-fund failed: npm error code ERESOLVE\nnpm error Could not resolve dependency\n");
  assert.strictEqual(d.headline, "install failed");
  assert.deepStrictEqual(d.errors, ["code ERESOLVE", "Could not resolve dependency"]);
});

test("a build that failed without a type error shows what it said, minus the banner", () => {
  const d = describeBuildFailure("failed: npm run build failed: \n> app@1 build\n> vite build\n\nerror during build:\nCould not resolve ./missing from src/main.ts\n");
  assert.strictEqual(d.headline, "build failed");
  assert.deepStrictEqual(d.errors, ["error during build:", "Could not resolve ./missing from src/main.ts"]);
});

test("something that is not a build step is passed through, never lost", () => {
  const d = describeBuildFailure("failed: the checkout of abc123 found no such revision");
  assert.strictEqual(d.headline, "could not be prepared");
  assert.deepStrictEqual(d.errors, ["the checkout of abc123 found no such revision"]);
});

test("nothing to go on is still a sentence", () => {
  for (const none of [undefined, null, "", "failed:"]) assert.strictEqual(describeBuildFailure(none).headline, "could not be prepared");
});
