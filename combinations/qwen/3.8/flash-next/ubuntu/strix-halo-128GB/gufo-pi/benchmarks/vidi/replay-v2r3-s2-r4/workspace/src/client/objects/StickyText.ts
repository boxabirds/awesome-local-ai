import * as Y from 'yjs';
import {
  STICKY_TEXT_MAX_CHARS,
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MIN_PX,
  STICKY_FONT_MAX_PX,
} from '../../shared/config';

/**
 * Pure text helpers for sticky notes: length clamp, minimal Y.Text diff,
 * counter visibility and font auto-fit. Kept free of React so they can be unit
 * tested against a real Y.Text.
 */

/** Keep at most `max` characters; characters beyond the limit are dropped. */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return next.length <= max ? next : next.slice(0, max);
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/**
 * Write `next` into `ytext` using the smallest possible change (common prefix
 * plus common suffix), so concurrent typing by other users (story 3) is never
 * destroyed. Surrogate pairs are never split: when the boundary would fall
 * between the two halves of a pair, the boundary moves back one code unit.
 *
 * Input is clamped to STICKY_TEXT_MAX_CHARS as a safety net, so a caller that
 * forgot to clamp cannot push the text past the limit.
 */
export function applyTextDiff(ytext: Y.Text, nextRaw: string, origin: unknown): void {
  const next = clampToLimit(nextRaw);
  const current = ytext.toString();
  if (current === next) return;

  let prefix = 0;
  const maxPrefix = Math.min(current.length, next.length);
  while (
    prefix < maxPrefix &&
    current.charCodeAt(prefix) === next.charCodeAt(prefix)
  ) {
    prefix += 1;
  }
  // Never end the shared prefix between a surrogate pair.
  if (prefix > 0 && isHighSurrogate(current.charCodeAt(prefix - 1))) {
    prefix -= 1;
  }

  let suffix = 0;
  const maxSuffix = Math.min(current.length - prefix, next.length - prefix);
  while (
    suffix < maxSuffix &&
    current.charCodeAt(current.length - 1 - suffix) === next.charCodeAt(next.length - 1 - suffix)
  ) {
    suffix += 1;
  }
  // Never start the shared suffix inside a surrogate pair.
  if (
    suffix > 0 &&
    isLowSurrogate(current.charCodeAt(current.length - suffix))
  ) {
    suffix -= 1;
  }

  const deleteLen = current.length - prefix - suffix;
  const insertText = next.slice(prefix, next.length - suffix);
  if (deleteLen <= 0 && insertText.length === 0) return;

  const apply = () => {
    if (deleteLen > 0) ytext.delete(prefix, deleteLen);
    if (insertText.length > 0) ytext.insert(prefix, insertText);
  };

  if (ytext.doc) {
    ytext.doc.transact(apply, origin);
  } else {
    apply();
  }
}

/** True when the characters remaining to the limit are within the threshold. */
export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Largest integer font size in [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX] at which
 * the element's content fits within `box` pixels of height. `overflow` is true
 * when the text does not fit even at the minimum size, so the caller clips it
 * and shows a fade at the bottom edge.
 */
export function fitFontSize(
  el: HTMLElement,
  box: number,
): { fontPx: number; overflow: boolean } {
  const fits = (size: number): boolean => {
    el.style.fontSize = `${size}px`;
    return el.scrollHeight <= box;
  };

  const previous = el.style.fontSize;
  const finish = (fontPx: number, overflow: boolean) => {
    // Leave the measured element where the caller expects it (React owns this style).
    el.style.fontSize = previous;
    return { fontPx, overflow };
  };

  if (!fits(STICKY_FONT_MIN_PX)) {
    return finish(STICKY_FONT_MIN_PX, true);
  }
  if (fits(STICKY_FONT_MAX_PX)) {
    return finish(STICKY_FONT_MAX_PX, false);
  }

  // Binary search the largest size that still fits (min fits, max does not).
  let low = STICKY_FONT_MIN_PX;
  let high = STICKY_FONT_MAX_PX;
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (fits(mid)) {
      low = mid;
    } else {
      high = mid;
    }
  }
  return finish(low, false);
}
