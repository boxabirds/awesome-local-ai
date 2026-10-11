import * as Y from 'yjs';

import { LOCAL_ORIGIN, TEXT_TYPE, deleteObjects, maxZ, objectsOf } from '../board-model.js';
import type { ObjectSnapshot } from '../board-model.js';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_LINE_HEIGHT,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
} from '../config.js';
import type { TextSize } from '../config.js';

/**
 * Story 9: a text object — plain text with no background, anywhere on the board.
 *
 * It is one entry in the story 7 `objects` map, so selecting it, moving it,
 * deleting it and undoing it (`sel.*`, `undo.*`) and sharing it (`text.shared`)
 * are the code those stories already wrote. What is new here is only what a
 * text has and a sticky note has not: a size preset, a choice of how its width
 * was arrived at, and — the part the client measures — the rule that its height
 * always follows its content.
 *
 * The `id` here is the board's own `objects` id (the map key). Story 14 gives a
 * text a *content* id when `src/shared/schema.ts` lands; that is a different
 * thing, and this module will not change when it arrives.
 */

/** What a board stores for a text object's size (`text.size`). */
export type TextSizeValue = TextSize;

/** How a text object's width was arrived at (`text.auto_width`, `text.fixed_width`). */
export type TextWidthMode = 'auto' | 'fixed';

/** A text object, as the generic object snapshot reads it. */
export interface TextSnapshot extends ObjectSnapshot {
  readonly type: typeof TEXT_TYPE;
  /** The font size preset; the board unit → CSS pixel rule is in {@link TEXT_SIZES}. */
  readonly size: TextSizeValue;
  /** Whether the width came from the content or from a side handle. */
  readonly widthMode: TextWidthMode;
  /** The characters, joined from the `Y.Text` for rendering and measuring. */
  readonly text: string;
  /** The anonymous per-tab id of who made it — `identity.user_ref` is story 6. */
  readonly createdBy?: string;
}

/** The four names the toolbar offers, in the order it offers them. */
export const TEXT_SIZE_NAMES = Object.keys(TEXT_SIZES) as TextSizeValue[];

/** Is `value` one of the four size names? (Anything else is refused.) */
export function isTextSize(value: unknown): value is TextSizeValue {
  return typeof value === 'string' && Object.hasOwn(TEXT_SIZES, value);
}

/** Is `value` one of the two width modes? */
export function isTextWidthMode(value: unknown): value is TextWidthMode {
  return value === 'auto' || value === 'fixed';
}

/** The font size of a size preset, in board units (CSS pixels at 100 % zoom). */
export function textFontSizeWorld(size: TextSizeValue): number {
  return TEXT_SIZES[size];
}

/** How tall one line of `size` is, in board units (`text.height`). */
export function textLineHeightWorld(size: TextSizeValue): number {
  return TEXT_SIZES[size] * TEXT_LINE_HEIGHT;
}

/* --- reading and writing one text object -------------------------------- */

/** The `objects` map entry for `id`, when it is a text object's own entry. */
export function textEntryOf(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const entry = objectsOf(doc).get(id);
  return isTextEntry(entry) ? entry : undefined;
}

/**
 * Is this an object entry a text object? The `type` is what says so — a sticky
 * note in the same map is not, and an entry of a type this build has never seen
 * is not either (compatibility constraint: skip, do not fail).
 */
export function isTextEntry(entry: unknown): entry is Y.Map<unknown> {
  return entry instanceof Y.Map && entry.get('type') === TEXT_TYPE;
}

/** Narrow a generic object snapshot to a text one (the registry asks). */
export function isTextSnapshot(object: ObjectSnapshot): object is TextSnapshot {
  return (
    object.type === TEXT_TYPE &&
    isTextSize((object as TextSnapshot).size) &&
    isTextWidthMode((object as TextSnapshot).widthMode) &&
    typeof (object as TextSnapshot).text === 'string'
  );
}

/** The `Y.Text` holding the characters, for the editor to diff into. */
export function getTextContent(doc: Y.Doc, id: string): Y.Text | undefined {
  const text = textEntryOf(doc, id)?.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/** The rectangle a text object has been measured at, or `null` when it has none. */
export function getTextBox(doc: Y.Doc, id: string): { x: number; y: number; width: number; height: number } | null {
  const entry = textEntryOf(doc, id);
  if (!entry) return null;
  const x = entry.get('x');
  const y = entry.get('y');
  const width = entry.get('width');
  const height = entry.get('height');
  if (![x, y, width, height].every((value) => typeof value === 'number' && Number.isFinite(value))) {
    return null;
  }
  return { x: x as number, y: y as number, width: width as number, height: height as number };
}

/** How this object's width was arrived at, or `null` when there is no such text. */
export function getTextWidthMode(doc: Y.Doc, id: string): TextWidthMode | null {
  const mode = textEntryOf(doc, id)?.get('widthMode');
  return isTextWidthMode(mode) ? mode : null;
}

/** `true` while the object is still as wide as its content (`text.auto_width`). */
export function isAutoWidth(doc: Y.Doc, id: string): boolean {
  return getTextWidthMode(doc, id) === 'auto';
}

/**
 * Create a text object with its **top-left** at `at` (world units), on top of
 * every other object, at size M and as wide as its (empty) content can be.
 *
 * Unlike `createSticky`, which centres itself on the point it is given, a text
 * is placed by its top-left: that is the corner a heading starts from, and the
 * one that keeps its place when the size changes (`text.size`).
 *
 * The box is written from an estimate rather than left out, so the object has
 * bounds — and can be selected, moved and undone — before anyone has measured
 * it. `createdBy` is the per-tab anonymous id (story 6 replaces the caller's
 * argument with a real user reference; this signature does not change).
 *
 * Returns the new id, or `null` when the point is not finite.
 */
export function createText(
  doc: Y.Doc,
  at: { x: number; y: number },
  createdBy = '',
): string | null {
  if (!at || !Number.isFinite(at.x) || !Number.isFinite(at.y)) return null;

  const id = crypto.randomUUID();
  const size = DEFAULT_TEXT_SIZE;
  const width = TEXT_MIN_WIDTH_WORLD;
  // A whole number of board units, which is what the layout writes for every
  // other box too, so the first re-measure of a fresh text is not a write.
  const height = Math.round(textLineHeightWorld(size));
  const z = maxZ(doc) + 1;
  const createdAt = Date.now();

  // `LOCAL_ORIGIN`, like every other write here: story 7's undo filter
  // (undo.self_only) records a change only when it carries this origin, and
  // `useTextBoxSync` uses the same test to tell "I resized this" from "someone
  // else's text arrived".
  doc.transact(() => {
    const entry = new Y.Map<unknown>();
    entry.set('id', id);
    entry.set('type', TEXT_TYPE);
    entry.set('x', at.x);
    entry.set('y', at.y);
    entry.set('width', width);
    entry.set('height', height);
    entry.set('size', size);
    entry.set('widthMode', 'auto' satisfies TextWidthMode);
    // The characters are a shared string, not a string field (text.shared).
    entry.set('text', new Y.Text());
    entry.set('z', z);
    entry.set('createdAt', createdAt);
    entry.set('createdBy', createdBy);
    objectsOf(doc).set(id, entry);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Pick a size preset (`text.size`). The top-left does not move and the width is
 * left alone: the client that asked re-measures, and everyone else re-wraps from
 * the size they are told about (`useTextBoxSync`), which is where the height and
 * an automatic width follow the new size.
 */
export function setTextSize(doc: Y.Doc, id: string, size: string): boolean {
  if (!isTextSize(size)) return false;
  const entry = textEntryOf(doc, id);
  if (!entry || entry.get('size') === size) return false;
  doc.transact(() => {
    entry.set('size', size);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Say how wide the object is, and mean it (`text.fixed_width`): a width below
 * the minimum is raised to it, and the object stops following its content.
 *
 * The new height that falls out of the new width can be handed in as well, so a
 * width drag leaves one write behind — width, mode and height in one
 * transaction — instead of a witness stand with three entries on it.
 */
export function setTextWidthFixed(
  doc: Y.Doc,
  id: string,
  width: number,
  height?: number,
): boolean {
  if (!Number.isFinite(width)) return false;
  const entry = textEntryOf(doc, id);
  if (!entry) return false;
  const next = Math.max(TEXT_MIN_WIDTH_WORLD, width);
  const nextHeight = typeof height === 'number' && Number.isFinite(height) ? height : undefined;
  if (
    entry.get('width') === next &&
    entry.get('widthMode') === 'fixed' &&
    (nextHeight === undefined || entry.get('height') === nextHeight)
  ) {
    return false;
  }
  doc.transact(() => {
    entry.set('width', next);
    entry.set('widthMode', 'fixed');
    if (nextHeight !== undefined) entry.set('height', nextHeight);
  }, LOCAL_ORIGIN);
  return true;
}

/** Say the width comes from the content again (`text.auto_width`). */
export function setTextWidthMode(doc: Y.Doc, id: string, mode: TextWidthMode): boolean {
  const entry = textEntryOf(doc, id);
  if (!entry || !isTextWidthMode(mode) || entry.get('widthMode') === mode) return false;
  doc.transact(() => {
    entry.set('widthMode', mode);
  }, LOCAL_ORIGIN);
  return true;
}

/** Flip between automatic and fixed width; `null` when there is no such text. */
export function toggleTextWidthMode(doc: Y.Doc, id: string): TextWidthMode | null {
  const mode = getTextWidthMode(doc, id);
  if (!mode) return null;
  return setTextWidthMode(doc, id, mode === 'auto' ? 'fixed' : 'auto') ? (mode === 'auto' ? 'fixed' : 'auto') : mode;
}

/**
 * Write the box a client measured (`text.height`, `text.auto_width`): the only
 * place a text object's `width`/`height` are written together, and it changes
 * nothing when the numbers are already these. `x`/`y` are not touched — a
 * measure never moves an object.
 */
export function setTextBox(
  doc: Y.Doc,
  id: string,
  box: { width: number; height: number },
): boolean {
  if (!Number.isFinite(box.width) || !Number.isFinite(box.height)) return false;
  if (box.width <= 0 || box.height <= 0) return false;
  const entry = textEntryOf(doc, id);
  if (!entry) return false;
  if (entry.get('width') === box.width && entry.get('height') === box.height) return false;
  doc.transact(() => {
    entry.set('width', box.width);
    entry.set('height', box.height);
  }, LOCAL_ORIGIN);
  return true;
}

/** Does this text object hold no characters at all (`text.empty_removed`)? */
export function isEmptyText(doc: Y.Doc, id: string): boolean {
  const text = getTextContent(doc, id);
  // Only *no characters* is empty: a heading of spaces was typed on purpose, and
  // so is a line break. This is the rule the PRD spells out, in code.
  return text !== undefined && text.length === 0;
}

/**
 * Delete `id` if, and only if, it is a text object with nothing in it
 * (`text.empty_removed`): ending an edit must not leave an invisible object.
 * `false` when it has characters, when it is another type, or when it is gone —
 * someone else may have deleted it while this client was typing.
 */
export function deleteIfEmpty(doc: Y.Doc, id: string): boolean {
  if (!isEmptyText(doc, id)) return false;
  return deleteObjects(doc, [id]) === 1;
}
