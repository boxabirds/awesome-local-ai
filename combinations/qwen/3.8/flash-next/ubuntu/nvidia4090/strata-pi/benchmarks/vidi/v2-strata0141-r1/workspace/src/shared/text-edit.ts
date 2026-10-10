import type * as Y from 'yjs';

/**
 * Shared text-editing helpers (anchor `text.model`, `sticky.text`).
 *
 * These lived in `src/client/objects/StickyText.ts` (story 2). Story 9 moved
 * them here because a sticky note and a text object store their words the same
 * way - one `Y.Text`, written with the minimal change - and the rules must not
 * drift apart: the character limit is the only number that differs.
 *
 * `src/client/objects/StickyText.ts` re-exports them with STICKY_TEXT_MAX_CHARS
 * as the default, so story 2's callers are unchanged.
 */

const isHighSurrogate = (code: number): boolean => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number): boolean => code >= 0xdc00 && code <= 0xdfff;

/**
 * At most `max` characters of `next`. Characters beyond the limit are dropped
 * (`text.limit`, `sticky.limit`); a surrogate pair that would be cut in half is
 * dropped whole, so clamped text is always valid.
 */
export function clampToLimit(next: string, max: number): string {
  if (typeof next !== 'string' || next.length === 0) {
    return typeof next === 'string' ? next : '';
  }
  if (!(typeof max === 'number') || !Number.isFinite(max) || max < 0) {
    return '';
  }
  if (next.length <= max) {
    return next;
  }
  if (max === 0) {
    return '';
  }
  const last = next.charCodeAt(max - 1);
  // Cutting between a high and a low surrogate would corrupt the character.
  const length = isHighSurrogate(last) || isLowSurrogate(next.charCodeAt(max)) ? max - 1 : max;
  return next.slice(0, length);
}

export interface TextDiff {
  readonly start: number;
  readonly deleteLength: number;
  readonly insert: string;
}

/**
 * The single change that turns `prev` into `next`: the common prefix and the
 * common suffix are kept, and only the different middle is rewritten. Boundaries
 * are moved so a surrogate pair is never split.
 */
export function minimalDiff(prev: string, next: string): TextDiff {
  const minLen = Math.min(prev.length, next.length);

  let prefix = 0;
  while (prefix < minLen && prev.charCodeAt(prefix) === next.charCodeAt(prefix)) {
    prefix += 1;
  }
  // A common prefix must not end between a surrogate pair.
  if (prefix > 0 && prefix < prev.length && isHighSurrogate(prev.charCodeAt(prefix - 1))) {
    prefix -= 1;
  }

  let suffix = 0;
  while (
    suffix < minLen - prefix &&
    prev.charCodeAt(prev.length - 1 - suffix) === next.charCodeAt(next.length - 1 - suffix)
  ) {
    suffix += 1;
  }
  // A common suffix must not start between a surrogate pair.
  if (suffix > 0 && isLowSurrogate(prev.charCodeAt(prev.length - suffix))) {
    suffix -= 1;
  }

  return {
    start: prefix,
    deleteLength: prev.length - prefix - suffix,
    insert: next.slice(prefix, next.length - suffix),
  };
}

/**
 * Write `next` into `ytext` with the minimal change - one delete and/or one
 * insert, inside a single transaction with the caller's origin. A full replace
 * would destroy characters other people typed at the same time (story 3,
 * `text.concurrent`).
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const prev = ytext.toString();
  if (prev === next) {
    return;
  }
  const { start, deleteLength, insert } = minimalDiff(prev, next);
  const doc = ytext.doc;
  const write = (): void => {
    if (deleteLength > 0) {
      ytext.delete(start, deleteLength);
    }
    if (insert.length > 0) {
      ytext.insert(start, insert);
    }
  };
  if (doc) {
    doc.transact(write, origin);
  } else {
    write();
  }
}
