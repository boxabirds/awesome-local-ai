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

export interface TextDiff {
  /** Where the change starts, in `before`. */
  readonly prefix: number;
  /** How many characters of `before` the change removes. */
  readonly deleteLength: number;
  /** What the change writes in their place. */
  readonly insertText: string;
}

/**
 * The single change between two strings: longest common prefix, longest common
 * suffix, one edit in the middle. This is what makes concurrent typing safe —
 * a keystroke is a small change, and applying only that change leaves anything
 * someone else wrote alone.
 */
export function diffText(before: string, after: string): TextDiff {
  let prefix = 0;
  const shared = Math.min(before.length, after.length);
  while (prefix < shared && before.charCodeAt(prefix) === after.charCodeAt(prefix)) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < shared - prefix &&
    before.charCodeAt(before.length - 1 - suffix) === after.charCodeAt(after.length - 1 - suffix)
  ) {
    suffix += 1;
  }

  // Keep whole surrogate pairs on one side of the edit boundary.
  if (
    prefix > 0 &&
    prefix < before.length &&
    isLowSurrogate(before.charCodeAt(prefix)) &&
    isHighSurrogate(before.charCodeAt(prefix - 1))
  ) {
    prefix -= 1;
  }
  if (
    suffix > 0 &&
    suffix < before.length &&
    isHighSurrogate(before.charCodeAt(before.length - suffix)) &&
    suffix < before.length - 1 &&
    isLowSurrogate(before.charCodeAt(before.length - suffix - 1))
  ) {
    suffix -= 1;
  }

  return {
    prefix,
    deleteLength: before.length - prefix - suffix,
    insertText: after.slice(prefix, after.length - suffix),
  };
}

export interface RemoteMerge {
  readonly value: string;
  /** How far the caret moves so typing can continue where it was. */
  readonly caretShift: number;
}

/**
 * Fold text that arrived from someone else into what this editor is showing.
 *
 * `base` is the shared text this editor's `local` value was built on. Remote
 * text never replaces `local` wholesale — that would drop the characters typed
 * since `base`, which is exactly how two people typing into one note lose each
 * other's work. Instead the remote change (relative to `base`) is written into
 * `local` at the place it belongs.
 *
 * When this editor has edited the very region the remote change touched, both
 * edits are kept: the remote text is inserted at that point and the local one
 * stays next to it. Order can shift; nothing is thrown away.
 */
export function mergeRemoteText(local: string, base: string, remote: string): RemoteMerge {
  if (local === base) {
    // Nothing local to protect: the shared text is the value.
    return { value: remote, caretShift: 0 };
  }
  if (remote === base) {
    return { value: local, caretShift: 0 };
  }

  const { prefix, deleteLength, insertText } = diffText(base, remote);
  const untouchedHere = local.slice(prefix, prefix + deleteLength) === base.slice(prefix, prefix + deleteLength);

  if (untouchedHere) {
    return {
      value: local.slice(0, prefix) + insertText + local.slice(prefix + deleteLength),
      caretShift: insertText.length - deleteLength,
    };
  }

  return {
    value: local.slice(0, prefix) + insertText + local.slice(prefix),
    caretShift: insertText.length,
  };
}

/**
 * Write one change — delete `deleteLength` characters at `at`, insert
 * `insertText` there — into the shared text. Indexes are pulled back into
 * range, and nothing else in the text is touched, which is what lets two
 * people type into one note without overwriting each other.
 */
export function applyTextDelta(
  ytext: Y.Text,
  at: number,
  deleteLength: number,
  insertText: string,
  origin: unknown,
): void {
  const length = ytext.length;
  const start = Number.isFinite(at) ? Math.max(0, Math.min(Math.floor(at), length)) : 0;
  const remove = Number.isFinite(deleteLength) ? Math.max(0, Math.min(Math.floor(deleteLength), length - start)) : 0;
  const insert = insertText.length;
  if (remove === 0 && insert === 0) {
    return;
  }

  const run = (): void => {
    if (remove > 0) {
      ytext.delete(start, remove);
    }
    if (insert > 0) {
      ytext.insert(start, insertText);
    }
  };

  const doc = ytext.doc;
  if (doc) {
    doc.transact(run, origin);
  } else {
    run();
  }
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

  const { prefix, deleteLength, insertText } = diffText(current, next);
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
