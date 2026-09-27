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

if (typeof module !== "undefined") module.exports = { frameAt, timeline, defaultSpeed };
