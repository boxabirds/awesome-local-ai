// The review player's time maths, shared by review.html and its tests (tests/player.test.cjs).

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
  if (e.metaKey || e.ctrlKey || e.altKey) return null;  // reload, zoom, tabs: the browser's
  const shift = e.shiftKey, code = e.code;
  // In the tests pane a scrub carries on into the next or previous test at either end (hold to fly through).
  const step = dir => ({ frac: dir * (shift ? FINE_SCRUB : SCRUB), ...(pane === "tests" ? { cross: true } : {}) });
  const scrub = dir => ({ do: "scrub", ...step(dir) });
  const digit = /^(Digit|Numpad)(\d)$/.exec(code);
  if (digit) return { do: "jump", frac: Number(digit[2]) / TENTHS };
  // Moving within and between panes.
  if (code === "Tab") return paneMove(pane, shift ? -1 : 1);
  if (code === "Escape") return pane === "stories" ? { do: "escape" } : paneMove(pane, -1);
  if (code === "ArrowUp" || code === "ArrowDown") {
    const dir = code === "ArrowDown" ? 1 : -1;
    return { do: pane === "stories" ? "story" : pane === "tests" ? "path" : "step", dir };
  }
  if (code === "ArrowRight" || code === "ArrowLeft") {
    if (pane === "stories") return code === "ArrowRight" ? { do: "pane", to: "tests" } : { do: "none" };
    return scrub(code === "ArrowRight" ? 1 : -1);
  }
  if (code === "Enter") {
    if (pane === "stories") return { do: "pane", to: "tests" };
    return shift ? { do: "verdict", v: "disagree", note: true } : { do: "verdict", v: "agree", next: true };
  }
  // The same in every pane.
  switch (code) {
    case "BracketRight": case "PageDown": return { do: "story", dir: 1 };
    case "BracketLeft": case "PageUp": return { do: "story", dir: -1 };
    case "Space": return { do: "play" };
    case "Period": return shift ? { do: "speed", dir: 1 } : { do: "frame", dir: 1 };
    case "Comma": return shift ? { do: "speed", dir: -1 } : { do: "frame", dir: -1 };
    // = agrees and - disagrees with the test, and each goes straight on to the next test.
    case "Equal": return pane === "stories" ? null : { do: "verdict", v: "agree", next: true };
    case "Minus": return pane === "stories" ? null : { do: "verdict", v: "disagree", next: true };
    case "Home": return { do: "jump", frac: 0 };
    case "End": return { do: "jump", frac: 1 };
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

if (typeof module !== "undefined") module.exports = { frameAt, timeline, defaultSpeed, nextCheck, nextSpot, nextFrame, keyAction, scrubStep, placeToHash, placeFromHash, PANES, SCRUB, FINE_SCRUB };
