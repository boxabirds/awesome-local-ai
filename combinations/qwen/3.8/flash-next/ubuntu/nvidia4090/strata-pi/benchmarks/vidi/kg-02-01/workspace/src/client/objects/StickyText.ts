import * as Y from "yjs";
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from "../../shared/config";

/**
 * Pure text logic for sticky notes (story 2), kept free of React so it can be
 * unit-tested without a DOM. `StickyTextEditor` is a thin wrapper around these
 * functions.
 */

export interface FitResult {
  /** Chosen font size, in board units (so it scales with board zoom). */
  fontPx: number;
  /** True when the text does not fit even at the smallest size. */
  overflow: boolean;
}

/**
 * Keep at most `max` characters (default `STICKY_TEXT_MAX_CHARS`): typing or
 * pasting never adds characters beyond the limit. A cut that would fall
 * between the two halves of a surrogate pair steps back one unit instead, so
 * clamping can never corrupt an emoji.
 */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  if (typeof next !== "string") return "";
  const limit = Number.isFinite(max) && max > 0 ? Math.floor(max) : STICKY_TEXT_MAX_CHARS;
  if (next.length <= limit) return next;

  let cut = limit;
  if (cut > 0 && isHighSurrogate(next.charCodeAt(cut - 1))) cut -= 1;
  return next.slice(0, cut);
}

/**
 * Write `next` into `ytext` with the *minimal* change: the common prefix and
 * the common suffix are left alone, so only one delete and one insert (each
 * zero length when not needed) are applied, in a single transaction.
 *
 * Minimal diffs matter: story 3 syncs the same document between people, and a
 * delete-all + insert-all rewrite would destroy what someone else typed at the
 * same time.
 *
 * The diff is computed over code points, so a surrogate pair is always
 * inserted or removed whole. Yjs indexes text by UTF-16 units, hence the
 * conversion back to UTF-16 offsets.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const current = ytext.toString();
  if (current === next) return;

  const from = Array.from(current);
  const to = Array.from(next);

  const maxPrefix = Math.min(from.length, to.length);
  let prefix = 0;
  while (prefix < maxPrefix && from[prefix] === to[prefix]) prefix += 1;

  const maxSuffix = maxPrefix - prefix;
  let suffix = 0;
  while (
    suffix < maxSuffix &&
    from[from.length - 1 - suffix] === to[to.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const start = utf16Length(from, 0, prefix);
  const end = current.length - utf16Length(from, from.length - suffix, from.length);
  const inserted = to.slice(prefix, to.length - suffix).join("");

  ytext.doc?.transact(() => {
    if (end > start) ytext.delete(start, end - start);
    if (inserted.length > 0) ytext.insert(start, inserted);
  }, origin);
}

/**
 * The character counter appears only near the limit: when
 * `STICKY_COUNTER_THRESHOLD_CHARS` characters or fewer remain.
 */
export function counterVisible(length: number): boolean {
  if (!Number.isFinite(length)) return false;
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Largest integer font size in `[STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX]` at
 * which the element's measured `scrollHeight` still fits inside `box`
 * (board units). Writes the chosen size into `el.style.fontSize` while
 * searching, and leaves it there.
 *
 * When even the smallest size overflows, the result is
 * `{ fontPx: STICKY_FONT_MIN_PX, overflow: true }`: the caller clips the text
 * inside the note and shows the bottom fade.
 *
 * Only called on mount and on text change: zoom scales the whole note
 * uniformly, so the fitted size does not depend on it.
 */
export function fitFontSize(el: HTMLElement, box: number): FitResult {
  const min = STICKY_FONT_MIN_PX;
  const max = STICKY_FONT_MAX_PX;

  if (!Number.isFinite(box) || box <= 0) {
    el.style.fontSize = `${min}px`;
    return { fontPx: min, overflow: true };
  }

  let low = min;
  let high = max;
  let best = min;
  let fits = false;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    el.style.fontSize = `${middle}px`;
    if (measure(el) <= box) {
      best = middle;
      fits = true;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  const fontPx = fits ? best : min;
  el.style.fontSize = `${fontPx}px`;
  return { fontPx, overflow: !fits };
}

// ---- internals ------------------------------------------------------------

function measure(el: HTMLElement): number {
  const height = (el as HTMLElement & { scrollHeight?: number }).scrollHeight;
  return typeof height === "number" && Number.isFinite(height) ? height : Number.POSITIVE_INFINITY;
}

/** UTF-16 length of `chars[from .. to)` (code points -> Yjs text offsets). */
function utf16Length(chars: string[], from: number, to: number): number {
  let total = 0;
  for (let i = from; i < to; i += 1) total += chars[i]!.length;
  return total;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}
