import * as Y from "yjs";
import { TEXT_MAX_CHARS } from "./config";

/**
 * Shared text mutation helpers (`text.limit`).
 *
 * Story 2 grew these beside the sticky note; story 9 moved them here so notes
 * and text objects clamp and diff through one implementation. They are DOM-free
 * on purpose: `src/shared` is compiled for the worker too, and the Durable
 * Object has to clamp the same way the browser does.
 *
 * `src/client/objects/StickyText.ts` re-exports them with
 * `STICKY_TEXT_MAX_CHARS` so story 2's callers are unchanged.
 */

/** Drops every character beyond `max`. */
export function clampToLimit(next: string, max = TEXT_MAX_CHARS): string {
  if (typeof next !== "string") return "";
  const limit = Number.isFinite(max) && max >= 0 ? Math.floor(max) : TEXT_MAX_CHARS;
  return next.length <= limit ? next : next.slice(0, limit);
}

/**
 * Writes `next` into `ytext` with the smallest possible change: common prefix
 * and common suffix are left alone, so a single typed character stays a single
 * insert and text typed concurrently by someone else is never destroyed.
 *
 * Boundaries are moved off surrogate pairs so an emoji is never cut in half.
 * The value is clamped to `max` characters first. Does nothing (and opens no
 * transaction) when the text is unchanged.
 */
export function applyTextDiff(
  ytext: Y.Text,
  next: string,
  origin: unknown,
  max = TEXT_MAX_CHARS,
): void {
  if (!(ytext instanceof Y.Text) || typeof next !== "string") return;

  const target = clampToLimit(next, max);
  const current = ytext.toString();
  if (current === target) return;

  const prefix = commonPrefixLength(current, target);
  const suffix = commonSuffixLength(current, target, prefix);
  const deleteLength = current.length - prefix - suffix;
  const insert = target.slice(prefix, target.length - suffix);
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

/** The single contiguous change that turns `previous` into `next`. */
export interface LocalEdit {
  readonly start: number;
  readonly removed: string;
  readonly inserted: string;
}

/** `localEditOf(previous, next) -> edit | null` — null when they are the same. */
export function localEditOf(previous: string, next: string): LocalEdit | null {
  if (typeof previous !== "string" || typeof next !== "string" || previous === next) return null;
  const prefix = commonPrefixLength(previous, next);
  const suffix = commonSuffixLength(previous, next, prefix);
  return {
    start: prefix,
    removed: previous.slice(prefix, previous.length - suffix),
    inserted: next.slice(prefix, next.length - suffix),
  };
}

/**
 * `applyLocalEdit(ytext, previous, next, origin, max) -> applied`
 *
 * Applies the change this field made - `previous` into `next` - at the place that
 * change corresponds to in the shared text *as it is now*.
 *
 * `previous` is what the field held when the change was made, and that is not
 * necessarily what the shared text holds: somebody else may have typed into the
 * same object in the meantime, and the update may not have arrived yet. Diffing
 * the field against the shared text instead would treat their typing as text this
 * field meant to delete. So the edit is located against `previous`, moved across
 * whatever arrived, and its removal is carried out only where that text really is
 * still there - text another client replaced is theirs to remove, not ours.
 */
export function applyLocalEdit(
  ytext: Y.Text,
  previous: string,
  next: string,
  origin: unknown,
  max = TEXT_MAX_CHARS,
): boolean {
  if (!(ytext instanceof Y.Text)) return false;
  const edit = localEditOf(clampToLimit(previous, max), clampToLimit(next, max));
  if (!edit) return false;

  const current = ytext.toString();
  // Everything up to where the shared text and the field's own text still agree
  // is untouched, so an edit made in that region keeps its position; anything
  // after it moves by what arrived.
  const agreed = commonPrefixLength(previous, current);
  const shift = current.length - previous.length;
  let start = edit.start <= agreed ? edit.start : Math.max(agreed, edit.start + shift);
  start = Math.max(0, Math.min(start, current.length));
  // Never between the halves of a surrogate pair somebody else typed.
  if (start > 0 && isLowSurrogate(current.charCodeAt(start))) start -= 1;

  let removeAt = -1;
  if (edit.removed.length > 0) {
    if (current.startsWith(edit.removed, start)) removeAt = start;
    else {
      const found = current.indexOf(edit.removed, start);
      if (found >= 0) removeAt = found;
    }
  }

  const apply = () => {
    if (removeAt >= 0) ytext.delete(removeAt, edit.removed.length);
    const at = removeAt >= 0 ? removeAt : start;
    if (edit.inserted.length > 0) ytext.insert(at, edit.inserted);
  };

  const doc = ytext.doc;
  if (doc) doc.transact(apply, origin);
  else apply();
  return true;
}

/** Common prefix in UTF-16 units, moved back off a partial surrogate pair. */
export function commonPrefixLength(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a.charCodeAt(i) === b.charCodeAt(i)) i += 1;
  if (i > 0 && isHighSurrogate(a.charCodeAt(i - 1))) i -= 1;
  return i;
}

/** Common suffix that cannot overlap the prefix, aligned to a pair boundary. */
export function commonSuffixLength(a: string, b: string, prefix = 0): number {
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
