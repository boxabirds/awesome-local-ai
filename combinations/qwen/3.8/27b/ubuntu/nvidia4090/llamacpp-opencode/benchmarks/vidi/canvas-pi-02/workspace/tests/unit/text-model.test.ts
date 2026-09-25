/**
 * Unit tests for the free text model (story 9, TC-01 to TC-06).
 *
 * Uses a real Y.Doc; no DOM required.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { LOCAL_ORIGIN, initDoc } from '../../src/shared/board-model';
import {
  createText,
  setTextSize,
  setTextWidthFixed,
  setTextBox,
  getTextContent,
  getTextYText,
  isEmptyText,
  deleteIfEmpty,
  snapshotText,
  getSessionId,
} from '../../src/shared/objects/text';
import { clampToLimit } from '../../src/shared/text-edit';
import { TEXT_MIN_WIDTH_WORLD, TEXT_MAX_CHARS, TEXT_SIZES } from '../../src/shared/config';

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

describe('text.model (story 9)', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = makeDoc();
  });

  // TC-01: createText creates a text with the correct shape.
  it('TC-01 createText: type, size M, auto mode, empty content, z top, createdBy', () => {
    const id = createText(doc, LOCAL_ORIGIN, { x: 100, y: 50 }, 'M');
    expect(id).not.toBe('');
    const snap = snapshotText(doc, id)!;
    expect(snap.id).toBe(id);
    expect(snap.x).toBe(100);
    expect(snap.y).toBe(50);
    expect(snap.size).toBe('M');
    expect(snap.widthMode).toBe('auto');
    expect(snap.content).toBe('');
    expect(snap.createdBy).toBe(getSessionId());
    expect(snap.w).toBe(0);
    expect(snap.h).toBe(0);
  });

  // TC-02: setTextSize changes the size; unknown size → false.
  it('TC-02 setTextSize: XL works, unknown size rejected', () => {
    const id = createText(doc, LOCAL_ORIGIN, { x: 0, y: 0 }, 'M');
    expect(setTextSize(doc, LOCAL_ORIGIN, id, 'XL')).toBe(true);
    expect(snapshotText(doc, id)!.size).toBe('XL');
    // No-op when the size is unchanged.
    expect(setTextSize(doc, LOCAL_ORIGIN, id, 'XL')).toBe(false);
    // Unknown size key.
    expect(setTextSize(doc, LOCAL_ORIGIN, id, 'XXL' as any)).toBe(false);
    expect(snapshotText(doc, id)!.size).toBe('XL');
  });

  // TC-03: setTextWidthFixed clamps to TEXT_MIN_WIDTH_WORLD.
  it('TC-03 setTextWidthFixed: width 30 clamped to min, mode fixed', () => {
    const id = createText(doc, LOCAL_ORIGIN, { x: 0, y: 0 }, 'M');
    expect(setTextWidthFixed(doc, LOCAL_ORIGIN, id, 30, 10)).toBe(true);
    const snap = snapshotText(doc, id)!;
    expect(snap.widthMode).toBe('fixed');
    expect(snap.w).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(snap.x).toBe(10);
    // A width above the min is kept as-is.
    expect(setTextWidthFixed(doc, LOCAL_ORIGIN, id, 200, 5)).toBe(true);
    expect(snapshotText(doc, id)!.w).toBe(200);
    expect(snapshotText(doc, id)!.x).toBe(5);
  });

  // TC-04: isEmptyText and deleteIfEmpty.
  it('TC-04 isEmptyText: empty → true, whitespace → false; deleteIfEmpty removes empty', () => {
    const id = createText(doc, LOCAL_ORIGIN, { x: 0, y: 0 }, 'M');
    expect(isEmptyText(doc, id)).toBe(true);
    expect(deleteIfEmpty(doc, LOCAL_ORIGIN, id)).toBe(true);
    // The object is gone.
    expect(snapshotText(doc, id)).toBeUndefined();

    // Whitespace-only is NOT empty.
    const id2 = createText(doc, LOCAL_ORIGIN, { x: 0, y: 0 }, 'M');
    const ytext = getTextYText(doc, id2)!;
    ytext.insert(0, '  ');
    expect(isEmptyText(doc, id2)).toBe(false);
    expect(deleteIfEmpty(doc, LOCAL_ORIGIN, id2)).toBe(false);
    expect(snapshotText(doc, id2)).toBeDefined();
  });

  // TC-05: clampToLimit boundaries.
  it('TC-05 clampToLimit: 5001 → 5000, 5000 accepted, 4999 + 1 accepted', () => {
    const over = 'a'.repeat(TEXT_MAX_CHARS + 1);
    expect(clampToLimit(over, TEXT_MAX_CHARS).length).toBe(TEXT_MAX_CHARS);
    const at = 'a'.repeat(TEXT_MAX_CHARS);
    expect(clampToLimit(at, TEXT_MAX_CHARS)).toBe(at);
    const under = 'a'.repeat(TEXT_MAX_CHARS - 1);
    expect(clampToLimit(under + 'b', TEXT_MAX_CHARS)).toBe(under + 'b');
  });

  // TC-06: non-finite point → '' (no transaction).
  it('TC-06 createText: non-finite point returns empty string', () => {
    expect(createText(doc, LOCAL_ORIGIN, { x: NaN, y: 0 }, 'M')).toBe('');
    expect(createText(doc, LOCAL_ORIGIN, { x: 0, y: Infinity }, 'M')).toBe('');
    // No object was created.
    expect(doc.getMap('objects').size).toBe(0);
  });

  // setTextBox: no-op when unchanged.
  it('setTextBox: no-op when the box is unchanged', () => {
    const id = createText(doc, LOCAL_ORIGIN, { x: 0, y: 0 }, 'M');
    setTextBox(doc, LOCAL_ORIGIN, id, { x: 0, y: 0, width: 100, height: 50 });
    expect(snapshotText(doc, id)!.w).toBe(100);
    expect(snapshotText(doc, id)!.h).toBe(50);
    // Same box again → no-op.
    expect(setTextBox(doc, LOCAL_ORIGIN, id, { x: 0, y: 0, width: 100, height: 50 })).toBe(false);
    // Different box → true.
    expect(setTextBox(doc, LOCAL_ORIGIN, id, { x: 10, y: 0, width: 100, height: 50 })).toBe(true);
    expect(snapshotText(doc, id)!.x).toBe(10);
  });

  // Stale id: all mutations return false.
  it('stale id: all mutations return false', () => {
    expect(setTextSize(doc, LOCAL_ORIGIN, 'no-such-id', 'S')).toBe(false);
    expect(setTextWidthFixed(doc, LOCAL_ORIGIN, 'no-such-id', 100, 0)).toBe(false);
    expect(setTextBox(doc, LOCAL_ORIGIN, 'no-such-id', { x: 0, y: 0, width: 10, height: 10 })).toBe(false);
    expect(deleteIfEmpty(doc, LOCAL_ORIGIN, 'no-such-id')).toBe(false);
    expect(getTextContent(doc, 'no-such-id')).toBe('');
    expect(getTextYText(doc, 'no-such-id')).toBeUndefined();
    expect(isEmptyText(doc, 'no-such-id')).toBe(false);
  });
});
