import * as Y from 'yjs';
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';

/**
 * Pure sticky-note text logic: length clamping, the minimal Y.Text diff and
 * the font-fit measurement. All of it is framework-free so it can be unit
 * tested against a real Y.Text.
 *
 * Y.Text indices in Yjs 13 are UTF-16 code units, so the diff works in
 * code units; a change that touches a surrogate pair always deletes/inserts
 * whole pairs (the diff never starts or ends mid-pair in practice because
 * the textarea edits whole code units too).
 */

/** Keep at most `max` characters (default STICKY_TEXT_MAX_CHARS); the tail is dropped. */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return next.length > max ? next.slice(0, max) : next;
}

/** The counter shows once the note is within STICKY_COUNTER_THRESHOLD_CHARS of the limit. */
export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/**
 * Apply the minimal change that turns `ytext` into `next`: common prefix and
 * suffix are kept, leaving at most one delete and one insert in a single
 * transaction. A full replace would destroy concurrent typing once story 3
 * ships, so the minimal diff is required.
 *
 * The diff boundaries are nudged back over a leading high surrogate when the
 * common prefix/suffix would end mid surrogate pair: Yjs corrupts the text
 * if a delete or insert lands between the two halves of a pair, so the
 * changed span always covers whole pairs.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const current = ytext.toString();
  if (current === next) return;

  const minLen = Math.min(current.length, next.length);
  let prefix = 0;
  while (prefix < minLen && current.charCodeAt(prefix) === next.charCodeAt(prefix)) prefix += 1;
  // Never end the prefix between the two halves of a pair in `current`.
  if (prefix > 0 && isHighSurrogate(current.charCodeAt(prefix - 1))) prefix -= 1;

  let suffix = 0;
  while (
    suffix < minLen - prefix &&
    current.charCodeAt(current.length - 1 - suffix) === next.charCodeAt(next.length - 1 - suffix)
  ) {
    suffix += 1;
  }
  // Never start the suffix between the two halves of a pair in `current`.
  const endBefore = current.length - suffix;
  if (endBefore > 0 && isHighSurrogate(current.charCodeAt(endBefore - 1))) suffix += 1;

  const deleteLength = current.length - prefix - suffix;
  const runInTransaction = (fn: () => void): void => {
    // A doc-bound Y.Text gets one transaction (one update, one undo step).
    // An unbound Y.Text has no doc; each op is then its own transaction.
    if (ytext.doc) {
      ytext.doc.transact(fn, origin);
    } else {
      fn();
    }
  };

  if (deleteLength < 0) {
    // Degenerate (invalid) input: fall back to a full replace.
    runInTransaction(() => {
      ytext.delete(0, current.length);
      ytext.insert(0, next);
    });
    return;
  }
  const insertText = next.slice(prefix, next.length - suffix);

  runInTransaction(() => {
    if (deleteLength > 0) ytext.delete(prefix, deleteLength);
    if (insertText.length > 0) ytext.insert(prefix, insertText);
  });
}

/**
 * One Quill-style text delta operation, as produced by Yjs
 * `YTextEvent.delta` (and the `applyDelta` format). `insert` is a string for
 * plain text (an object embed is possible in Yjs but the sticky editor never
 * uses one). At most one of `retain`/`insert`/`delete` is set per op.
 */
export interface TextDeltaOp {
  retain?: number;
  insert?: string | object;
  delete?: number;
}

/**
 * Apply a Yjs text delta to a plain string, preserving the editor's
 * selection (caret or range).
 *
 * This is the remote-to-local half of text sync: it lets the textarea absorb
 * another editor's change without clobbering the local caret, so that the
 * next local diff is computed against the true merged text rather than a
 * stale local view. Without this, two people typing into one note clobber
 * each other's characters (live.concurrent_text).
 *
 * `text` is the string before the delta (the textarea's current value) and
 * `delta` transforms it into the new text. `selStart`/`selEnd` are the
 * selection in `text` (UTF-16 code units); the returned `start`/`end` are the
 * corresponding selection in the resulting text. The caret adjustment rules:
 * - retain shifts nothing;
 * - an insert at position p pushes a selection at/after p right by its length;
 * - a delete of [p, p+n) clamps a selection strictly inside to p, shifts a
 *   selection at/after the block left by n, and leaves one before p alone.
 */
export function applyTextDelta(
  text: string,
  delta: readonly TextDeltaOp[],
  selStart: number,
  selEnd: number,
): { text: string; start: number; end: number } {
  // Build the resulting text: retain copies, delete skips, insert appends.
  let out = '';
  let consumed = 0;
  for (const op of delta) {
    if (typeof op.retain === 'number') {
      out += text.slice(consumed, consumed + op.retain);
      consumed += op.retain;
    } else if (typeof op.delete === 'number') {
      consumed += op.delete;
    } else if (typeof op.insert === 'string') {
      out += op.insert;
    }
    // A non-string insert (embed) is ignored: the sticky editor is plain text.
  }
  out += text.slice(consumed);

  // Map one position from `text` coordinates to `out` coordinates. Intervals
  // are right-open, so a position sitting exactly at the end of a retain/delete
  // is resolved by the *next* op: a trailing insert at that same point then
  // pushes the caret past it (a replaced selection ends up selecting the
  // replacement), which is the caret behaviour editors expect.
  const mapPos = (p: number): number => {
    let idx = 0; // offset consumed in `text`
    let nidx = 0; // offset built in `out`
    for (const op of delta) {
      if (typeof op.retain === 'number') {
        const n = op.retain;
        if (idx + n > p) return nidx + (p - idx);
        idx += n;
        nidx += n;
      } else if (typeof op.delete === 'number') {
        const n = op.delete;
        if (idx + n > p) return nidx;
        idx += n;
      } else if (typeof op.insert === 'string') {
        if (idx <= p) nidx += op.insert.length;
      }
    }
    // Characters beyond the last explicit op are implicitly retained (see the
    // `out += text.slice(consumed)` above). Reaching the end of the loop means
    // the caret sits at/after the explicitly-changed region (idx <= p), so its
    // trailing offset (p - idx) must be added, or a caret at the end of a long
    // note would collapse to the change point after a remote edit elsewhere.
    return nidx + (p - idx);
  };

  return { text: out, start: mapPos(selStart), end: mapPos(selEnd) };
}

export interface FontFit {
  /** Chosen font size in world px, within [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX]. */
  fontPx: number;
  /** True when the text does not fit even at the smallest size (show the fade). */
  overflow: boolean;
}

/**
 * Find the largest integer font size (world px) in [STICKY_FONT_MIN_PX,
 * STICKY_FONT_MAX_PX] at which `el`'s text fits inside `box` px of height,
 * by binary search over `scrollHeight <= box`. `el` must contain the note's
 * text and have the note's content width and wrapping; it is left at the
 * chosen size. Runs on text change and mount only (zoom scales world units
 * uniformly, so the fit never depends on zoom).
 */
export function fitFontSize(el: HTMLElement, box: number): FontFit {
  let low = STICKY_FONT_MIN_PX;
  let high = STICKY_FONT_MAX_PX;
  let best = STICKY_FONT_MIN_PX;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    el.style.fontSize = `${mid}px`;
    if (el.scrollHeight <= box) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  el.style.fontSize = `${best}px`;
  const overflow = el.scrollHeight > box;
  return { fontPx: best, overflow };
}

/**
 * Non-blocking font-fit scheduler (story 4, persist.large_board).
 *
 * `fitFontSize` forces a synchronous layout read (`scrollHeight`) on every
 * binary-search step. With many notes on the board each read re-lays-out the
 * whole world layer, so fitting every note on the render path is O(n²) and
 * blows the 3 s load budget (2000 notes: ~6 s of blocked layout). Fits are
 * therefore queued and drained a little per animation frame, off the initial
 * render: the note elements paint immediately (at the default font) and each
 * settles to its fitted size on a following frame. For a small board this is
 * one frame — imperceptible; the fit result itself is unchanged.
 */
interface FitJob {
  measure: HTMLElement;
  box: number;
  apply: (fit: FontFit) => void;
}

let fitQueue: FitJob[] = [];
let fitScheduled = false;
/** Layout work allowed per frame while draining fits (ms). */
const FIT_FRAME_BUDGET_MS = 16;

/** Queue a note's font fit to run on a later frame (see above). */
export function scheduleFontFit(
  measure: HTMLElement,
  box: number,
  apply: (fit: FontFit) => void,
): void {
  fitQueue.push({ measure, box, apply });
  if (fitScheduled) return;
  fitScheduled = true;
  requestAnimationFrame(drainFitQueue);
}

function drainFitQueue(): void {
  fitScheduled = false;
  const deadline = performance.now() + FIT_FRAME_BUDGET_MS;
  while (fitQueue.length > 0 && performance.now() < deadline) {
    const job = fitQueue.shift()!;
    job.apply(fitFontSize(job.measure, job.box));
  }
  if (fitQueue.length > 0) {
    fitScheduled = true;
    requestAnimationFrame(drainFitQueue);
  }
}
