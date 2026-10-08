// Story 9 unit tests: the text object model (TC-01 to TC-06).
//
// A real Y.Doc is used throughout: the schema rules, validation and error
// paths of text.model are contract, and they must hold against the store,
// not against a mock.

import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  createText,
  deleteIfEmpty,
  getTextContent,
  isEmptyText,
  setTextBox,
  setTextSize,
  setTextWidthFixed,
} from '../../src/shared/objects/text';
import { clampToLimit } from '../../src/shared/text-edit';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_INITIAL_HEIGHT_WORLD,
  TEXT_INITIAL_WIDTH_WORLD,
  TEXT_MAX_CHARS,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
} from '../../src/shared/config';
import {
  createSticky,
  objects,
  objectsSnapshot,
  registerKnownObjectType,
  type ObjectSnapshot,
} from '../../src/shared/board-model';

// The client registry normally registers the type; unit tests use the model
// directly, so register it here (the snapshot contract: unknown types are
// hidden).
registerKnownObjectType('text');

function textSnapshots(doc: Y.Doc): ObjectSnapshot[] {
  return objectsSnapshot(doc).filter((o) => o.type === 'text');
}

describe('text model (unit)', () => {
  it('TC-01: createText makes a size-M auto text at the point, on top, with createdBy', () => {
    const doc = new Y.Doc();
    // An existing sticky so "z above all objects" is a real claim.
    createSticky(doc, { x: 0, y: 0 });
    const stickyZ = objectsSnapshot(doc)[0]!.z;

    const id = createText(doc, { x: 100, y: 50 }, 'g_test');
    expect(id).not.toBeNull();

    const obj = objects(doc).get(id!)!;
    expect(obj.get('type')).toBe('text');
    expect(obj.get('x')).toBe(100); // top-left at the point (not centred)
    expect(obj.get('y')).toBe(50);
    expect(obj.get('size')).toBe(DEFAULT_TEXT_SIZE);
    expect(obj.get('widthMode')).toBe('auto');
    expect(obj.get('createdBy')).toBe('g_test');
    const text = obj.get('text');
    expect(text).toBeInstanceOf(Y.Text);
    expect((text as Y.Text).toString()).toBe('');
    expect(typeof obj.get('createdAt')).toBe('number');
    // On top of everything that existed before.
    expect(obj.get('z')).toBeGreaterThan(stickyZ);
    // Bounds exist before the first measurement (the initial estimate).
    expect(obj.get('width')).toBe(TEXT_INITIAL_WIDTH_WORLD);
    expect(obj.get('height')).toBe(TEXT_INITIAL_HEIGHT_WORLD);

    const snap = textSnapshots(doc);
    expect(snap).toHaveLength(1);
    expect(snap[0]!.size).toBe(DEFAULT_TEXT_SIZE);
    expect(snap[0]!.widthMode).toBe('auto');
    expect(snap[0]!.text).toBe('');
  });

  it('TC-02: setTextSize applies a known preset; an unknown key is a no-op without an update', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'g')!;
    const obj = objects(doc).get(id)!;

    let updates = 0;
    obj.observe(() => {
      updates += 1;
    });

    expect(setTextSize(doc, id, 'XL')).toBe(true);
    expect(obj.get('size')).toBe('XL');
    expect(updates).toBe(1);

    // Error path: unknown key → false and zero further updates.
    expect(setTextSize(doc, id, 'XXL')).toBe(false);
    expect(obj.get('size')).toBe('XL');
    expect(updates).toBe(1);

    // A stale id is a no-op as well.
    expect(setTextSize(doc, 'nope', 'S')).toBe(false);
  });

  it('TC-03: setTextWidthFixed clamps to the minimum and marks the object fixed', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'g')!;
    const obj = objects(doc).get(id)!;

    // Below the minimum: clamped up to TEXT_MIN_WIDTH_WORLD.
    expect(setTextWidthFixed(doc, id, 30)).toBe(true);
    expect(obj.get('width')).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(obj.get('widthMode')).toBe('fixed');

    // A larger value: applied.
    expect(setTextWidthFixed(doc, id, 120)).toBe(true);
    expect(obj.get('width')).toBe(120);

    // The current fixed width: false, no transaction.
    expect(setTextWidthFixed(doc, id, TEXT_MIN_WIDTH_WORLD)).toBe(true);
    expect(obj.get('width')).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(setTextWidthFixed(doc, id, TEXT_MIN_WIDTH_WORLD)).toBe(false);

    // Non-finite: false, no update.
    expect(setTextWidthFixed(doc, id, Number.NaN)).toBe(false);
    expect(obj.get('width')).toBe(TEXT_MIN_WIDTH_WORLD);

    // Stale id: false.
    expect(setTextWidthFixed(doc, 'nope', 100)).toBe(false);
  });

  it('TC-04: only zero characters is empty; deleteIfEmpty removes the empty, keeps the whitespace', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'g')!;
    const text = getTextContent(doc, id)!;

    // A fresh object has zero characters: empty.
    expect(isEmptyText(doc, id)).toBe(true);
    expect(deleteIfEmpty(doc, id)).toBe(true);
    expect(objects(doc).get(id)).toBeUndefined();

    // Whitespace-only text is NOT empty and is kept.
    const id2 = createText(doc, { x: 0, y: 0 }, 'g')!;
    const text2 = getTextContent(doc, id2)!;
    text2.insert(0, '   ');
    expect(isEmptyText(doc, id2)).toBe(false);
    expect(deleteIfEmpty(doc, id2)).toBe(false);
    expect(objects(doc).get(id2)).toBeDefined();

    // A stale id is not "empty".
    expect(isEmptyText(doc, 'nope')).toBe(false);
    expect(deleteIfEmpty(doc, 'nope')).toBe(false);
  });

  it('TC-05: clampToLimit keeps exactly TEXT_MAX_CHARS characters (boundaries)', () => {
    // 5,001 → 5,000 (one beyond the limit is dropped).
    expect(clampToLimit('x'.repeat(TEXT_MAX_CHARS + 1), TEXT_MAX_CHARS)).toHaveLength(
      TEXT_MAX_CHARS,
    );
    // 4,999 + 1 accepted: at the limit nothing is dropped.
    expect(clampToLimit('x'.repeat(TEXT_MAX_CHARS - 1), TEXT_MAX_CHARS)).toHaveLength(
      TEXT_MAX_CHARS - 1,
    );
    expect(clampToLimit('x'.repeat(TEXT_MAX_CHARS), TEXT_MAX_CHARS)).toHaveLength(
      TEXT_MAX_CHARS,
    );
    // Shorter text is untouched.
    expect(clampToLimit('hi', TEXT_MAX_CHARS)).toBe('hi');
  });

  it('TC-06: a non-finite create point returns null and opens no transaction', () => {
    const doc = new Y.Doc();
    expect(createText(doc, { x: Number.NaN, y: 0 }, 'g')).toBeNull();
    expect(createText(doc, { x: 0, y: Number.POSITIVE_INFINITY }, 'g')).toBeNull();
    expect(objects(doc).size).toBe(0);
  });

  it('setTextBox writes a changed box and rejects stale ids and unchanged boxes', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'g')!;
    const obj = objects(doc).get(id)!;

    expect(setTextBox(doc, id, { width: 120, height: 52 })).toBe(true);
    expect(obj.get('width')).toBe(120);
    expect(obj.get('height')).toBe(52);

    // Unchanged: false, no transaction.
    expect(setTextBox(doc, id, { width: 120, height: 52 })).toBe(false);

    // Non-finite: false.
    expect(setTextBox(doc, id, { width: Number.NaN, height: 10 })).toBe(false);
    expect(obj.get('width')).toBe(120);

    // Stale id: false.
    expect(setTextBox(doc, 'nope', { width: 10, height: 10 })).toBe(false);
  });
});
