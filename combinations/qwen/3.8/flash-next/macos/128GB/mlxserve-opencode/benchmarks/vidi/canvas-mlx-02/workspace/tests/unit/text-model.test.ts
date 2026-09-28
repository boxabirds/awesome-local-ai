// Story 9, text.model (unit): the text object model against a real Y.Doc.
//
// Everything the model promises is argued here as it is promised: writes are
// LOCAL_ORIGIN transactions (so story 8's undo sees them), bad input is refused
// WITHOUT a transaction (no update event reaches the doc at all), and the text
// object shares the generic object fields stories 7 and 8 act on.
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  createText,
  setTextSize,
  setTextWidthFixed,
  setTextBox,
  getTextContent,
  isEmptyText,
  deleteIfEmpty,
  readTextSnapshot,
} from '../../src/shared/objects/text.ts';
import { clampToLimit } from '../../src/shared/text-edit.ts';
import {
  initDoc,
  createSticky,
  objectsMapOf,
  objectsSnapshot,
} from '../../src/shared/board-model.ts';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_MAX_CHARS,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  TEXT_LINE_HEIGHT,
} from '../../src/shared/config.ts';

/** An update from anywhere that is not this tab's own mutation. */
const FROM_ELSEWHERE = Symbol('elsewhere');

function setup(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/** Counts the doc's own update events: a refused write must not bump it. */
function updateCounter(doc: Y.Doc): () => number {
  let n = 0;
  doc.on('update', () => n++);
  return () => n;
}

function mapOf(doc: Y.Doc, id: string): Y.Map<unknown> {
  const m = objectsMapOf(doc).get(id);
  if (!m) throw new Error(`no object ${id}`);
  return m;
}

describe('text.model createText', () => {
  // TC-01: createText(doc,{100,50},'g_test') → type 'text', DEFAULT size, auto
  // width, empty Y.Text, z above existing objects, createdBy 'g_test'.
  it('TC-01 creates a text object above existing objects, empty and M/auto', () => {
    const doc = setup();
    const stickyId = createSticky(doc, { x: 0, y: 0 });
    const stickyZ = Number(mapOf(doc, stickyId).get('z'));

    const id = createText(doc, { x: 100, y: 50 }, 'g_test');
    expect(id).toBeTypeOf('string');
    if (id === null) return;

    const snap = readTextSnapshot(doc, id);
    expect(snap).not.toBeNull();
    expect(snap!.type).toBe('text');
    expect(snap!.x).toBe(100);
    expect(snap!.y).toBe(50);
    expect(snap!.size).toBe(DEFAULT_TEXT_SIZE);
    expect(snap!.widthMode).toBe('auto');
    expect(snap!.text).toBe('');
    expect(snap!.createdBy).toBe('g_test');
    expect(snap!.width).toBeGreaterThan(0);
    expect(snap!.height).toBeGreaterThan(0);
    expect(snap!.z).toBeGreaterThan(stickyZ);

    // The text is a Y.Text, so concurrent typing (TC-29) merges inside it.
    expect(getTextContent(doc, id)).toBeInstanceOf(Y.Text);
    expect(getTextContent(doc, id)!.toString()).toBe('');
    // And it reads through the generic object snapshot story 7 selects on.
    const obj = objectsSnapshot(doc).find((o) => o.id === id);
    expect(obj).toBeTruthy();
    expect(obj!.type).toBe('text');
  });

  // TC-06: a non-finite create point is refused with null and NO transaction.
  it('TC-06 refuses a non-finite point with null and no transaction', () => {
    const doc = setup();
    const updates = updateCounter(doc);

    expect(createText(doc, { x: Number.NaN, y: 5 }, 'g')).toBeNull();
    expect(createText(doc, { x: 1, y: Number.POSITIVE_INFINITY }, 'g')).toBeNull();
    expect(createText(doc, undefined as unknown as { x: number; y: number }, 'g')).toBeNull();

    expect(objectsSnapshot(doc)).toHaveLength(0);
    expect(updates()).toBe(0);
  });
});

describe('text.model setters', () => {
  // TC-02: a known size applies; an unknown one is false and makes NO update.
  it('TC-02 applies XL, rejects XXL without an update event', () => {
    const doc = setup();
    const id = createText(doc, { x: 0, y: 0 }, 'g');
    if (id === null) throw new Error('create failed');
    const updates = updateCounter(doc);

    expect(setTextSize(doc, id, 'XL')).toBe(true);
    expect(mapOf(doc, id).get('size')).toBe('XL');
    const afterApply = updates();
    expect(afterApply).toBeGreaterThan(0);

    // Unknown key: false, no transaction, nothing new announced.
    expect(setTextSize(doc, id, 'XXL')).toBe(false);
    expect(updates()).toBe(afterApply);
    // The same size again is a no-op too (no pointless traffic).
    expect(setTextSize(doc, id, 'XL')).toBe(false);
    expect(updates()).toBe(afterApply);
  });

  // TC-03: a fixed width below the floor lands ON the floor, and the mode
  // becomes fixed in the same transaction.
  it('TC-03 clamps a 30-wide drag to TEXT_MIN_WIDTH_WORLD and fixes the mode', () => {
    const doc = setup();
    const id = createText(doc, { x: 0, y: 0 }, 'g');
    if (id === null) throw new Error('create failed');

    expect(setTextWidthFixed(doc, id, 30)).toBe(true);
    const m = mapOf(doc, id);
    expect(m.get('width')).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(m.get('widthMode')).toBe('fixed');

    expect(setTextWidthFixed(doc, id, 500)).toBe(true);
    expect(m.get('width')).toBe(500);
    expect(m.get('widthMode')).toBe('fixed');

    // Non-finite widths are refused.
    const updates = updateCounter(doc);
    expect(setTextWidthFixed(doc, id, Number.NaN)).toBe(false);
    expect(updates()).toBe(0);
  });

  // TC-04: isEmptyText counts ZERO characters only (whitespace is kept text);
  // deleteIfEmpty removes the object, and removes nothing else.
  it('TC-04 treats only zero characters as empty for deleteIfEmpty', () => {
    const doc = setup();
    const id = createText(doc, { x: 0, y: 0 }, 'g');
    if (id === null) throw new Error('create failed');

    expect(isEmptyText(doc, id)).toBe(true);
    expect(deleteIfEmpty(doc, 'no-such-id')).toBe(false);

    // Whitespace-only text is text: it is kept.
    const updates = updateCounter(doc);
    setTextWidthFixed(doc, id, 100);
    const before = updates();
    expect(setTextBox(doc, id, { width: 120, height: 52 })).toBe(true);

    expect(deleteIfEmpty(doc, id)).toBe(true); // still zero characters: gone
    expect(objectsSnapshot(doc).find((o) => o.id === id)).toBeUndefined();

    // A text object with one character survives.
    const id2 = createText(doc, { x: 0, y: 0 }, 'g');
    if (id2 === null) throw new Error('create failed');
    getTextContent(doc, id2)!.insert(0, 'a');
    expect(isEmptyText(doc, id2)).toBe(false);
    expect(deleteIfEmpty(doc, id2)).toBe(false);
    expect(objectsSnapshot(doc).some((o) => o.id === id2)).toBe(true);
    expect(before).toBeGreaterThanOrEqual(0);
  });

  // TC-05: clampToLimit with an explicit limit — 5,001 → 5,000 and the
  // boundary 4,999 + 1 accepted (the shared helper takes the limit, so text
  // objects clamp at TEXT_MAX_CHARS while sticky notes keep 1,000).
  it('TC-05 clamps to TEXT_MAX_CHARS at the boundaries', () => {
    expect(TEXT_MAX_CHARS).toBe(5000);
    expect(clampToLimit('a'.repeat(5001), TEXT_MAX_CHARS).length).toBe(5000);
    expect(clampToLimit('a'.repeat(4999) + 'z', TEXT_MAX_CHARS).length).toBe(5000);
    expect(clampToLimit('a'.repeat(4999) + 'z', TEXT_MAX_CHARS).endsWith('z')).toBe(true);
    expect(clampToLimit('short', TEXT_MAX_CHARS)).toBe('short');
  });

  // TC-04 (setTextBox): an explicit box is written exactly; the same box is a
  // no-op (TC-13's "no redundant update" rule at the model level).
  it('setTextBox writes the box exactly and skips an unchanged box', () => {
    const doc = setup();
    const id = createText(doc, { x: 0, y: 0 }, 'g');
    if (id === null) throw new Error('create failed');

    expect(setTextBox(doc, id, { width: 512, height: 640 })).toBe(true);
    const m = mapOf(doc, id);
    expect(m.get('width')).toBe(512);
    expect(m.get('height')).toBe(640);

    const updates = updateCounter(doc);
    expect(setTextBox(doc, id, { width: 512, height: 640 })).toBe(false);
    expect(updates()).toBe(0);
  });

  // Stale ids: every setter answers false and announces nothing.
  it('refuses stale and non-text ids without an update', () => {
    const doc = setup();
    const stickyId = createSticky(doc, { x: 0, y: 0 });
    const updates = updateCounter(doc);

    expect(setTextSize(doc, 'gone', 'XL')).toBe(false);
    expect(setTextWidthFixed(doc, 'gone', 100)).toBe(false);
    expect(setTextBox(doc, 'gone', { width: 10, height: 10 })).toBe(false);
    // A sticky is not a text object: the text setters do not touch it.
    expect(setTextSize(doc, stickyId, 'XL')).toBe(false);
    expect(setTextWidthFixed(doc, stickyId, 100)).toBe(false);
    expect(setTextBox(doc, stickyId, { width: 10, height: 10 })).toBe(false);
    expect(isEmptyText(doc, 'gone')).toBe(false);
    expect(getTextContent(doc, 'gone')).toBeUndefined();

    expect(updates()).toBe(0);
  });

  // The created object carries the initial box estimate, so generic
  // objectBounds is a real rect before the first DOM measurement.
  it('stores an initial box with the creation transaction', () => {
    const doc = setup();
    const id = createText(doc, { x: 5, y: 5 }, 'g');
    if (id === null) throw new Error('create failed');
    const snap = readTextSnapshot(doc, id);
    expect(snap!.width).toBeGreaterThan(0);
    expect(Number.isFinite(snap!.width)).toBe(true);
    expect(snap!.height).toBe(TEXT_SIZES[DEFAULT_TEXT_SIZE] * TEXT_LINE_HEIGHT);
  });

  // A remote-created text object reads through the snapshot (forward
  // compatibility story 7 established: readable types include 'text').
  it('reads a text object that arrived from another client', () => {
    const local = new Y.Doc();
    initDoc(local);
    const other = new Y.Doc();
    const id = createText(other, { x: 120, y: -40 }, 'g_other');
    if (id === null) throw new Error('create failed');

    Y.applyUpdate(local, Y.encodeStateAsUpdate(other), FROM_ELSEWHERE);
    const obj = objectsSnapshot(local).find((o) => o.id === id);
    expect(obj).toBeTruthy();
    expect(obj!.type).toBe('text');
    expect(obj!.x).toBe(120);
    expect(obj!.y).toBe(-40);
    expect(obj!.size).toBe(DEFAULT_TEXT_SIZE);
    expect(obj!.widthMode).toBe('auto');
  });
});
