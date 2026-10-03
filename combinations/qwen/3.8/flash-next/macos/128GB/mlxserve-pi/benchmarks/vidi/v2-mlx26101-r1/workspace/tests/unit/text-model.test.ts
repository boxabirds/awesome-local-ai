// text.model unit tests (story 9, TC-01 to TC-06).
//
// Every case runs against a real Y.Doc: the schema rules, the "reject before
// opening a transaction" error paths and the LOCAL_ORIGIN side effect are the whole
// contract of this module, and none of them can be checked against a fake store.
// `updatesDuring` is the assertion that a rejected call really wrote nothing: Yjs
// emits an `update` event for every committed transaction, so zero updates means no
// transaction was opened (the same trick the board-model tests use).

import { beforeEach, describe, expect, it } from 'vitest';
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
import {
  createSticky,
  LOCAL_ORIGIN,
  objectSnapshots,
  snapshot,
} from '../../src/shared/board-model';
import { clampToLimit } from '../../src/shared/text-edit';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_MAX_CHARS,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  TEXT_LINE_HEIGHT,
} from '../../src/shared/config';
import { SHORT_PHRASE } from '../fixtures/texts';

/** The objects map of a doc, typed loosely for raw schema assertions. */
function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

/** How many `update` events (committed transactions) `fn` produces. */
function updatesDuring(doc: Y.Doc, fn: () => void): number {
  let count = 0;
  const handler = () => {
    count += 1;
  };
  doc.on('update', handler);
  try {
    fn();
  } finally {
    doc.off('update', handler);
  }
  return count;
}

/** The raw stored map of one object. */
function raw(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  return objectsMap(doc).get(id);
}

describe('text.model', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
  });

  it('TC-01 creates a size M auto-width text at the point, on top, owned by the author', () => {
    const sticky = createSticky(doc, { x: 10, y: 10 });
    expect(sticky).toBeTruthy();

    const id = createText(doc, { x: 100, y: 50 }, 'g_test');
    expect(id).toBeTruthy();

    const obj = raw(doc, id!);
    expect(obj).toBeDefined();
    expect(obj!.get('type')).toBe('text');
    expect(obj!.get('x')).toBe(100);
    expect(obj!.get('y')).toBe(50);
    expect(obj!.get('size')).toBe(DEFAULT_TEXT_SIZE);
    expect(obj!.get('size')).toBe('M');
    expect(obj!.get('widthMode')).toBe('auto');
    const text = obj!.get('text');
    expect(text).toBeInstanceOf(Y.Text);
    expect((text as Y.Text).toString()).toBe('');
    expect(obj!.get('createdBy')).toBe('g_test');
    // It lands above every existing object, so it is not hidden behind a note.
    const stickyZ = raw(doc, sticky!)!.get('z') as number;
    expect(obj!.get('z')).toBeGreaterThan(stickyZ);
    // It has a finite box straight away, so selection bounds exist before measuring.
    expect(obj!.get('width')).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(obj!.get('height')).toBeGreaterThan(0);
    expect(typeof obj!.get('createdAt')).toBe('number');
  });

  it('TC-01 applies as a text snapshot for the generic render / selection path', () => {
    const sticky = createSticky(doc, { x: 10, y: 10 })!;
    const id = createText(doc, { x: 100, y: 50 }, 'g_test')!;
    const snaps = objectSnapshots(doc);
    const snap = snaps.find((s) => s.id === id);
    expect(snap?.type).toBe('text');
    expect(snap?.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(snap?.height).toBeGreaterThan(0);
    // The stickies are still there: a text object does not replace them.
    expect(snapshot(doc).map((s) => s.id)).toEqual([sticky]);
    expect(snaps).toHaveLength(2);
  });

  it('TC-02 applies a known size preset and rejects an unknown one without a write', () => {
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;

    expect(setTextSize(doc, id, 'XL')).toBe(true);
    expect(raw(doc, id)!.get('size')).toBe('XL');

    // Error path: 'XXL' is not a preset. False, and no transaction at all.
    const before = raw(doc, id)!.get('size');
    expect(updatesDuring(doc, () => expect(setTextSize(doc, id, 'XXL')).toBe(false))).toBe(0);
    expect(raw(doc, id)!.get('size')).toBe(before);
  });

  it('TC-03 clamps a fixed width up to TEXT_MIN_WIDTH_WORLD and switches the mode', () => {
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;

    expect(setTextWidthFixed(doc, id, 30)).toBe(true);
    expect(raw(doc, id)!.get('width')).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(raw(doc, id)!.get('widthMode')).toBe('fixed');

    // A width above the minimum is taken as given.
    expect(setTextWidthFixed(doc, id, 320)).toBe(true);
    expect(raw(doc, id)!.get('width')).toBe(320);
    expect(raw(doc, id)!.get('widthMode')).toBe('fixed');
  });

  it('TC-04 treats only zero characters as empty, so whitespace-only text is kept', () => {
    const blank = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    expect(isEmptyText(doc, blank)).toBe(true);
    expect(deleteIfEmpty(doc, blank)).toBe(true);
    expect(raw(doc, blank)).toBeUndefined();

    // Negative: a few spaces are characters somebody typed; they are not "empty".
    const spaces = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    getTextContent(doc, spaces)!.insert(0, '   ');
    expect(isEmptyText(doc, spaces)).toBe(false);
    expect(deleteIfEmpty(doc, spaces)).toBe(false);
    expect(raw(doc, spaces)).toBeDefined();

    // And text that is not empty at all survives too.
    const kept = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    getTextContent(doc, kept)!.insert(0, SHORT_PHRASE);
    expect(deleteIfEmpty(doc, kept)).toBe(false);
    expect(raw(doc, kept)).toBeDefined();
  });

  it('TC-05 clamps text to TEXT_MAX_CHARS at the boundary and keeps an astral char whole', () => {
    const one = 'a'.repeat(4_999);
    const over = 'a'.repeat(5_001);
    expect(over.length).toBe(5_001);

    // 5,001 characters become exactly 5,000.
    expect(clampToLimit(over, TEXT_MAX_CHARS)).toHaveLength(5_000);
    // 4,999 already fits, and 4,999 + 1 lands exactly on the limit (boundary).
    expect(clampToLimit(one, TEXT_MAX_CHARS)).toHaveLength(4_999);
    expect(clampToLimit(one + 'b', TEXT_MAX_CHARS)).toHaveLength(5_000);
    expect(clampToLimit(one + 'b', TEXT_MAX_CHARS).endsWith('b')).toBe(true);
    // Well under the limit is untouched.
    expect(clampToLimit(SHORT_PHRASE, TEXT_MAX_CHARS)).toBe(SHORT_PHRASE);

    // The cut never leaves half of a surrogate pair behind.
    const emoji = 'x'.repeat(4_999) + '\u{1F600}';
    const cut = clampToLimit(emoji, TEXT_MAX_CHARS);
    expect(cut).toHaveLength(4_999);
    expect(cut).toBe('x'.repeat(4_999));
  });

  it('TC-06 refuses a non-finite create point with null and no transaction', () => {
    for (const at of [
      { x: Number.NaN, y: 0 },
      { x: 0, y: Number.NaN },
      { x: Number.POSITIVE_INFINITY, y: 0 },
      { x: 0, y: Number.NEGATIVE_INFINITY },
    ]) {
      expect(updatesDuring(doc, () => expect(createText(doc, at, 'g_test')).toBeNull())).toBe(0);
    }
    expect(objectsMap(doc).size).toBe(0);
  });

  it('rejects a stale id on every setter, without writing anything', () => {
    createText(doc, { x: 0, y: 0 }, 'g_test'); // one object so an update is meaningful
    const gone = 'missing-object-id';

    const calls: Array<[string, boolean]> = [
      ['setTextSize', setTextSize(doc, gone, 'L')],
      ['setTextWidthFixed', setTextWidthFixed(doc, gone, 200)],
      ['setTextBox', setTextBox(doc, gone, { width: 200, height: 40 })],
      ['deleteIfEmpty', deleteIfEmpty(doc, gone)],
    ];
    for (const [name, result] of calls) {
      expect(result, name).toBe(false);
    }
    expect(isEmptyText(doc, gone)).toBe(false);
    expect(getTextContent(doc, gone)).toBeUndefined();

    // A non-finite width / box on an existing object is refused the same way.
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    expect(setTextWidthFixed(doc, id, Number.NaN)).toBe(false);
    expect(setTextBox(doc, id, { width: 10, height: Number.NaN })).toBe(false);
    expect(updatesDuring(doc, () => expect(setTextBox(doc, id, { width: 120, height: 26 })).toBe(true))).toBe(1);
  });

  it('setTextBox does not write a box that is already there', () => {
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const box = { width: 120, height: 26 };
    expect(setTextBox(doc, id, box)).toBe(true);
    // The same box again: no redundant update (TC-13's rule, at the model level).
    expect(updatesDuring(doc, () => expect(setTextBox(doc, id, box)).toBe(false))).toBe(0);
    expect(raw(doc, id)!.get('width')).toBe(120);
    expect(raw(doc, id)!.get('height')).toBe(26);
  });

  it('writes every change as one LOCAL_ORIGIN transaction', () => {
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const origins: unknown[] = [];
    const handler = (_u: Uint8Array, origin: unknown) => {
      origins.push(origin);
    };
    doc.on('update', handler);
    try {
      setTextSize(doc, id, 'S');
    } finally {
      doc.off('update', handler);
    }
    expect(origins).toEqual([LOCAL_ORIGIN]);
  });

  it('keeps the documented schema keys on a created object', () => {
    const id = createText(doc, { x: 1, y: 2 }, 'g_test')!;
    expect([...raw(doc, id)!.keys()].sort()).toEqual(
      [
        'createdAt',
        'createdBy',
        'height',
        'size',
        'text',
        'type',
        'width',
        'widthMode',
        'x',
        'y',
        'z',
      ].sort(),
    );
  });

  it('a created object reports the font size of its preset and one line', () => {
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const obj = raw(doc, id)!;
    expect(TEXT_SIZES[DEFAULT_TEXT_SIZE]).toBe(20);
    expect(obj.get('height')).toBe(TEXT_SIZES[DEFAULT_TEXT_SIZE] * TEXT_LINE_HEIGHT);
  });
});
