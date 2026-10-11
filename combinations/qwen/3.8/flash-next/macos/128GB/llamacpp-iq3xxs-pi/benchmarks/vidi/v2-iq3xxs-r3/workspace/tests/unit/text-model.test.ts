/**
 * Story 9: free text anywhere on the board — the shared text model (task 1).
 *
 * A text object is one entry in the story 7 `objects` map with a `Y.Text` in it,
 * so selecting it, moving it, deleting it and undoing it (`sel.*`, `undo.*`) and
 * sharing it (`text.shared`) are the code those stories already wrote. What is
 * new is the size preset, the width mode, and the length limit — which story 2
 * invented for notes and which text objects share through `shared/text-edit.ts`
 * with their own 5,000-character setting.
 *
 * No measurer appears in this file: the design puts the fake one with the
 * client's layout tests (`text-layout.test.ts`), because the model never
 * measures anything — it only refuses to leave an object without a box.
 */

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import {
  STICKY_TYPE,
  TEXT_TYPE,
  allObjectIds,
  createSticky,
  isModelObjectType,
  objectSnapshots,
} from '../../src/shared/board-model.js';
import {
  DEFAULT_TEXT_SIZE,
  STICKY_TEXT_MAX_CHARS,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_CHARS,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../src/shared/config.js';
import type { TextSnapshot } from '../../src/shared/objects/text.js';
import {
  createText,
  deleteIfEmpty,
  getTextContent,
  getTextBox,
  getTextWidthMode,
  isEmptyText,
  isTextEntry,
  isTextSize,
  isTextSnapshot,
  setTextSize,
  setTextWidthFixed,
  setTextWidthMode,
  toggleTextWidthMode,
} from '../../src/shared/objects/text.js';
import { applyTextDiff, clampToLimit } from '../../src/shared/text-edit.js';
import { objectEntriesOf, readObjectEntry, seedText, textEntry } from './helpers/text.js';

describe('story 9 text model (text.model)', () => {
  // TC-01 — `createText` writes an object entry of type `text` with the fields
  // the rest of the story reads, on top of everything already there, and a box:
  // an object with no bounds could not be selected, moved or undone.
  it('TC-01: creates a top-most size M text with an empty Y.Text and a box', () => {
    const doc = new Y.Doc();
    const note = createSticky(doc, { x: 0, y: 0 });
    if (typeof note !== 'string') throw new Error('seed: non-finite point');

    const id = createText(doc, { x: 100, y: 50 }, 'g_test');
    expect(typeof id).toBe('string');
    if (typeof id !== 'string') return;

    const entry = readObjectEntry(doc, id);
    expect(entry.id).toBe(id);
    expect(entry.type).toBe(TEXT_TYPE);
    // A text is placed by its top-left, unlike a note, which is centred.
    expect(entry.x).toBe(100);
    expect(entry.y).toBe(50);
    expect(entry.size).toBe(DEFAULT_TEXT_SIZE);
    expect(entry.size).toBe('M');
    expect(entry.widthMode).toBe('auto');
    expect(entry.createdBy).toBe('g_test');
    expect(entry.createdAt).toBeTypeOf('number');
    // Stories 6 and 13-17 add `editedBy`/`editedAt`; this is where they extend it.
    expect(entry.editedBy).toBeUndefined();
    expect(entry.editedAt).toBeUndefined();

    // On top of every object that was already on the board.
    const topZ = Math.max(
      ...objectSnapshots(doc).filter((object) => object.id === note).map((object) => object.z),
    );
    const z = entry.z;
    expect(typeof z).toBe('number');
    expect(z as number).toBeGreaterThan(topZ);

    // The characters are a shared string, empty to begin with (`text.shared`).
    expect(getTextContent(doc, id)).toBeInstanceOf(Y.Text);
    expect(getTextContent(doc, id)?.toString()).toBe('');

    // A box from an estimate, so bounds exist before anyone has measured it.
    const box = getTextBox(doc, id);
    expect(box?.x).toBe(100);
    expect(box?.y).toBe(50);
    expect(box?.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(box?.height).toBe(TEXT_SIZES[DEFAULT_TEXT_SIZE] * TEXT_LINE_HEIGHT);

    // …and it is one of the types the board models, which is what makes story
    // 7's selection and story 8's undo apply to it with nothing changed there.
    expect(isModelObjectType(TEXT_TYPE)).toBe(true);
    expect(allObjectIds(objectSnapshots(doc))).toContain(id);
  });

  // TC-02 — a size preset is one of four, and one that is not is refused without
  // touching the document (an invalid pick costs nobody a sync message).
  it('TC-02: applies a size preset, and refuses one that does not exist', () => {
    const doc = new Y.Doc();
    const id = seedText(doc, { x: 0, y: 0, text: 'Went well' });

    expect(setTextSize(doc, id, 'XL')).toBe(true);
    expect(textEntry(doc, id).get('size')).toBe('XL');

    const updates = countUpdates(doc);
    expect(setTextSize(doc, id, 'XXL')).toBe(false);
    expect(isTextSize('XXL')).toBe(false);
    expect(textEntry(doc, id).get('size')).toBe('XL');
    expect(updates.count).toBe(0);
  });

  // TC-03 — a width below the minimum is raised to it, and the object stops
  // following its content (`text.fixed_width`, at the boundary).
  it('TC-03: clamps a fixed width to the minimum and marks it fixed', () => {
    expect(TEXT_MIN_WIDTH_WORLD).toBe(40);
    const doc = new Y.Doc();
    const id = seedText(doc, { x: 0, y: 0, text: 'Went well' });

    expect(setTextWidthFixed(doc, id, 30)).toBe(true);
    expect(getTextBox(doc, id)?.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(getTextWidthMode(doc, id)).toBe('fixed');

    // A width that is not a number is refused without a transaction, because a
    // box of nothing is not a box.
    const updates = countUpdates(doc);
    expect(setTextWidthFixed(doc, id, Number.NaN)).toBe(false);
    expect(updates.count).toBe(0);
    // And naming a width again is not a change.
    expect(setTextWidthFixed(doc, id, TEXT_MIN_WIDTH_WORLD)).toBe(false);
    expect(updates.count).toBe(0);
  });

  it('takes the height the new width wraps to along with it, in one write', () => {
    // The width drag: when this returns the text is fixed at that width and as
    // tall as the lines that width wraps to, out of one transaction, which is
    // one step on the undo stack rather than three.
    const doc = new Y.Doc();
    const id = seedText(doc, { x: 0, y: 0, text: 'Went well' });
    const updates = countUpdates(doc);

    expect(setTextWidthFixed(doc, id, 320, 78)).toBe(true);
    expect(updates.count).toBe(1);
    expect(readObjectEntry(doc, id)).toMatchObject({ width: 320, height: 78, widthMode: 'fixed' });

    expect(setTextWidthFixed(doc, id, 320, 78)).toBe(false);
    expect(updates.count).toBe(1);
  });

  // TC-04 — the empty rule, spelled out: only *no characters* is empty, so a
  // heading of spaces survives and a mistaken one does not.
  it('TC-04: treats no characters as empty, and spaces as text', () => {
    const doc = new Y.Doc();
    const empty = seedText(doc, { x: 0, y: 0, text: '' });
    const spaces = seedText(doc, { x: 0, y: 0, text: '   ' });

    expect(isEmptyText(doc, empty)).toBe(true);
    expect(isEmptyText(doc, spaces)).toBe(false);

    // A text with characters in it is left alone…
    expect(deleteIfEmpty(doc, spaces)).toBe(false);
    expect(allObjectIds(objectSnapshots(doc))).toContain(spaces);
    // …an empty one goes…
    expect(deleteIfEmpty(doc, empty)).toBe(true);
    expect(allObjectIds(objectSnapshots(doc))).toEqual([spaces]);
    // …and the id of a text that is already gone answers false, not a throw:
    // ending an edit someone else finished is not an error (`text.edit`).
    expect(deleteIfEmpty(doc, empty)).toBe(false);

    // A note is not a text, and is never deleted by this route.
    const note = createSticky(doc, { x: 0, y: 0 });
    if (typeof note !== 'string') throw new Error('seed: non-finite point');
    expect(isEmptyText(doc, note)).toBe(false);
    expect(deleteIfEmpty(doc, note)).toBe(false);
    expect(allObjectIds(objectSnapshots(doc))).toContain(note);
  });

  // TC-05 — the character limit is the story 2 rule with a bigger setting
  // pasted into it: the characters past 5,000 are not added, and one short of
  // the limit still takes one more (`text.limit`, both boundaries).
  it('TC-05: clamps a paste at 5,000 characters and accepts one short of it', () => {
    expect(TEXT_MAX_CHARS).toBe(5_000);
    expect(STICKY_TEXT_MAX_CHARS).toBe(1_000);

    const pasted = 'x'.repeat(TEXT_MAX_CHARS + 1);
    expect(clampToLimit(pasted, TEXT_MAX_CHARS)).toHaveLength(TEXT_MAX_CHARS);
    // A limit of one note's is untouched by a text object's: one setting each.
    expect(clampToLimit('y'.repeat(1_001), STICKY_TEXT_MAX_CHARS)).toHaveLength(1_000);

    const doc = new Y.Doc();
    const id = seedText(doc, { x: 0, y: 0, text: 'x'.repeat(TEXT_MAX_CHARS - 1) });
    const ytext = getTextContent(doc, id);
    if (!ytext) throw new Error('no text');
    // The last one fits.
    applyTextDiff(ytext, clampToLimit(`${'x'.repeat(TEXT_MAX_CHARS - 1)}y`, TEXT_MAX_CHARS), null);
    expect(ytext.length).toBe(TEXT_MAX_CHARS);
    // And the editor's rule — clamp the proposed text, then diff — is what keeps
    // it there: nothing past the limit is added to what is already typed.
    const atTheLimit = ytext.toString();
    applyTextDiff(ytext, clampToLimit(`${atTheLimit}zzz`, TEXT_MAX_CHARS), null);
    expect(ytext.length).toBe(TEXT_MAX_CHARS);
    expect(ytext.toString()).toBe(atTheLimit);
  });

  // TC-06 — a point that is not a point is refused without a transaction: an
  // object nobody can place is worse than no object at all.
  it('TC-06: refuses to create text at a point that is not finite', () => {
    const doc = new Y.Doc();
    const updates = countUpdates(doc);
    for (const at of [{ x: Number.NaN, y: 5 }, { x: 3, y: Number.POSITIVE_INFINITY }, { x: 1, y: '2' }]) {
      expect(createText(doc, at as { x: number; y: number }, 'g_test')).toBeNull();
    }
    expect(updates.count).toBe(0);
    expect(allObjectIds(objectSnapshots(doc))).toEqual([]);
  });

  it('refuses a stale id or another type, every setter, without an update', () => {
    const doc = new Y.Doc();
    const note = createSticky(doc, { x: 0, y: 0 });
    if (typeof note !== 'string') throw new Error('seed: non-finite point');
    const stale = '0123456789abcdef0123456789abcdef';
    const updates = countUpdates(doc);

    expect(setTextSize(doc, stale, 'L')).toBe(false);
    expect(setTextWidthFixed(doc, stale, 300)).toBe(false);
    expect(setTextWidthMode(doc, stale, 'fixed')).toBe(false);
    expect(toggleTextWidthMode(doc, stale)).toBeNull();
    expect(getTextWidthMode(doc, stale)).toBeNull();
    expect(getTextBox(doc, stale)).toBeNull();
    expect(getTextContent(doc, stale)).toBeUndefined();
    expect(setTextSize(doc, note, 'L')).toBe(false);
    expect(setTextWidthFixed(doc, note, 300)).toBe(false);
    expect(updates.count).toBe(0);

    // Flipping the width mode is the model's way back to following the content.
    const id = seedText(doc, { x: 0, y: 0, text: 'Went well' });
    expect(setTextWidthMode(doc, id, 'fixed')).toBe(true);
    expect(toggleTextWidthMode(doc, id)).toBe('auto');
    expect(getTextWidthMode(doc, id)).toBe('auto');
    expect(toggleTextWidthMode(doc, id)).toBe('fixed');
  });

  // Not a TC of its own: the model half of `text.concurrent`, and the reason a
  // text object is a `Y.Text` field rather than a string one.
  it('keeps both people’s characters when they type in the same text', () => {
    const a = new Y.Doc();
    const id = seedText(a, { x: 0, y: 0, text: '' });
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    const textA = getTextContent(a, id);
    const textB = getTextContent(b, id);
    if (!textA || !textB) throw new Error('no text on either side');
    // Neither insert is this client's doing on the other document, which is what
    // a websocket delivers; both are `null` origins there.
    a.transact(() => textA.insert(0, 'FromA'));
    b.transact(() => textB.insert(0, 'FromB'));
    sync(a, b);

    const merged = getTextContent(a, id)?.toString() ?? '';
    expect(merged).toBe(getTextContent(b, id)?.toString() ?? '');
    expect(characters(merged)).toBe(characters('FromAFromB'));
  });

  // Not a TC of its own: what the generic object snapshot does with a text
  // object's fields — keeps them, and keeps notes free of them (TC-06 of story
  // 7's `sel.all_types` rule: an entry nothing can draw is skipped).
  it('reads text fields through the generic object snapshot', () => {
    const doc = new Y.Doc();
    const note = createSticky(doc, { x: 0, y: 0 });
    if (typeof note !== 'string') throw new Error('seed: non-finite point');
    const id = seedText(doc, { x: 40, y: 50, text: 'Went well', size: 'L' });

    const objects = objectSnapshots(doc);
    expect(objects.map((object) => object.id).sort()).toEqual([id, note].sort());

    const text = objects.find((object) => object.id === id) as TextSnapshot | undefined;
    expect(text?.type).toBe(TEXT_TYPE);
    expect(text?.x).toBe(40);
    expect(text?.y).toBe(50);
    expect(text?.text).toBe('Went well');
    expect(text?.size).toBe('L');
    expect(text?.widthMode).toBe('auto');
    expect(text?.width).toBeTypeOf('number');
    expect(text?.height).toBeTypeOf('number');
    expect(text?.createdBy).toBeTypeOf('string');
    expect(isTextSnapshot(text!)).toBe(true);

    // A note's snapshot carries no text fields, so nothing can ask a note what
    // size preset it is — the `size` of a note is its type default.
    const sticky = objects.find((object) => object.id === note);
    expect(sticky?.type).toBe(STICKY_TYPE);
    expect(sticky).not.toHaveProperty('size');
    expect(sticky).not.toHaveProperty('widthMode');

    // A damaged text object keeps its box, so it can still be selected and
    // deleted, but it is not a text this build draws.
    textEntry(doc, id).set('size', 7);
    const damaged = objectSnapshots(doc).find((object) => object.id === id);
    if (!damaged) throw new Error(`no object ${id}`);
    expect(damaged.type).toBe(TEXT_TYPE);
    expect(isTextSnapshot(damaged)).toBe(false);
  });

  it('recognises a text entry, and only a text entry', () => {
    const doc = new Y.Doc();
    const id = seedText(doc, { x: 0, y: 0, text: 'hi' });
    const note = createSticky(doc, { x: 0, y: 0 });
    if (typeof note !== 'string') throw new Error('seed: non-finite point');
    const objects = objectEntriesOf(doc);
    expect(isTextEntry(objects.get(id))).toBe(true);
    expect(isTextEntry(objects.get(note))).toBe(false);
    expect(isTextEntry(undefined)).toBe(false);
    // A type this build has never met is skipped, not half-read.
    expect(isTextEntry(undefined)).toBe(false);
  });
});

/* --- helpers ------------------------------------------------------------- */

/** Counts the document's `update` events, so "no transaction" is assertable. */
function countUpdates(doc: Y.Doc): { count: number } {
  const seen = { count: 0 };
  doc.on('update', () => {
    seen.count += 1;
  });
  return seen;
}

/** The characters of `text` in sorted order: what a merge must agree on. */
function characters(text: string): string {
  return [...text].sort().join('');
}

/** Both directions, so either side may speak next. */
function sync(a: Y.Doc, b: Y.Doc): void {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
}
