// The text object model: creation, the fields that may change, the empty test
// and the removal on edit end. Framework-free, so this is plain Y.Doc over
// Node, no jsdom (design.md: the board's data model is framework-free).
// TC ids are the Acceptance Cases in
// spec/stories/009-write-free-text-anywhere-on-the-board/design.md.

import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import {
  createText,
  deleteIfEmpty,
  getTextContent,
  isEmptyText,
  readText,
  setTextSize,
  setTextWidthAuto,
  setTextWidthFixed,
  setTextBox,
  textSnapshot,
  textSnapshots,
} from '../../src/shared/objects/text';
import {
  DEFAULT_TEXT_SIZE,
  MAX_OBJECT_SIZE_WORLD,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  TYPE_STICKY,
  TYPE_TEXT,
} from '../../src/shared/config';
import { createSticky, moveObjects } from '../../src/shared/board-model';
import { putRawObject, rawObject, rawObjects } from '../helpers/yjs';

/** Write into the document and report whether the document changed at all. */
function changedBy(doc: Y.Doc, write: () => unknown): boolean {
  let updates = 0;
  const listener = (): void => {
    updates += 1;
  };
  doc.on('update', listener);
  write();
  doc.off('update', listener);
  return updates > 0;
}

describe('createText (TC-01, TC-04)', () => {
  // TC-01
  it('creates a text with the default size, auto width, an empty Y.Text and a z above every object', () => {
    const doc = new Y.Doc();
    const note = createSticky(doc, { x: 0, y: 0 });
    // a text object already on the board, at a z above every sticky
    putRawObject(doc, 'text_high', { type: TYPE_TEXT, z: 40, createdAt: 2 });

    const before = Date.now();
    const id = createText(doc, { x: 100, y: 50 }, 'g_test');
    expect(id).not.toBeNull();

    const object = rawObject(doc, id!)!;
    expect(object.get('type')).toBe(TYPE_TEXT);
    expect(object.get('x')).toBe(100);
    expect(object.get('y')).toBe(50);
    expect(object.get('size')).toBe(DEFAULT_TEXT_SIZE);
    expect(object.get('size')).toBe('M');
    expect(object.get('widthMode')).toBe('auto');
    expect(object.get('createdBy')).toBe('g_test');
    expect(object.get('text')).toBeInstanceOf(Y.Text);
    expect((object.get('text') as Y.Text).toString()).toBe('');
    expect(Number(object.get('z'))).toBeGreaterThan(40);
    expect(Number(object.get('z'))).toBeGreaterThan(
      Number(rawObject(doc, note)!.get('z')),
    );
    // the box exists before any measuring, so the object has bounds
    expect(Number(object.get('width'))).toBeGreaterThan(0);
    expect(Number(object.get('height'))).toBeGreaterThan(0);
    expect(Number(object.get('createdAt'))).toBeGreaterThanOrEqual(before);
  });

  it('holds its own Y.Text, separate from every other object (TC-06)', () => {
    const doc = new Y.Doc();
    const a = createText(doc, { x: 100, y: 50 }, 'c_a')!;
    const b = createText(doc, { x: 600, y: 50 }, 'c_b')!;
    const ta = getTextContent(doc, a)!;
    const tb = getTextContent(doc, b)!;
    expect(ta).toBeInstanceOf(Y.Text);
    expect(tb).toBeInstanceOf(Y.Text);
    expect(ta).not.toBe(tb);
    // two objects, two shared types: the CRDT merges them independently
    expect(ta.parent).not.toBe(tb.parent);
  });

  // TC-04, the create half
  it('adds one entry to the objects map (positive)', () => {
    const doc = new Y.Doc();
    createText(doc, { x: 0, y: 0 }, 'c_a');
    expect(rawObjects(doc).size).toBe(1);
  });

  it('returns null and writes no transaction for a non-usable point', () => {
    const doc = new Y.Doc();
    expect(createText(doc, { x: Number.NaN, y: 1 }, 'c_a')).toBeNull();
    expect(createText(doc, { x: 1, y: Number.POSITIVE_INFINITY }, 'c_a')).toBeNull();
    expect(createText(doc, { x: '100' as unknown as number, y: 1 }, 'c_a')).toBeNull();
    expect(changedBy(doc, () => createText(doc, { x: Number.NaN, y: Number.NaN }, 'c_a'))).toBe(false);
    expect(rawObjects(doc).size).toBe(0);
  });

  it('reads back as a text snapshot, and skips entries that are not one', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 100, y: 50 }, 'c_a')!;
    createSticky(doc, { x: 0, y: 0 });
    putRawObject(doc, 'damaged', { type: TYPE_TEXT, z: 3, size: 'XXL' });

    const ids = textSnapshots(doc).map((snap) => snap.id);
    expect(ids).toContain(id);
    expect(ids).not.toContain('damaged');
    expect(readText('damaged', rawObject(doc, 'damaged')!)).toBeNull();
  });
});

describe('setTextSize (TC-02)', () => {
  // TC-02
  it('changes size and only size', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 100, y: 50 }, 'c_a')!;
    getTextContent(doc, id)!.insert(0, 'Went well');
    moveObjects(doc, new Map([[id, { x: 5, y: 5 }]]));

    expect(changedBy(doc, () => setTextSize(doc, id, 'L'))).toBe(true);
    const object = rawObject(doc, id)!;
    expect(object.get('size')).toBe('L');
    expect(object.get('x')).toBe(5);
    expect(object.get('y')).toBe(5);
    expect(object.get('widthMode')).toBe('auto');
    expect((object.get('text') as Y.Text).toString()).toBe('Went well');
  });

  it('is a no-op that writes nothing for an unknown size', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 100, y: 50 }, 'c_a')!;
    expect(setTextSize(doc, id, 'XXL')).toBe(false);
    expect(changedBy(doc, () => setTextSize(doc, id, 'XXL'))).toBe(false);
    expect(rawObject(doc, id)!.get('size')).toBe(DEFAULT_TEXT_SIZE);
    expect(setTextSize(doc, id, 7 as unknown as string)).toBe(false);
    expect(rawObject(doc, id)!.get('size')).toBe(DEFAULT_TEXT_SIZE);
  });

  it('is a no-op that writes nothing for a stale id', () => {
    const doc = new Y.Doc();
    expect(changedBy(doc, () => setTextSize(doc, 'gone', 'L'))).toBe(false);
    expect(rawObjects(doc).size).toBe(0);
  });

  it('is a no-op when the size is already the size it has', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'c_a')!;
    expect(changedBy(doc, () => setTextSize(doc, id, DEFAULT_TEXT_SIZE))).toBe(false);
  });
});

describe('setTextWidthFixed (TC-03)', () => {
  // TC-03
  it('takes the width, switches the mode, and changes nothing else', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 100, y: 50 }, 'c_a')!;
    getTextContent(doc, id)!.insert(0, 'Went well');
    const before = rawObject(doc, id)!;
    const height = before.get('height');

    expect(changedBy(doc, () => setTextWidthFixed(doc, id, 200))).toBe(true);
    const object = rawObject(doc, id)!;
    expect(object.get('width')).toBe(200);
    expect(object.get('widthMode')).toBe('fixed');
    expect(object.get('size')).toBe(DEFAULT_TEXT_SIZE);
    expect(object.get('x')).toBe(100);
    expect(object.get('y')).toBe(50);
    expect(object.get('height')).toBe(height); // the height is the layout's to write
  });

  it('clamps a width under TEXT_MIN_WIDTH_WORLD to it', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'c_a')!;
    setTextWidthFixed(doc, id, 10);
    expect(rawObject(doc, id)!.get('width')).toBe(TEXT_MIN_WIDTH_WORLD);
  });

  it('clamps a width over the largest object to MAX_OBJECT_SIZE_WORLD', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'c_a')!;
    setTextWidthFixed(doc, id, MAX_OBJECT_SIZE_WORLD * 10);
    expect(rawObject(doc, id)!.get('width')).toBe(MAX_OBJECT_SIZE_WORLD);
  });

  it('reports an out-of-range stored width as stored, and clamps the next width it is given', () => {
    const doc = new Y.Doc();
    putRawObject(doc, 'wide', {
      type: TYPE_TEXT,
      x: 0,
      y: 0,
      size: DEFAULT_TEXT_SIZE,
      widthMode: 'fixed',
      width: TEXT_MIN_WIDTH_WORLD / 2,
      height: 20,
    });
    // the reader never repairs a field it only reads: the layout is asked about it
    expect(textSnapshot(doc, 'wide')!.width).toBe(TEXT_MIN_WIDTH_WORLD / 2);
    // the next width a handle asks for is clamped up to the narrowest allowed
    expect(setTextWidthFixed(doc, 'wide', TEXT_MIN_WIDTH_WORLD / 2)).toBe(true);
    expect(rawObject(doc, 'wide')!.get('width')).toBe(TEXT_MIN_WIDTH_WORLD);
  });

  it('gives the width back to the text on setTextWidthAuto, changing nothing else', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 100, y: 50 }, 'c_a')!;
    setTextWidthFixed(doc, id, 240);
    expect(changedBy(doc, () => setTextWidthAuto(doc, id))).toBe(true);
    const object = rawObject(doc, id)!;
    expect(object.get('widthMode')).toBe('auto');
    expect(object.get('width')).toBe(240); // the layout writes the measured width
    expect(object.get('x')).toBe(100);
    expect(setTextWidthAuto(doc, id)).toBe(false); // already auto: no update
    expect(setTextWidthAuto(doc, 'gone')).toBe(false);
  });

  it('is a no-op that writes nothing for a stale id', () => {
    const doc = new Y.Doc();
    expect(changedBy(doc, () => setTextWidthFixed(doc, 'gone', 200))).toBe(false);
    expect(rawObjects(doc).size).toBe(0);
  });

  it('refuses a width that is not a number', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'c_a')!;
    expect(changedBy(doc, () => setTextWidthFixed(doc, id, Number.NaN))).toBe(false);
    expect(changedBy(doc, () => setTextWidthFixed(doc, id, '200' as unknown as number))).toBe(false);
  });
});

describe('setTextBox (TC-11 boundary, box writes)', () => {
  it('writes a width and height the layout measured', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'c_a')!;
    expect(
      changedBy(doc, () => setTextBox(doc, id, { width: TEXT_MAX_AUTO_WIDTH_WORLD, height: 52 })),
    ).toBe(true);
    expect(rawObject(doc, id)!.get('width')).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(rawObject(doc, id)!.get('height')).toBe(52);
  });

  it('is a no-op when the box already measures the same, and a no-op for a stale id', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'c_a')!;
    const width = Number(rawObject(doc, id)!.get('width'));
    const height = Number(rawObject(doc, id)!.get('height'));
    expect(changedBy(doc, () => setTextBox(doc, id, { width, height }))).toBe(false);
    expect(changedBy(doc, () => setTextBox(doc, 'gone', { width: 100, height: 100 }))).toBe(false);
  });

  it('refuses a box that is not usable, writing nothing', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'c_a')!;
    expect(changedBy(doc, () => setTextBox(doc, id, { width: Number.NaN, height: 20 }))).toBe(false);
    expect(changedBy(doc, () => setTextBox(doc, id, { width: 100, height: -1 }))).toBe(false);
    expect(Number.isFinite(Number(rawObject(doc, id)!.get('width')))).toBe(true);
  });
});

describe('isEmptyText and deleteIfEmpty (TC-04 to TC-06)', () => {
  // TC-04
  it('removes an empty text and leaves the objects that are not empty', () => {
    const doc = new Y.Doc();
    const a = createText(doc, { x: 100, y: 50 }, 'c_a')!;
    const b = createText(doc, { x: 600, y: 50 }, 'c_b')!;
    getTextContent(doc, b)!.insert(0, 'x');
    const note = createSticky(doc, { x: 0, y: 0 });

    expect(isEmptyText(doc, a)).toBe(true);
    expect(deleteIfEmpty(doc, a)).toBe(true);
    expect(rawObject(doc, a)).toBeNull();
    expect(rawObjects(doc).size).toBe(2);
    expect(rawObject(doc, b)).not.toBeNull();
    expect(rawObject(doc, note)!.get('type')).toBe(TYPE_STICKY);

    expect(isEmptyText(doc, b)).toBe(false);
    expect(deleteIfEmpty(doc, b)).toBe(false);
    expect(rawObject(doc, b)).not.toBeNull();
  });

  it('treats whitespace-only text as content (TC-04 boundary)', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'c_a')!;
    getTextContent(doc, id)!.insert(0, ' \n');
    expect(isEmptyText(doc, id)).toBe(false);
    expect(deleteIfEmpty(doc, id)).toBe(false);
    expect(rawObject(doc, id)).not.toBeNull();
  });

  // TC-05
  it('writes nothing for a stale id', () => {
    const doc = new Y.Doc();
    expect(changedBy(doc, () => deleteIfEmpty(doc, 'gone'))).toBe(false);
    expect(isEmptyText(doc, 'gone')).toBe(false);
    expect(textSnapshots(doc)).toEqual([]);
  });

  // TC-06
  it('merges concurrent edits of two texts on two replicas', () => {
    const doc = new Y.Doc();
    const a = createText(doc, { x: 100, y: 50 }, 'c_a')!;
    const b = createText(doc, { x: 600, y: 50 }, 'c_b')!;

    // a second replica of the same board
    const peer = new Y.Doc();
    doc.on('update', (update, origin) => {
      if (origin !== 'from-peer') Y.applyUpdate(peer, update, 'to-peer');
    });
    peer.on('update', (update, origin) => {
      if (origin !== 'to-peer') Y.applyUpdate(doc, update, 'from-peer');
    });
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc), 'to-peer');

    // both editors are inside an edit at the same time
    const long = 'Went well: the board loaded fast, the sync held, and everyone could read it.';
    getTextContent(doc, a)!.insert(0, long.repeat(4)); // A types ~300 characters
    const peerText = peer.getMap<Y.Map<unknown>>('objects').get(b)!.get('text') as Y.Text;
    peerText.insert(0, 'Retro: '); // B's own edit, to B's own text

    expect(getTextContent(doc, a)!.toString()).toBe(long.repeat(4));
    expect(getTextContent(doc, b)!.toString()).toBe('Retro: ');
    expect(peerText.toString()).toBe('Retro: ');
  });
});

describe('the size presets (TC-02 settings)', () => {
  it('ships four named font sizes, tallest XL, and one of them is the default', () => {
    expect(Object.keys(TEXT_SIZES)).toEqual(['S', 'M', 'L', 'XL']);
    expect(TEXT_SIZES.S).toBeLessThan(TEXT_SIZES.M);
    expect(TEXT_SIZES.M).toBeLessThan(TEXT_SIZES.L);
    expect(TEXT_SIZES.L).toBeLessThan(TEXT_SIZES.XL);
    expect(TEXT_SIZES[DEFAULT_TEXT_SIZE]).toBeGreaterThan(0);
  });

  it('gives a fresh text object the default preset, which is a setting', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'c_a')!;
    expect(rawObject(doc, id)!.get('size')).toBe(DEFAULT_TEXT_SIZE);
  });
});
