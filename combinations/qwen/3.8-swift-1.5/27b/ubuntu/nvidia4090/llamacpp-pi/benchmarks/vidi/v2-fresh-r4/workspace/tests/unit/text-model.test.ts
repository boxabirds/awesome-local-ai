import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { initDoc, createSticky, snapshot, deleteObjects } from '../../src/shared/board-model';
import { clampToLimit, applyTextDiff } from '../../src/shared/text-edit';
import {
  createText,
  setTextSize,
  setTextWidthFixed,
  setTextBox,
  getTextContent,
  isEmptyText,
  deleteIfEmpty,
} from '../../src/shared/objects/text';
import {
  TEXT_MIN_WIDTH_WORLD,
  TEXT_MAX_CHARS,
  DEFAULT_TEXT_SIZE,
} from '../../src/shared/config';

/** Count update events on the objects map (to assert "no transaction"). */
function countUpdates(doc: Y.Doc): () => number {
  let count = 0;
  const objects = doc.getMap('objects');
  // Any nested change on the objects map fires this callback. This yjs
  // version's observe() returns no unsubscribe; use unobserve with the
  // same reference.
  const handler = () => {
    count++;
  };
  objects.observe(handler);
  return () => {
    objects.unobserve(handler);
    return count;
  };
}

describe('text model (story 9)', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
  });

  // TC-01
  it('TC-01: createText creates a size-M auto-width text at the point, z on top, createdBy set', () => {
    // Existing object so z ordering is observable
    createSticky(doc, { x: 0, y: 0 });
    const id = createText(doc, { x: 100, y: 50 }, 'g_test')!;
    expect(id).toBeTruthy();

    const snaps = snapshot(doc);
    const text = snaps.find((s) => s.id === id);
    expect(text).toBeDefined();
    expect(text!.type).toBe('text');
    expect(text!.x).toBe(100);
    expect(text!.y).toBe(50);
    expect(text!.z).toBeGreaterThan(snaps.find((s) => s.type === 'sticky')!.z);

    const obj = doc.getMap('objects').get(id) as Y.Map<unknown>;
    expect(obj.get('size')).toBe(DEFAULT_TEXT_SIZE);
    expect(obj.get('widthMode')).toBe('auto');
    expect(obj.get('createdBy')).toBe('g_test');
    const ytext = obj.get('text') as Y.Text;
    expect(ytext).toBeInstanceOf(Y.Text);
    expect(ytext.toString()).toBe('');
    // A box exists before the first measure
    expect(typeof obj.get('width')).toBe('number');
    expect(typeof obj.get('height')).toBe('number');
  });

  // TC-02
  it('TC-02: setTextSize XL applied; unknown size rejected with no update', () => {
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    expect(setTextSize(doc, id, 'XL')).toBe(true);
    const obj = doc.getMap('objects').get(id) as Y.Map<unknown>;
    expect(obj.get('size')).toBe('XL');

    const stop = countUpdates(doc);
    expect(setTextSize(doc, id, 'XXL')).toBe(false);
    expect(stop()).toBe(0);
    expect(obj.get('size')).toBe('XL');
  });

  // TC-03
  it('TC-03: setTextWidthFixed clamps to TEXT_MIN_WIDTH_WORLD and sets widthMode fixed', () => {
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    expect(setTextWidthFixed(doc, id, 30)).toBe(true);
    const obj = doc.getMap('objects').get(id) as Y.Map<unknown>;
    expect(obj.get('width')).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(obj.get('widthMode')).toBe('fixed');

    // A width above the minimum is applied as-is
    expect(setTextWidthFixed(doc, id, 120)).toBe(true);
    expect(obj.get('width')).toBe(120);
  });

  // TC-04
  it('TC-04: isEmptyText true only for zero characters; deleteIfEmpty removes, whitespace kept', () => {
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    expect(isEmptyText(doc, id)).toBe(true);
    expect(deleteIfEmpty(doc, id)).toBe(true);
    expect(doc.getMap('objects').has(id)).toBe(false);

    // Whitespace-only is NOT empty (only zero characters counts)
    const id2 = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    getTextContent(doc, id2)!.insert(0, '  ');
    expect(isEmptyText(doc, id2)).toBe(false);
    expect(deleteIfEmpty(doc, id2)).toBe(false);
    expect(doc.getMap('objects').has(id2)).toBe(true);

    // Stale id
    expect(deleteIfEmpty(doc, 'nope')).toBe(false);
  });

  // TC-05
  it('TC-05: clampToLimit at TEXT_MAX_CHARS boundaries', () => {
    expect(clampToLimit('a'.repeat(TEXT_MAX_CHARS + 1), TEXT_MAX_CHARS).length).toBe(TEXT_MAX_CHARS);
    expect(clampToLimit('a'.repeat(TEXT_MAX_CHARS - 1) + 'b', TEXT_MAX_CHARS).length).toBe(TEXT_MAX_CHARS);
    expect(clampToLimit('short', TEXT_MAX_CHARS)).toBe('short');

    // The editor path: 4,999 chars + 1 accepted, 5,001 truncated
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const ytext = getTextContent(doc, id)!;
    applyTextDiff(ytext, 'a'.repeat(TEXT_MAX_CHARS - 1), 'local');
    applyTextDiff(ytext, 'a'.repeat(TEXT_MAX_CHARS), 'local');
    expect(ytext.length).toBe(TEXT_MAX_CHARS);
    applyTextDiff(ytext, clampToLimit('a'.repeat(TEXT_MAX_CHARS + 1), TEXT_MAX_CHARS), 'local');
    expect(ytext.length).toBe(TEXT_MAX_CHARS);
  });

  // TC-06
  it('TC-06: non-finite create point → null, no transaction', () => {
    const stop = countUpdates(doc);
    expect(createText(doc, { x: NaN, y: 50 }, 'g_test')).toBeNull();
    expect(createText(doc, { x: 100, y: Infinity }, 'g_test')).toBeNull();
    expect(stop()).toBe(0);
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('stale id for every setter → false, no update', () => {
    const stop = countUpdates(doc);
    expect(setTextSize(doc, 'stale', 'XL')).toBe(false);
    expect(setTextWidthFixed(doc, 'stale', 100)).toBe(false);
    expect(setTextBox(doc, 'stale', { width: 100, height: 50 })).toBe(false);
    expect(stop()).toBe(0);
  });

  it('setTextBox applies finite boxes; non-finite rejected', () => {
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    expect(setTextBox(doc, id, { width: 123.5, height: 67 })).toBe(true);
    const obj = doc.getMap('objects').get(id) as Y.Map<unknown>;
    expect(obj.get('width')).toBe(123.5);
    expect(obj.get('height')).toBe(67);

    const stop = countUpdates(doc);
    expect(setTextBox(doc, id, { width: NaN, height: 67 })).toBe(false);
    expect(stop()).toBe(0);
  });

  it('setTextWidthFixed rejects non-finite width', () => {
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const stop = countUpdates(doc);
    expect(setTextWidthFixed(doc, id, NaN)).toBe(false);
    expect(setTextWidthFixed(doc, id, Infinity)).toBe(false);
    expect(stop()).toBe(0);
  });

  it('deleteIfEmpty on a text with content → false, object kept', () => {
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    getTextContent(doc, id)!.insert(0, 'hello');
    expect(deleteIfEmpty(doc, id)).toBe(false);
    expect(doc.getMap('objects').has(id)).toBe(true);

    // deleteObjects (story 7) still removes text objects
    expect(deleteObjects(doc, [id])).toBe(1);
  });
});
