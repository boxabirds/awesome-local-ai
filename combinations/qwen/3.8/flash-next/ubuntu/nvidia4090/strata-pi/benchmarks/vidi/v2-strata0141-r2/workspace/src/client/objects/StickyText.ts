import type * as Y from 'yjs';
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';

/**
 * Sticky note text logic (story 2): the pure helpers behind the editor.
 *
 * - the limit is enforced here, so no caller can write an over-long note;
 * - the diff is minimal (longest common prefix + longest common suffix), which
 *   is what makes concurrent typing safe once story 3 syncs the document;
 * - font fit is measured, not estimated, so text always stays inside the note.
 */

export interface FontFit {
  readonly fontPx: number;
  readonly overflow: boolean;
}

/** Keep at most `max` characters; characters beyond the limit are dropped. */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  const limit = Number.isFinite(max) && max >= 0 ? Math.floor(max) : STICKY_TEXT_MAX_CHARS;
  if (next.length <= limit) {
    return next;
  }
  // Never cut in the middle of a surrogate pair.
  const raw = next.slice(0, limit);
  const last = raw.charCodeAt(raw.length - 1);
  const cut = last >= 0xd800 && last <= 0xdbff ? raw.slice(0, -1) : raw;
  return cut;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/**
 * Write `next` into `ytext` using at most one delete and one insert.
 * No-op when the text already matches (no transaction, no update event).
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const current = ytext.toString();
  if (current === next) {
    return;
  }

  let prefix = 0;
  const shared = Math.min(current.length, next.length);
  while (prefix < shared && current.charCodeAt(prefix) === next.charCodeAt(prefix)) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < shared - prefix &&
    current.charCodeAt(current.length - 1 - suffix) === next.charCodeAt(next.length - 1 - suffix)
  ) {
    suffix += 1;
  }

  // Keep whole surrogate pairs on one side of the edit boundary.
  if (
    prefix > 0 &&
    prefix < current.length &&
    isLowSurrogate(current.charCodeAt(prefix)) &&
    isHighSurrogate(current.charCodeAt(prefix - 1))
  ) {
    prefix -= 1;
  }
  if (
    suffix > 0 &&
    suffix < current.length &&
    isHighSurrogate(current.charCodeAt(current.length - suffix)) &&
    suffix < current.length - 1 &&
    isLowSurrogate(current.charCodeAt(current.length - suffix - 1))
  ) {
    suffix -= 1;
  }

  const deleteLength = current.length - prefix - suffix;
  const insertText = next.slice(prefix, next.length - suffix);
  if (deleteLength === 0 && insertText.length === 0) {
    return;
  }

  const run = (): void => {
    if (deleteLength > 0) {
      ytext.delete(prefix, deleteLength);
    }
    if (insertText.length > 0) {
      ytext.insert(prefix, insertText);
    }
  };

  const doc = ytext.doc;
  if (doc) {
    doc.transact(run, origin);
  } else {
    run();
  }
}

/** True when `STICKY_COUNTER_THRESHOLD_CHARS` or fewer characters remain. */
export function counterVisible(length: number): boolean {
  if (!Number.isFinite(length) || length < 0) {
    return false;
  }
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Largest integer font size in [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX] at
 * which `el`'s content still fits inside `box` (CSS pixels of the note's text
 * box). When even the smallest size overflows, `overflow` is true and the note
 * clips the text with a fade instead of letting it escape.
 *
 * The element's inline `font-size` is set for every candidate and left at the
 * fitted size, which is the size the note then renders with.
 */
export function fitFontSize(el: HTMLElement, box: number): FontFit {
  const limit = Number.isFinite(box) && box > 0 ? box : Number.POSITIVE_INFINITY;

  let low = STICKY_FONT_MIN_PX;
  let high = STICKY_FONT_MAX_PX;
  let best = 0;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    el.style.fontSize = `${middle}px`;
    if (el.scrollHeight <= limit) {
      best = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  const fontPx = best > 0 ? best : STICKY_FONT_MIN_PX;
  el.style.fontSize = `${fontPx}px`;
  const overflow = el.scrollHeight > limit;

  return { fontPx, overflow };
}
