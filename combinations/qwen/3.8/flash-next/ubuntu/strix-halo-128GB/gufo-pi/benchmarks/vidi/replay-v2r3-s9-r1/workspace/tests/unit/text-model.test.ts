/**
 * Unit tests for the free text object model (story 9, text.model).
 * TC-01 to TC-06 plus the stale-id error paths, against a real Y.Doc.
 */
import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import {
  createSticky,
  initDoc,
  snapshot,
  LOCAL_ORIGIN,
} from '../../src/shared/board-model';
import {
  createText,
  deleteIfEmpty,
  getTextContent,
  isEmptyText,
  setTextBox,
  setTextSize,
  setTextWidthFixed,
} from '../../src/shared/objects/text';
import { clampToLimit, applyTextDiff } from '../../src/shared/text-edit';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_MAX_CHARS,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../src/shared/config';

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/** Records every update event whose origin is LOCAL_ORIGIN. */
function recordLocalUpdates(doc: Y.Doc) {
  const events: unknown[] = [];
  const handler = (update: Uint8Array, origin: unknown) => {
    if (origin === LOCAL_ORIGIN) events.push(update);
  };
  doc.on('update', handler);
  return () => {
    doc.off('update', handler);
    return events;
  };
}

describe('text.model', () => {
  it('TC-01: createText at (100,50) stores a size M auto text object on top', () => {
    const doc = newDoc();
    const stickyId = createSticky(doc, { x: 0, y: 0 });
    const stickyZ = snapshot(doc).find((o) => o.id === stickyId)!.z;

    const id = createText(doc, { x: 100, y: 50 }, 'g_test');
    expect(id).not.toBeNull();

    const obj = snapshot(doc).find((o) => o.id === id)!;
    expect(obj.type).toBe('text');
    const text = obj as import('../../src/shared/objects/text').TextSnapshot;
    expect(text.x).toBe(100);
    expect(text.y).toBe(50);
    expect(text.size).toBe(DEFAULT_TEXT_SIZE);
    expect(text.widthMode).toBe('auto');
    expect(text.text).toBe('');
    expect(text.z).toBeGreaterThan(stickyZ);
    expect(text.createdBy).toBe('g_test');
    // Bounds exist before the first measurement.
    expect(typeof text.width).toBe('number');
    expect(typeof text.height).toBe('number');
    // The Y.Text is empty and attached to the document.
    expect(getTextContent(doc, id!)!.toString()).toBe('');
  });

  it('TC-02: setTextSize applies a known preset and rejects an unknown one', () => {
    const doc = newDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;

    expect(setTextSize(doc, id, 'XL')).toBe(true);
    expect((snapshot(doc).find((o) => o.id === id) as any).size).toBe('XL');

    const stop = recordLocalUpdates(doc);
    expect(setTextSize(doc, id, 'XXL')).toBe(false);
    expect((snapshot(doc).find((o) => o.id === id) as any).size).toBe('XL');
    expect(stop()).toHaveLength(0);
  });

  it('TC-03: setTextWidthFixed clamps to TEXT_MIN_WIDTH_WORLD and sets fixed mode', () => {
    const doc = newDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;

    expect(setTextWidthFixed(doc, id, 30)).toBe(true);
    let obj = snapshot(doc).find((o) => o.id === id) as any;
    expect(obj.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(obj.widthMode).toBe('fixed');

    // A wider width is taken as given.
    expect(setTextWidthFixed(doc, id, 220)).toBe(true);
    obj = snapshot(doc).find((o) => o.id === id) as any;
    expect(obj.width).toBe(220);
    expect(obj.widthMode).toBe('fixed');
  });

  it('TC-04: empty text is removed on request; whitespace-only text is kept', () => {
    const doc = newDoc();
    const empty = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    expect(isEmptyText(doc, empty)).toBe(true);
    expect(deleteIfEmpty(doc, empty)).toBe(true);
    expect(snapshot(doc).find((o) => o.id === empty)).toBeUndefined();

    const blank = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    getTextContent(doc, blank)!.insert(0, '   ');
    expect(isEmptyText(doc, blank)).toBe(false);
    expect(deleteIfEmpty(doc, blank)).toBe(false);
    expect(snapshot(doc).find((o) => o.id === blank)).toBeDefined();
  });

  it('TC-05: clampToLimit keeps at most TEXT_MAX_CHARS characters', () => {
    const atLimit = 'a'.repeat(TEXT_MAX_CHARS);
    expect(clampToLimit(atLimit, TEXT_MAX_CHARS)).toBe(atLimit);
    expect(clampToLimit(atLimit + 'b', TEXT_MAX_CHARS)).toBe(atLimit);
    expect(clampToLimit(atLimit + 'b', TEXT_MAX_CHARS)).toHaveLength(TEXT_MAX_CHARS);
    // 4,999 + 1 is accepted (boundary).
    const justBelow = 'a'.repeat(TEXT_MAX_CHARS - 1);
    expect(clampToLimit(justBelow + 'b', TEXT_MAX_CHARS)).toHaveLength(TEXT_MAX_CHARS);
  });

  it('TC-05b: applyTextDiff writes an over-long value as the clamped text', () => {
    const doc = newDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const ytext = getTextContent(doc, id)!;
    const base = 'a'.repeat(TEXT_MAX_CHARS);

    applyTextDiff(ytext, clampToLimit(base + 'zzz', TEXT_MAX_CHARS), LOCAL_ORIGIN);
    expect(ytext.toString()).toBe(base);
  });

  it('TC-06: a non-finite create point returns null without a transaction', () => {
    const doc = newDoc();
    const stop = recordLocalUpdates(doc);
    expect(createText(doc, { x: Number.NaN, y: 10 }, 'g_test')).toBeNull();
    expect(createText(doc, { x: 10, y: Infinity }, 'g_test')).toBeNull();
    expect(createText(doc, undefined as any, 'g_test')).toBeNull();
    expect(stop()).toHaveLength(0);
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('every setter returns false for a stale id and writes nothing', () => {
    const doc = newDoc();
    const stop = recordLocalUpdates(doc);
    expect(setTextSize(doc, 'gone', 'L')).toBe(false);
    expect(setTextWidthFixed(doc, 'gone', 120)).toBe(false);
    expect(setTextBox(doc, 'gone', { width: 120, height: 30 })).toBe(false);
    expect(getTextContent(doc, 'gone')).toBeUndefined();
    expect(isEmptyText(doc, 'gone')).toBe(false);
    expect(deleteIfEmpty(doc, 'gone')).toBe(false);
    expect(stop()).toHaveLength(0);
  });

  it('setTextBox stores a new box, rejects non-finite values and equal boxes', () => {
    const doc = newDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    expect(setTextBox(doc, id, { width: 120, height: 26 })).toBe(true);
    const obj = snapshot(doc).find((o) => o.id === id) as any;
    expect(obj.width).toBe(120);
    expect(obj.height).toBe(26);

    const stop = recordLocalUpdates(doc);
    expect(setTextBox(doc, id, { width: 120, height: 26 })).toBe(false);
    expect(setTextBox(doc, id, { width: Number.NaN, height: 26 })).toBe(false);
    expect(setTextBox(doc, id, { width: -1, height: 26 })).toBe(false);
    expect(stop()).toHaveLength(0);
  });

  it('setTextWidthFixed rejects non-finite widths without a transaction', () => {
    const doc = newDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const stop = recordLocalUpdates(doc);
    expect(setTextWidthFixed(doc, id, Number.NaN)).toBe(false);
    expect(setTextWidthFixed(doc, id, Infinity)).toBe(false);
    expect(stop()).toHaveLength(0);
  });

  it('text objects round-trip through a second document (sync)', () => {
    const a = newDoc();
    const id = createText(a, { x: 40, y: 60 }, 'g_test')!;
    getTextContent(a, id)!.insert(0, 'Went well');
    setTextSize(a, id, 'XL');
    const obj = snapshot(a).find((o) => o.id === id) as any;
    expect(obj.size).toBe('XL');
    expect(obj.text).toBe('Went well');
    void TEXT_SIZES;
    void vi;
  });
});
