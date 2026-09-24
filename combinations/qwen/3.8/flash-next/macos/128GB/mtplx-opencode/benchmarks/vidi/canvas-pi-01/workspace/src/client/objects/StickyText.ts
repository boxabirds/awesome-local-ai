/**
 * Story 2 · task 4 — sticky note text logic (design "Sticky note text
 * editing and fit").
 *
 * The pure, framework-free parts of note text: the 1,000-character limit, the
 * minimal Y.Text diff and the auto-fit font search. The diff is deliberately
 * minimal (common prefix + common suffix) rather than a full replace, so that
 * once story 3 syncs the document a local edit cannot clobber text a teammate
 * typed elsewhere in the same note. Surrogate pairs are never split, which
 * keeps emoji and other astral characters intact under the diff and the limit.
 */
import * as Y from 'yjs';
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';

/** Cut a value at the character limit, never in the middle of a surrogate pair. */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  if (next.length <= max) return next;
  let cut = max;
  // Do not leave a lone high surrogate at the end (would split a pair).
  const before = next.charCodeAt(cut - 1);
  if (before >= 0xd800 && before <= 0xdbff) cut -= 1;
  return next.slice(0, cut);
}

/** True when the counter should show: the remaining budget is within the threshold. */
export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/** Back an index off a split surrogate pair (index sitting between the two units). */
function snapBack(text: string, index: number): number {
  if (index > 0 && index < text.length && isHighSurrogate(text.charCodeAt(index - 1))) {
    return index - 1;
  }
  return index;
}

/**
 * Apply `next` to a `Y.Text` with the smallest change: one delete and/or one
 * insert covering only the differing middle. A no-op (`current === next`)
 * opens no transaction. Safe under concurrent edits, unlike a full replace.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const current = ytext.toString();
  if (current === next) return;
  const doc = ytext.doc;
  if (!doc) {
    // Detached text (only happens in isolated unit tests): still make it correct.
    ytext.delete(0, current.length);
    if (next.length > 0) ytext.insert(0, next);
    return;
  }
  const minLen = Math.min(current.length, next.length);

  let start = 0;
  while (start < minLen && current.charCodeAt(start) === next.charCodeAt(start)) start += 1;

  let endCurrent = current.length;
  let endNext = next.length;
  while (
    endCurrent > start &&
    endNext > start &&
    current.charCodeAt(endCurrent - 1) === next.charCodeAt(endNext - 1)
  ) {
    endCurrent -= 1;
    endNext -= 1;
  }

  // Keep surrogate pairs whole at both edges of the changed middle.
  start = snapBack(current, start);
  start = snapBack(next, start);
  endCurrent = snapBack(current, endCurrent);
  endNext = snapBack(next, endNext);

  const deleteLength = endCurrent - start;
  const inserted = next.slice(start, endNext);

  doc.transact(() => {
    if (deleteLength > 0) ytext.delete(start, deleteLength);
    if (inserted.length > 0) ytext.insert(start, inserted);
  }, origin);
}

/**
 * The largest integer font size, between `STICKY_FONT_MIN_PX` and
 * `STICKY_FONT_MAX_PX` (inclusive), at which `text` still fits a
 * `boxWidth` × `boxHeight` content box, wrapped like the note renders it.
 *
 * We measure a hidden, auto-height mirror of the text rather than the note's
 * own `overflow: hidden` box: a fixed-height, clipped element always reports
 * `scrollHeight === clientHeight`, which would read as "always overflowing".
 * In an engine without layout (jsdom) the mirror measures zero height, so the
 * text is treated as fitting and the maximum size is returned — real fitting is
 * exercised by the e2e suite.
 */
export function fitText(
  text: string,
  boxWidth: number,
  boxHeight: number,
  lineHeight = 1.25,
): { fontPx: number; overflow: boolean } {
  const min = STICKY_FONT_MIN_PX;
  const max = STICKY_FONT_MAX_PX;
  const measure = getMeasureElement();
  const heightAt = (size: number): number => {
    if (!measure) return 0;
    measure.style.width = `${boxWidth}px`;
    measure.style.fontSize = `${size}px`;
    measure.style.lineHeight = String(lineHeight);
    measure.textContent = text.length > 0 ? text : '\u00A0';
    return measure.scrollHeight;
  };

  // Fast path: everything already fits at the largest size.
  if (heightAt(max) <= boxHeight) return { fontPx: max, overflow: false };

  for (let size = max - 1; size >= min; size -= 1) {
    if (heightAt(size) <= boxHeight) return { fontPx: size, overflow: false };
  }
  // Nothing fits, not even the minimum: pin to the minimum and flag overflow.
  return { fontPx: min, overflow: true };
}

/**
 * A single off-screen mirror used to measure wrapped text height. It is never
 * shown (`aria-hidden`, `visibility: hidden`) and sits outside the transform
 * stack so it cannot affect the board layout.
 */
let measureElement: HTMLDivElement | null = null;
function getMeasureElement(): HTMLDivElement | null {
  if (typeof document === 'undefined' || !document.body) return null;
  if (!measureElement || !document.body.contains(measureElement)) {
    const el = document.createElement('div');
    el.setAttribute('aria-hidden', 'true');
    el.style.cssText =
      'position:fixed;left:-99999px;top:0;visibility:hidden;white-space:pre-wrap;' +
      'word-break:break-word;overflow:visible;pointer-events:none;';
    document.body.appendChild(el);
    measureElement = el;
  }
  return measureElement;
}

/** Back-compat shim kept for the layout-free unit test: measure a bare box. */
export function fitFontSize(
  el: HTMLElement,
  box: number,
): { fontPx: number; overflow: boolean } {
  const min = STICKY_FONT_MIN_PX;
  const max = STICKY_FONT_MAX_PX;
  const fits = (size: number): boolean => {
    el.style.fontSize = `${size}px`;
    return el.scrollHeight <= box;
  };
  if (fits(max)) return { fontPx: max, overflow: false };
  for (let size = max - 1; size >= min; size -= 1) {
    if (fits(size)) return { fontPx: size, overflow: false };
  }
  el.style.fontSize = `${min}px`;
  return { fontPx: min, overflow: true };
}