import * as Y from 'yjs';
import {
  STICKY_SIZE_WORLD,
  STICKY_TEXT_MAX_CHARS,
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
} from '@/shared/config';

/**
 * Pure sticky-note text logic (story 2): length clamping, minimal Y.Text
 * diffing, counter visibility and font fitting.
 */

/** Inner padding of a sticky note in world px (shared by display and edit modes). */
export const NOTE_PADDING = 12;

/** Size of the box available for note text, in world px. */
export const NOTE_TEXT_BOX = STICKY_SIZE_WORLD - 2 * NOTE_PADDING;

/** Keeps at most `max` characters (default STICKY_TEXT_MAX_CHARS). */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return next.length > max ? next.slice(0, max) : next;
}

/**
 * Applies the minimal change (common prefix + common suffix) that turns the
 * Y.Text's current value into `next`: at most one delete and at most one
 * insert, inside a single transaction. A full replace would destroy
 * concurrent typing by other clients once story 3 ships, so the minimal
 * diff is required. Surrogate pairs are never split: the delete/insert
 * boundaries always fall on the common prefix/suffix, which align with
 * identical code units in both strings.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const current = ytext.toString();
  if (current === next) return;
  const minLen = Math.min(current.length, next.length);
  let prefix = 0;
  while (prefix < minLen && current[prefix] === next[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < minLen - prefix && current[current.length - 1 - suffix] === next[next.length - 1 - suffix]) {
    suffix += 1;
  }
  const deleteLength = current.length - prefix - suffix;
  const insertText = next.slice(prefix, next.length - suffix);
  const apply = () => {
    if (deleteLength > 0) ytext.delete(prefix, deleteLength);
    if (insertText.length > 0) ytext.insert(prefix, insertText);
  };
  const doc = ytext.doc;
  if (doc) {
    doc.transact(apply, origin);
  } else {
    // Standalone (unattached) Y.Text: no document to transact on.
    apply();
  }
}

/** The counter shows when the remaining capacity is <= STICKY_COUNTER_THRESHOLD_CHARS. */
export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Finds the largest integer font size in [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX]
 * at which `el`'s rendered text fits within `box` CSS pixels of height, by
 * binary search on `scrollHeight <= box`. Leaves the element at the chosen
 * size. `overflow` is true when even the minimum size does not fit — the
 * caller then clips and shows a bottom fade.
 *
 * Must be called with a laid-out element (real browser); runs on text change
 * and mount only (zoom scales world units uniformly, so no re-fit on zoom).
 */
export function fitFontSize(el: HTMLElement, box: number): { fontPx: number; overflow: boolean } {
  let lo = STICKY_FONT_MIN_PX;
  let hi = STICKY_FONT_MAX_PX;
  let best = STICKY_FONT_MIN_PX;
  let fitsAtBest = false;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    el.style.fontSize = `${mid}px`;
    if (el.scrollHeight <= box) {
      best = mid;
      fitsAtBest = true;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  el.style.fontSize = `${best}px`;
  return { fontPx: best, overflow: !fitsAtBest };
}
