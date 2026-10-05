import type { CSSProperties } from "react";
import * as Y from "yjs";
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
  STICKY_TEXT_PADDING_WORLD,
} from "../../shared/config";

/**
 * Sticky note text logic (`sticky.text`).
 *
 * Pure, testable pieces of note editing: the length limit, the minimal
 * textarea -> Y.Text diff, the counter rule and the font auto-fit. The React
 * editor component (`StickyTextEditor.tsx`) is only glue around these.
 */

/** Drops every character beyond `max` (default `STICKY_TEXT_MAX_CHARS`). */
export function clampToLimit(next: string, max = STICKY_TEXT_MAX_CHARS): string {
  if (typeof next !== "string") return "";
  const limit = Number.isFinite(max) && max >= 0 ? Math.floor(max) : STICKY_TEXT_MAX_CHARS;
  return next.length <= limit ? next : next.slice(0, limit);
}

/**
 * Writes `next` into `ytext` with the smallest possible change: common prefix
 * and common suffix are left alone, so a single typed character stays a single
 * insert and text typed concurrently by someone else is never destroyed.
 *
 * Boundaries are moved off surrogate pairs so an emoji is never cut in half.
 * Does nothing (and opens no transaction) when the text is unchanged.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  if (!(ytext instanceof Y.Text) || typeof next !== "string") return;

  const current = ytext.toString();
  if (current === next) return;

  const prefix = commonPrefixLength(current, next);
  const suffix = commonSuffixLength(current, next, prefix);
  const deleteLength = current.length - prefix - suffix;
  const insert = next.slice(prefix, next.length - suffix);
  if (deleteLength === 0 && insert.length === 0) return;

  const apply = () => {
    if (deleteLength > 0) ytext.delete(prefix, deleteLength);
    if (insert.length > 0) ytext.insert(prefix, insert);
  };

  // One transaction per input event (nested calls join the open transaction).
  const doc = ytext.doc;
  if (doc) doc.transact(apply, origin);
  else apply();
}

/** True when `length` leaves `STICKY_COUNTER_THRESHOLD_CHARS` or fewer to type. */
export function counterVisible(length: number): boolean {
  if (!Number.isFinite(length)) return false;
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

export interface FontFit {
  /** Largest size in [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX] that fits. */
  readonly fontPx: number;
  /** True when even the smallest size does not fit: show the bottom fade. */
  readonly overflow: boolean;
}

/**
 * Binary-searches the largest integer font size whose text fits in `box`
 * (the element's own border-box height, in board units).
 *
 * The element keeps its final size in `style.fontSize`, so the measurement is
 * also the applied style. The font size is in board units, which is why it
 * scales with the board zoom and only ever needs measuring at one zoom.
 */
export function fitFontSize(el: HTMLElement, box: number): FontFit {
  if (!Number.isFinite(box) || box <= 0) {
    return { fontPx: STICKY_FONT_MAX_PX, overflow: false };
  }

  const fitsAt = (size: number): boolean => {
    el.style.fontSize = `${size}px`;
    return el.scrollHeight <= box;
  };

  let result: FontFit;
  if (fitsAt(STICKY_FONT_MAX_PX)) {
    result = { fontPx: STICKY_FONT_MAX_PX, overflow: false };
  } else if (!fitsAt(STICKY_FONT_MIN_PX)) {
    result = { fontPx: STICKY_FONT_MIN_PX, overflow: true };
  } else {
    let low = STICKY_FONT_MIN_PX;
    let high = STICKY_FONT_MAX_PX;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (fitsAt(mid)) low = mid;
      else high = mid - 1;
    }
    result = { fontPx: low, overflow: false };
  }

  el.style.fontSize = `${result.fontPx}px`;
  return result;
}

// ---- internals ------------------------------------------------------------

/**
 * Positions a note's text box from the board settings, so the stylesheet does
 * not repeat a board measurement: the box is the note inset by
 * STICKY_TEXT_PADDING_WORLD on every side (= STICKY_TEXT_BOX_WORLD), and its
 * `scrollHeight` is what `fitFontSize` compares against that box.
 */
export function textBoxStyle(extra?: CSSProperties): CSSProperties {
  return {
    top: STICKY_TEXT_PADDING_WORLD,
    right: STICKY_TEXT_PADDING_WORLD,
    bottom: STICKY_TEXT_PADDING_WORLD,
    left: STICKY_TEXT_PADDING_WORLD,
    ...(extra ?? {}),
  };
}

/** Common prefix in UTF-16 units, moved back off a partial surrogate pair. */
function commonPrefixLength(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a.charCodeAt(i) === b.charCodeAt(i)) i += 1;
  if (i > 0 && isHighSurrogate(a.charCodeAt(i - 1))) i -= 1;
  return i;
}

/** Common suffix that cannot overlap the prefix, aligned to a pair boundary. */
function commonSuffixLength(a: string, b: string, prefix: number): number {
  const max = Math.min(a.length - prefix, b.length - prefix);
  let i = 0;
  while (i < max && a.charCodeAt(a.length - 1 - i) === b.charCodeAt(b.length - 1 - i)) i += 1;
  if (i > 0 && isLowSurrogate(a.charCodeAt(a.length - i))) i -= 1;
  return Math.max(0, i);
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}
