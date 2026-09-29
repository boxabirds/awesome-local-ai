// text.model (TC-01 to TC-06): the text object schema against a real Y.Doc.
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  LOCAL_ORIGIN,
  createSticky,
  initDoc,
  objectsSnapshot,
} from '../../src/shared/board-model';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_MAX_CHARS,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../src/shared/config';
import {
  type TextSnapshot,
  createText,
  deleteIfEmpty,
  getTextContent,
  isEmptyText,
  setTextBox,
  setTextSize,
  setTextWidthFixed,
} from '../../src/shared/objects/text';
import { applyTextDiff, clampToLimit } from '../../src/shared/text-edit';
import { clampToLimit as stickyClamp } from '../../src/client/objects/StickyText';

function freshDoc() {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/** Counts transactions on the doc from now on. */
function countUpdates(doc: Y.Doc) {
  const counter = { n: 0 };
  doc.on('update', () => counter.n++);
  return counter;
}

const textOf = (doc: Y.Doc, id: string) =>
  objectsSnapshot(doc).find((o) => o.id === id) as TextSnapshot | undefined;
const rawOf = (doc: Y.Doc, id: string) => doc.getMap('objects').get(id) as Y.Map<unknown>;

describe('text.model createText', () => {
  it('TC-01 creates an empty size M auto-width text at the point, above existing objects', () => {
    const doc = freshDoc();
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 500, y: 0 });
    const origins: unknown[] = [];
    doc.on('afterTransaction', (tr: Y.Transaction) => origins.push(tr.origin));
    const id = createText(doc, { x: 100, y: 50 }, 'g_test')!;
    expect(id).toEqual(expect.any(String));
    const text = textOf(doc, id)!;
    expect(text).toMatchObject({
      type: 'text',
      x: 100,
      y: 50,
      size: DEFAULT_TEXT_SIZE,
      widthMode: 'auto',
      text: '',
      z: 3,
    });
    expect(DEFAULT_TEXT_SIZE).toBe('M');
    expect(text.width).toBeGreaterThan(0);
    expect(text.height).toBeGreaterThan(0);
    expect(getTextContent(doc, id)).toBeInstanceOf(Y.Text);
    expect(getTextContent(doc, id)!.length).toBe(0);
    expect(rawOf(doc, id).get('createdBy')).toBe('g_test');
    expect(typeof rawOf(doc, id).get('createdAt')).toBe('number');
    expect(origins).toEqual([LOCAL_ORIGIN]);
  });

  it('TC-06 a non-finite point creates nothing and runs no transaction', () => {
    const doc = freshDoc();
    const updates = countUpdates(doc);
    expect(createText(doc, { x: Number.NaN, y: 0 }, 'g_test')).toBeNull();
    expect(createText(doc, { x: 0, y: Number.POSITIVE_INFINITY }, 'g_test')).toBeNull();
    expect(updates.n).toBe(0);
    expect(objectsSnapshot(doc)).toHaveLength(0);
  });
});

describe('text.model setters', () => {
  it('TC-02 setTextSize applies XL; an unknown key is rejected without an update', () => {
    const doc = freshDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    expect(setTextSize(doc, id, 'XL')).toBe(true);
    expect(textOf(doc, id)!.size).toBe('XL');
    expect(textOf(doc, id)).toMatchObject({ x: 0, y: 0 });
    const updates = countUpdates(doc);
    expect(setTextSize(doc, id, 'XXL')).toBe(false);
    expect(setTextSize(doc, id, 'XL')).toBe(false);
    expect(updates.n).toBe(0);
    expect(textOf(doc, id)!.size).toBe('XL');
    expect(Object.keys(TEXT_SIZES)).toEqual(['S', 'M', 'L', 'XL']);
  });

  it('TC-03 setTextWidthFixed clamps to TEXT_MIN_WIDTH_WORLD and switches to fixed', () => {
    const doc = freshDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    expect(setTextWidthFixed(doc, id, 30)).toBe(true);
    expect(textOf(doc, id)).toMatchObject({ width: TEXT_MIN_WIDTH_WORLD, widthMode: 'fixed' });
    expect(setTextWidthFixed(doc, id, TEXT_MIN_WIDTH_WORLD)).toBe(false);
    expect(setTextWidthFixed(doc, id, 250)).toBe(true);
    expect(textOf(doc, id)!.width).toBe(250);
    expect(setTextWidthFixed(doc, id, Number.NaN)).toBe(false);
  });

  it('setTextBox writes the measured box once; unchanged or invalid boxes are rejected', () => {
    const doc = freshDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    expect(setTextBox(doc, id, { width: 92, height: 26 })).toBe(true);
    expect(textOf(doc, id)).toMatchObject({ width: 92, height: 26 });
    const updates = countUpdates(doc);
    expect(setTextBox(doc, id, { width: 92, height: 26 })).toBe(false);
    expect(setTextBox(doc, id, { width: 0, height: 26 })).toBe(false);
    expect(setTextBox(doc, id, { width: 92, height: Number.NaN })).toBe(false);
    expect(updates.n).toBe(0);
  });

  it('every setter rejects a stale id and a non-text object without an update', () => {
    const doc = freshDoc();
    const sticky = createSticky(doc, { x: 0, y: 0 }) as string;
    const updates = countUpdates(doc);
    for (const id of ['missing', sticky]) {
      expect(setTextSize(doc, id, 'L')).toBe(false);
      expect(setTextWidthFixed(doc, id, 100)).toBe(false);
      expect(setTextBox(doc, id, { width: 100, height: 20 })).toBe(false);
      expect(getTextContent(doc, id)).toBeUndefined();
      expect(isEmptyText(doc, id)).toBe(false);
      expect(deleteIfEmpty(doc, id)).toBe(false);
    }
    expect(updates.n).toBe(0);
  });
});

describe('text.model empty text', () => {
  it('TC-04 zero characters is empty and removed; whitespace-only text is kept', () => {
    const doc = freshDoc();
    const empty = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const spaces = createText(doc, { x: 0, y: 100 }, 'g_test')!;
    getTextContent(doc, spaces)!.insert(0, '  ');
    expect(isEmptyText(doc, empty)).toBe(true);
    expect(isEmptyText(doc, spaces)).toBe(false);
    expect(deleteIfEmpty(doc, empty)).toBe(true);
    expect(deleteIfEmpty(doc, spaces)).toBe(false);
    expect(objectsSnapshot(doc).map((o) => o.id)).toEqual([spaces]);
  });
});

describe('text.model text-edit helpers', () => {
  it('TC-05 clampToLimit keeps TEXT_MAX_CHARS characters; 4,999 + 1 is accepted', () => {
    expect(TEXT_MAX_CHARS).toBe(5000);
    expect(clampToLimit('a'.repeat(5001), TEXT_MAX_CHARS)).toHaveLength(5000);
    expect(clampToLimit(`${'a'.repeat(4999)}b`, TEXT_MAX_CHARS)).toBe(`${'a'.repeat(4999)}b`);
    // Story 2 callers keep the sticky limit by default.
    expect(stickyClamp('a'.repeat(1001))).toHaveLength(1000);
  });

  it('applyTextDiff writes a minimal diff into a text object', () => {
    const doc = freshDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const ytext = getTextContent(doc, id)!;
    applyTextDiff(ytext, 'Went well', LOCAL_ORIGIN);
    const deltas: unknown[] = [];
    ytext.observe((e) => deltas.push(e.delta));
    applyTextDiff(ytext, 'Went very well', LOCAL_ORIGIN);
    expect(deltas).toEqual([[{ retain: 5 }, { insert: 'very ' }]]);
    expect(textOf(doc, id)!.text).toBe('Went very well');
  });
});
