import {
  STICKY_COUNTER_THRESHOLD_CHARS, STICKY_FONT_MAX_PX, STICKY_FONT_MIN_PX, STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';
import {
  applyTextDiff, clampEdit as clampEditTo, clampToLimit as clampToLimitTo, mapIndexThroughDelta,
} from '../../shared/text-edit';

export { applyTextDiff, mapIndexThroughDelta };

export const clampToLimit = (next: string, max: number = STICKY_TEXT_MAX_CHARS): string => clampToLimitTo(next, max);
export const clampEdit = (prev: string, next: string, max: number = STICKY_TEXT_MAX_CHARS) => clampEditTo(prev, next, max);

const MID = 2;

export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
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
