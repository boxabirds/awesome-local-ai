// The review player's time maths, keys and verdict display, shared by review.html and its tests (tests/player.test.cjs).

// The frame on screen at time t: the last one at or before t (frames: [[time, name]], in time order),
// or null before the page's first frame.
function frameAt(frames, t) {
  let lo = 0, hi = frames.length - 1, best = -1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (frames[m][0] <= t) { best = m; lo = m + 1; } else hi = m - 1;
  }
  return best < 0 ? null : frames[best][1];
}

// Seek-bar position (0..1) of a time and back, with each long wait ([a, b]) drawn waitShown wide.
function timeline(start, end, waits, waitShown) {
  const span = Math.max(waits.reduce((d, [a, b]) => d - ((b - a) - waitShown), end - start), Number.EPSILON);
  const pos = t => {
    let d = t - start;
    for (const [a, b] of waits) {
      if (t >= b) d -= (b - a) - waitShown;
      else if (t > a) d -= (t - a) * (1 - waitShown / (b - a));
    }
    return Math.max(0, Math.min(1, d / span));
  };
  const timeAt = frac => {
    let target = Math.max(0, Math.min(1, frac)) * span, t = start;
    for (const [a, b] of waits) {
      if (target <= a - t) return t + target;
      target -= a - t;
      if (target <= waitShown) return a + target * (b - a) / waitShown;
      target -= waitShown;
      t = b;
    }
    return Math.min(t + target, end);
  };
  return { pos, timeAt };
}

// The fastest listed speed, at most real time, at which a path of this length still takes minPlay
// to play: a fast test slows down enough to watch, a long one plays in real time.
const REAL_TIME = 1;
function defaultSpeed(duration, speeds, minPlay) {
  const fit = speeds.filter(s => s <= REAL_TIME && duration / s >= minPlay);
  return fit.length ? Math.max(...fit, Math.min(...speeds)) : Math.min(...speeds);
}

// The next check's time after t (dir 1) or the previous one before it (dir -1); null when the path
// has none left that way, so the caller moves on to the next or previous path.
function nextCheck(checks, t, dir, eps) {
  const x = dir > 0 ? checks.find(c => c > t + eps) : [...checks].reverse().find(c => c < t - eps);
  return x === undefined ? null : x;
}

// Where to go from path i of n in the story: {path} within it, or {story: ±1} off either end.
function nextSpot(n, i, dir) {
  const j = i + dir;
  return j >= 0 && j < n ? {path: j} : {story: dir};
}

// The time of the next (dir 1) or previous (dir -1) frame on anyone's screen, or null at either end.
function nextFrame(people, t, dir) {
  const times = people.flatMap(frames => frames.map(f => f[0]));
  const x = dir > 0 ? Math.min(...times.filter(f => f > t)) : Math.max(...times.filter(f => f < t));
  return Number.isFinite(x) ? x : null;
}

// ---------- the keyboard layer ----------

// A scrub moves a share of the seek bar, not a fixed time: held-out tests record from a tenth of a second
// to a minute, and a fixed second would cross a short one end to end in one press.
const SCRUB = 0.05;           // - = and left/right in the tests and steps panes: 5% per press (hold to keep going)
const FINE_SCRUB = 0.01;      // with shift: 1%
const TENTHS = 10;            // digits jump to tenths of the recording

// The place in the review, kept in the address so a reload (the gallery rebuilt) comes back to it.
function placeToHash({ story, key, idx, pane }) {
  const parts = [["story", story], ["key", key], ["idx", idx], ["pane", pane]].filter(([, v]) => v !== null && v !== undefined);
  return "#" + parts.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
}
function placeFromHash(hash) {
  const q = new URLSearchParams((hash || "").replace(/^#/, ""));
  const num = k => (q.has(k) && /^\d+$/.test(q.get(k)) ? Number(q.get(k)) : null);
  return { story: num("story"), key: num("key"), idx: num("idx"), pane: PANES.includes(q.get("pane")) ? q.get("pane") : null };
}

// Where a scrub of frac from seek-bar position pos lands: {pos} on the bar, or, with cross, {path: ±1} for the
// next or previous test when the press starts at that end. A press that reaches an end stops there first.
const END_EPS = 1e-6;
function scrubStep(pos, frac, cross) {
  if (cross && frac > 0 && pos >= 1 - END_EPS) return { path: 1 };
  if (cross && frac < 0 && pos <= END_EPS) return { path: -1 };
  return { pos: Math.max(0, Math.min(1, pos + frac)) };
}

// The review has three panes, left to right: the stories, a story's held-out tests, and the browser steps
// of the test being played. Each pane's up/down moves within it; Tab and shift-Tab (or Esc) move between
// panes; left/right go into the tests from the stories and scrub the recording in the other two.
const PANES = ["stories", "tests", "steps"];

function paneMove(pane, dir) {
  const i = PANES.indexOf(pane) + dir;
  return i >= 0 && i < PANES.length ? { do: "pane", to: PANES[i] } : { do: "none" };
}

// What a key press does in the review, given the pane with focus, or null to leave it to the browser. By key
// position (code) for digits and - = , . so shift and keyboard layouts don't change them.
function keyAction(e, pane) {
  // cmd/ctrl with = or Return, - or Esc: agree, disagree or back to review for every held-out test of the
  // story (bulkTargets); the results show once agreed or disagreed. Everything else with cmd, ctrl or alt
  // (reload, reset zoom, tabs) is the browser's.
  if ((e.metaKey || e.ctrlKey) && !e.altKey) {
    const all = { Equal: "agree", Enter: "agree", Minus: "disagree", Escape: "" }[e.code];
    return all === undefined ? null : { do: "all", v: all };
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  const shift = e.shiftKey, code = e.code;
  // In the tests pane a scrub carries on into the next or previous test at either end (hold to fly through).
  const step = dir => ({ frac: dir * (shift ? FINE_SCRUB : SCRUB), ...(pane === "tests" ? { cross: true } : {}) });
  const scrub = dir => ({ do: "scrub", ...step(dir) });
  // Return is = in the tests (passes, and on), the right arrow in the stories and the down arrow in the steps.
  if (code === "Space") return { do: "play" };  // play / stop, whichever pane has focus
  if (code === "Enter" && !shift) {
    const as = { stories: "ArrowRight", tests: "Equal", steps: "ArrowDown" }[pane];
    return keyAction({ ...e, code: as, key: as }, pane);
  }
  const digit = /^(Digit|Numpad)(\d)$/.exec(code);
  if (digit) return { do: "jump", frac: Number(digit[2]) / TENTHS };
  // Moving within and between panes.
  if (code === "Tab") return paneMove(pane, shift ? -1 : 1);
  // Esc on a held-out test clears its verdict back to "to review"; elsewhere it steps back out.
  if (code === "Escape") return pane === "stories" ? { do: "escape" } : pane === "tests" ? { do: "verdict", v: "" } : paneMove(pane, -1);
  if (code === "ArrowUp" || code === "ArrowDown") {
    const dir = code === "ArrowDown" ? 1 : -1;
    return { do: pane === "stories" ? "story" : pane === "tests" ? "path" : "step", dir };
  }
  if (code === "ArrowRight" || code === "ArrowLeft") {
    if (pane === "stories") return code === "ArrowRight" ? { do: "pane", to: "tests" } : { do: "none" };
    return scrub(code === "ArrowRight" ? 1 : -1);
  }
  if (code === "Enter") return pane === "tests" ? { do: "verdict", v: "fail", note: true } : null;  // shift-Return
  // The same in every pane.
  switch (code) {
    case "BracketRight": case "PageDown": return { do: "story", dir: 1 };
    case "BracketLeft": case "PageUp": return { do: "story", dir: -1 };
    case "KeyP": return { do: "play" };
    case "Period": return shift ? { do: "speed", dir: 1 } : { do: "frame", dir: 1 };
    case "Comma": return shift ? { do: "speed", dir: -1 } : { do: "frame", dir: -1 };
    // = says the test passes and - that it fails, as the judge sees it, and each goes straight on to the next
    // test. The server saves it as agree / disagree with the automated result the page hasn't been shown.
    case "Equal": return pane === "stories" ? null : { do: "verdict", v: "pass", next: true };
    case "Minus": return pane === "stories" ? null : { do: "verdict", v: "fail", next: true };
    case "Home": return { do: "jump", frac: 0 };
    case "End": return { do: "jump", frac: 1 };
    // agree / disagree with the (hidden) automated result, as before: a verdict, so the result then shows
    case "KeyA": return { do: "verdict", v: "agree", next: true };
    case "KeyD": return { do: "verdict", v: "disagree", next: true };
    case "KeyS": return { do: "verdict", v: "skip", next: true };
    case "KeyN": return { do: "note" };
    case "KeyO": return { do: "open" };
    case "KeyW": return { do: "waits" };
    case "Slash": return shift ? { do: "help" } : null;
    default: return null;
  }
}

// ---------- the automated result, hidden until the judge has given their own verdict ----------

// The judge's own verdicts. A skip defers the test and an empty verdict is a note alone: neither shows the result.
const ANSWERED = ["agree", "disagree", "pass", "fail"];
const AUTOMATED_PASS = "passed";   // failed, timedOut, interrupted and skipped are not passes
function answered(verdict) { return ANSWERED.includes(verdict); }

// What the judge said of the test themselves: "pass" / "fail", from the stored agree / disagree and the
// automated result (an earlier verdict may be stored as pass / fail already); null when unanswered or unknown.
function ownOf(verdict, automated) {
  if (verdict === "pass" || verdict === "fail") return verdict;
  if ((verdict !== "agree" && verdict !== "disagree") || !automated) return null;
  return (automated === AUTOMATED_PASS) === (verdict === "agree") ? "pass" : "fail";
}

// How a held-out test shows in its row and the player's header. Nothing of the automated result, not
// its text, its colour nor a tooltip, until the judge has answered, even if a payload carried it.
function pathView(path, verdict) {
  const shown = answered(verdict) && path?.answered === true && path.status ? path.status : null;
  const own = shown ? ownOf(verdict, shown) : null;
  if (!shown) return {
    automated: null, own: null, pill: "?", pillClass: "hidden",
    mark: verdict === "skip" ? "skip" : "to review", markClass: verdict === "skip" ? "skip" : "todo",
    header: "Automated result: hidden until you judge", headerClass: "hidden",
  };
  // An earlier verdict stored as pass / fail still reads as agree or disagree with the result.
  const rel = verdict === "agree" || verdict === "disagree" ? verdict : own === ownOf("agree", shown) ? "agree" : "disagree";
  return {
    automated: shown, own, pill: shown, pillClass: shown,
    mark: `you: ${own} · ${rel}`, markClass: rel,
    header: `Automated: ${shown.toUpperCase()} · you: ${own.toUpperCase()}`, headerClass: shown,
  };
}

// A browser step's mark in the steps list and its tick on the seek bar: before an answer every check
// looks the same, so neither a cross nor a missing tick gives the result away.
function stepMark(step, isAnswered) {
  if (!isAnswered) return step.kind === "check" ? { sym: "•", cls: "hid", tick: "chk" } : { sym: "", cls: "", tick: "act" };
  if (step.error) return { sym: "✗", cls: "bad", tick: "bad" };
  return step.kind === "check" ? { sym: "✓", cls: "ok", tick: "ok" } : { sym: "", cls: "", tick: "act" };
}

// The tests (by position in verdicts) a whole-story key changes: every test of the story whose verdict isn't
// already v, overwriting earlier verdicts (only changes are saved). A bulk agree or disagree is a verdict, so
// each test's result shows after it; "" (Esc) takes every test back to review and hides them again.
function bulkTargets(verdicts, v) {
  return verdicts.flatMap((x, i) => (x || "") !== v ? [i] : []);
}

// The keys sheet (? on the page): what each key does.
const KEYS = [
  ["Three panes", "stories · held-out tests · browser steps (the focused one has a ring)"],
  ["Hidden", "a test's automated result is hidden until you give your own verdict; then it shows beside yours, as agree or disagree"],
  ["Tab · ⇧Tab", "next pane · previous pane"],
  ["Stories: ↑ ↓", "previous / next story"],
  ["Space p", "play / stop, in any pane (a test plays by itself when you move to it, at 2×)"],
  ["Stories: → Return", "into the story's held-out tests"],
  ["Tests: ↑ ↓", "previous / next held-out test"],
  ["Tests: → · ←", "scrub 5% (⇧: 1%); at an end, on to the next / previous test: hold to fly through"],
  ["Tests: = Return · -", "passes · fails, as you see it, and on to the next test"],
  ["Tests: ⇧Return", "fails, and write why"],
  ["Tests: Esc", "clear the verdict back to “to review” (the result hides again)"],
  ["Steps: ↑ ↓ Return", "previous / next browser step"],
  ["Steps: → · ←", "scrub 5% (⇧: 1%)"],
  ["Steps: Esc", "back to the held-out tests"],
  [". ,", "next / previous frame"],
  ["1 … 9 · 0", "jump to 10% … 90% · the start"],
  ["Home End", "start / end"],
  ["> <", "faster / slower"],
  ["] [ · PgDn PgUp", "next / previous story, from any pane"],
  ["a d s", "agree / disagree with the automated result, without seeing it / skip, and on to the next test"],
  ["⌘= ⌘Return · ⌘- · ⌘Esc", "the whole story: agree with every test · disagree with every test (with each automated result, whatever it is: results then show) · every test back to “to review”, results hidden again; each overwrites earlier verdicts, notes stay (Ctrl on Windows and Linux)"],
  ["n", "write a note (Esc or Return to leave it)"],
  ["o", "open this build"],
  ["w", "skip long waits on / off"],
  ["?", "show / hide these keys (Esc closes)"],
];

if (typeof module !== "undefined") module.exports = { frameAt, timeline, defaultSpeed, nextCheck, nextSpot, nextFrame, keyAction, scrubStep, placeToHash, placeFromHash, PANES, SCRUB, FINE_SCRUB,
  answered, ownOf, pathView, stepMark, bulkTargets, KEYS };
