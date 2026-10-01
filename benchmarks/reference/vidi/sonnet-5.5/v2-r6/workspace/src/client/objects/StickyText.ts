import type * as Y from 'yjs';
import {
  STICKY_COUNTER_THRESHOLD_CHARS, STICKY_FONT_MAX_PX, STICKY_FONT_MIN_PX, STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';

const HIGH_SURROGATE_MIN = 0xd800;
const HIGH_SURROGATE_MAX = 0xdbff;
const LOW_SURROGATE_MIN = 0xdc00;
const LOW_SURROGATE_MAX = 0xdfff;
const MID = 2;

const isHigh = (c: number) => c >= HIGH_SURROGATE_MIN && c <= HIGH_SURROGATE_MAX;
const isLow = (c: number) => c >= LOW_SURROGATE_MIN && c <= LOW_SURROGATE_MAX;

/** Keeps at most `max` UTF-16 units without splitting a surrogate pair. */
function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  let end = max;
  if (end > 0 && isHigh(s.charCodeAt(end - 1))) end -= 1;
  return s.slice(0, end);
}

export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return truncate(next, max);
}

export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

interface Diff { start: number; removed: number; inserted: string }

/** Common prefix/suffix diff; never cuts a surrogate pair in half. */
function diff(prev: string, next: string): Diff {
  const minLen = Math.min(prev.length, next.length);
  let p = 0;
  while (p < minLen && prev.charCodeAt(p) === next.charCodeAt(p)) p += 1;
  if (p > 0 && p < Math.max(prev.length, next.length) && isHigh(prev.charCodeAt(p - 1))) p -= 1;
  let s = 0;
  while (s < minLen - p && prev.charCodeAt(prev.length - 1 - s) === next.charCodeAt(next.length - 1 - s)) s += 1;
  if (s > 0 && isLow(prev.charCodeAt(prev.length - s))) s -= 1;
  return { start: p, removed: prev.length - p - s, inserted: next.slice(p, next.length - s) };
}

/**
 * Applies the edit prev → next but never lets the result exceed `max`: characters of the
 * inserted run beyond the limit are dropped (not characters elsewhere in the text).
 * `caret` is the position just after the kept insertion.
 */
export function clampEdit(prev: string, next: string, max: number = STICKY_TEXT_MAX_CHARS): { value: string; caret: number } {
  if (next.length <= max) return { value: next, caret: next.length };
  const d = diff(prev, next);
  const room = Math.max(0, max - (prev.length - d.removed));
  const kept = truncate(d.inserted, room);
  const value = prev.slice(0, d.start) + kept + prev.slice(d.start + d.removed);
  return { value, caret: d.start + kept.length };
}

/** Minimal insert/delete so concurrent edits by others survive. */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const prev = ytext.toString();
  if (prev === next) return;
  const d = diff(prev, next);
  const run = () => {
    if (d.removed > 0) ytext.delete(d.start, d.removed);
    if (d.inserted.length > 0) ytext.insert(d.start, d.inserted);
  };
  if (ytext.doc) ytext.doc.transact(run, origin);
  else run();
}

/** Maps a caret index through a Y.Text delta (inserts at or before the caret push it right). */
export function mapIndexThroughDelta(
  index: number, delta: readonly { insert?: unknown; delete?: number; retain?: number }[],
): number {
  let pos = 0;
  let out = index;
  for (const op of delta) {
    if (op.retain !== undefined) {
      pos += op.retain;
    } else if (op.insert !== undefined) {
      const len = typeof op.insert === 'string' ? op.insert.length : 1;
      if (pos <= index) out += len;
    } else if (op.delete !== undefined) {
      if (pos < index) out -= Math.min(op.delete, index - pos);
    }
  }
  return Math.max(0, out);
}

export interface FitResult { fontPx: number; overflow: boolean }

/**
 * Largest integer font size in [MIN, MAX] at which each element fits `box` px; leaves it applied.
 * Works on all elements together (write every size, then read every height) so a board with
 * thousands of notes costs a handful of layouts instead of several per note.
 */
export function fitFontSizes(els: HTMLElement[], box: number): FitResult[] {
  const results: FitResult[] = els.map(() => ({ fontPx: STICKY_FONT_MIN_PX, overflow: false }));
  const lo = els.map(() => STICKY_FONT_MIN_PX);
  const hi = els.map(() => STICKY_FONT_MAX_PX);
  const tryAll = (idx: number[], size: (i: number) => number): boolean[] => {
    for (const i of idx) els[i].style.fontSize = `${size(i)}px`;
    return idx.map((i) => els[i].scrollHeight <= box);
  };
  const all = els.map((_, i) => i);
  const fitsMax = tryAll(all, () => STICKY_FONT_MAX_PX);
  const rest: number[] = [];
  all.forEach((i, k) => {
    if (fitsMax[k]) results[i] = { fontPx: STICKY_FONT_MAX_PX, overflow: false };
    else rest.push(i);
  });
  const fitsMin = tryAll(rest, () => STICKY_FONT_MIN_PX);
  let active: number[] = [];
  rest.forEach((i, k) => {
    if (fitsMin[k]) active.push(i);
    else results[i] = { fontPx: STICKY_FONT_MIN_PX, overflow: true };
  });
  // invariant per element: lo fits, hi does not
  while (active.length > 0) {
    const mid = (i: number) => Math.floor((lo[i] + hi[i]) / MID);
    const fits = tryAll(active, mid);
    const next: number[] = [];
    active.forEach((i, k) => {
      if (fits[k]) lo[i] = mid(i); else hi[i] = mid(i);
      if (hi[i] - lo[i] > 1) next.push(i);
      else results[i] = { fontPx: lo[i], overflow: false };
    });
    active = next;
  }
  els.forEach((el, i) => { el.style.fontSize = `${results[i].fontPx}px`; });
  return results;
}

export function fitFontSize(el: HTMLElement, box: number): FitResult {
  return fitFontSizes([el], box)[0];
}

interface FitRequest { el: HTMLElement; box: number; done(r: FitResult): void; cancelled: boolean }
let pending: FitRequest[] = [];

/** Queues a fit; all fits requested in the same commit are measured together before paint. */
export function requestFit(el: HTMLElement, box: number, done: (r: FitResult) => void): () => void {
  const req: FitRequest = { el, box, done, cancelled: false };
  if (pending.length === 0) {
    queueMicrotask(() => {
      const batch = pending.filter((r) => !r.cancelled && r.el.isConnected);
      pending = [];
      const byBox = new Map<number, FitRequest[]>();
      for (const r of batch) byBox.set(r.box, [...(byBox.get(r.box) ?? []), r]);
      for (const [b, reqs] of byBox) {
        const out = fitFontSizes(reqs.map((r) => r.el), b);
        reqs.forEach((r, i) => r.done(out[i]));
      }
    });
  }
  pending.push(req);
  return () => { req.cancelled = true; };
}
