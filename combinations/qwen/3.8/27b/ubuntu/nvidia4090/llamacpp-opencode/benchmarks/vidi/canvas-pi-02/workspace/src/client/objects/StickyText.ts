import * as Y from 'yjs';
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';

// Re-export shared text-edit utilities so existing imports keep working.
export { applyTextDiff, applyTextDelta, type TextDeltaOp } from '../../shared/text-edit';
import { clampToLimit as _clampToLimit } from '../../shared/text-edit';

/** Keep at most STICKY_TEXT_MAX_CHARS characters (the sticky default). */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return _clampToLimit(next, max);
}

/** The counter shows once the note is within STICKY_COUNTER_THRESHOLD_CHARS of the limit. */
export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
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
