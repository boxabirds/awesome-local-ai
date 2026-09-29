import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import {
  createText,
  setTextSize,
  setTextWidthFixed,
  setTextBox,
  getTextContent,
  isEmptyText,
  deleteIfEmpty,
  snapshotText,
} from '@shared/objects/text';
import { createSticky, getStickyText } from '@shared/board-model';
import {
  TEXT_MIN_WIDTH_WORLD,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MAX_CHARS,
  TEXT_SIZES,
  DEFAULT_TEXT_SIZE,
  TEXT_LINE_HEIGHT,
} from '@shared/config';
import { clampToLimit } from '@shared/text-edit';

describe('text model (text.model)', () => {
  let doc: Y.Doc;
  beforeEach(() => {
    doc = new Y.Doc();
  });

  it('TC-01: createText sets type text, size M, widthMode auto, empty Y.Text, z above existing, createdBy set', () => {
    // existing sticky to ensure z ordering across types
    const stickyId = createSticky(doc, { x: 10, y: 10 });
    expect(stickyId).not.toBe('');

    const id = createText(doc, { x: 100, y: 50 }, 'g_test');
    expect(id).not.toBeNull();

    const map = doc.getMap('objects').get(id!) as Y.Map<unknown>;
    expect(map.get('type')).toBe('text');
    expect(map.get('x')).toBe(100);
    expect(map.get('y')).toBe(50);
    expect(map.get('size')).toBe(DEFAULT_TEXT_SIZE);
    expect(map.get('widthMode')).toBe('auto');
    expect(map.get('createdBy')).toBe('g_test');
    const yt = map.get('text');
    expect(yt).toBeInstanceOf(Y.Text);
    expect((yt as Y.Text).length).toBe(0);

    // z above existing
    const sticky = doc.getMap('objects').get(stickyId) as Y.Map<unknown>;
    const sz = sticky.get('z') as number;
    const tz = map.get('z') as number;
    expect(tz).toBeGreaterThan(sz);
  });

  it('TC-02: setTextSize applies XL; unknown size key returns false and emits no update', () => {
    const id = createText(doc, { x: 0, y: 0 }, 'u')!;

    let updateCount = 0;
    doc.on('update', () => updateCount++);

    expect(setTextSize(doc, id, 'XL')).toBe(true);
    expect(updateCount).toBe(1);
    const map = doc.getMap('objects').get(id) as Y.Map<unknown>;
    expect(map.get('size')).toBe('XL');

    // Unknown key: false, no transaction
    const before = updateCount;
    expect(setTextSize(doc, id, 'XXL')).toBe(false);
    expect(updateCount).toBe(before);
  });

  it('TC-03: setTextWidthFixed(30) clamps to TEXT_MIN_WIDTH_WORLD and sets widthMode fixed', () => {
    const id = createText(doc, { x: 0, y: 0 }, 'u')!;
    expect(setTextWidthFixed(doc, id, 30)).toBe(true);
    const map = doc.getMap('objects').get(id) as Y.Map<unknown>;
    expect(map.get('width')).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(map.get('widthMode')).toBe('fixed');
  });

  it('TC-04: isEmptyText true for zero chars; deleteIfEmpty removes; whitespace-only kept', () => {
    const id = createText(doc, { x: 0, y: 0 }, 'u')!;
    expect(isEmptyText(doc, id)).toBe(true);
    expect(deleteIfEmpty(doc, id)).toBe(true);
    expect(doc.getMap('objects').has(id)).toBe(false);

    // whitespace-only is kept
    const id2 = createText(doc, { x: 0, y: 0 }, 'u')!;
    const yt = getTextContent(doc, id2)!;
    yt.insert(0, '   ');
    expect(isEmptyText(doc, id2)).toBe(false);
    expect(deleteIfEmpty(doc, id2)).toBe(false);
    expect(doc.getMap('objects').has(id2)).toBe(true);
  });

  it('TC-05: clampToLimit with TEXT_MAX_CHARS: 5001 -> 5000; 4999+1 accepted', () => {
    const long = 'a'.repeat(TEXT_MAX_CHARS + 1);
    expect(clampToLimit(long, TEXT_MAX_CHARS)).toHaveLength(TEXT_MAX_CHARS);
    const atLimit = 'a'.repeat(TEXT_MAX_CHARS);
    expect(clampToLimit(atLimit, TEXT_MAX_CHARS)).toHaveLength(TEXT_MAX_CHARS);
    const oneUnder = 'a'.repeat(TEXT_MAX_CHARS - 1);
    expect(clampToLimit(oneUnder, TEXT_MAX_CHARS)).toHaveLength(TEXT_MAX_CHARS - 1);
  });

  it('TC-06: non-finite create point returns null and emits no transaction', () => {
    let updateCount = 0;
    doc.on('update', () => updateCount++);
    expect(createText(doc, { x: NaN, y: 10 }, 'u')).toBeNull();
    expect(createText(doc, { x: 10, y: Infinity }, 'u')).toBeNull();
    expect(updateCount).toBe(0);
    expect(doc.getMap('objects').size).toBe(0);
  });

  it('stale id for every setter returns false and emits no update', () => {
    let updateCount = 0;
    doc.on('update', () => updateCount++);
    expect(setTextSize(doc, 'missing', 'XL')).toBe(false);
    expect(setTextWidthFixed(doc, 'missing', 100)).toBe(false);
    expect(setTextBox(doc, 'missing', { width: 100, height: 100 })).toBe(false);
    expect(updateCount).toBe(0);
  });

  it('setTextBox updates width and height; no-op when unchanged', () => {
    const id = createText(doc, { x: 0, y: 0 }, 'u')!;
    let updateCount = 0;
    doc.on('update', () => updateCount++);
    expect(setTextBox(doc, id, { width: 120, height: 30 })).toBe(true);
    expect(updateCount).toBe(1);
    // unchanged -> false, no update
    expect(setTextBox(doc, id, { width: 120, height: 30 })).toBe(false);
    expect(updateCount).toBe(1);
  });
});
