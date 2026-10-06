/**
 * Unit tests for the text object's model functions and for the shared text-edit helpers
 * (design §9.1 tests 1–6).
 *
 * A `Y.Doc` is real here; nothing else is. Everything is synchronous: each contract function takes a
 * `Y.Doc` and an id, so a test calls it and reads the document back.
 */

import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';

import {
  createSticky,
  deleteObjects,
  initDoc,
  OBJECTS_MAP,
  snapshot,
  STICKY_TYPE,
} from '../../src/shared/board-model';
import {
  DEFAULT_TEXT_SIZE,
  STICKY_TEXT_MAX_CHARS,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../src/shared/config';
import {
  createText,
  deleteIfEmpty,
  getTextContent,
  isEmptyText,
  setTextBox,
  setTextSize,
  setTextWidthFixed,
} from '../../src/shared/objects/text';
import { applyTextDiff, clampToLimit } from '../../src/shared/text-edit';

/** A sticky note made in the test document, with its id narrowed to a string. */
const makeSticky = (doc: Y.Doc): string => {
  const id = createSticky(doc, { x: 0, y: 0 });
  if (typeof id !== 'string') throw new Error('the sticky note was not created');
  return id;
};

const objectsOf = (doc: Y.Doc): Y.Map<Y.Map<unknown>> =>
  doc.getMap(OBJECTS_MAP) as Y.Map<Y.Map<unknown>>;

const entry = (doc: Y.Doc, id: string): Y.Map<unknown> => {
  const value: unknown = objectsOf(doc).get(id);
  if (!(value instanceof Y.Map)) throw new Error(`object ${id} is missing from the document`);
  return value;
};

/** A document with one text object in it. */
const docWithText = (id = 'g_test'): { doc: Y.Doc; id: string } => {
  const doc = new Y.Doc();
  initDoc(doc);
  const created = createText(doc, { x: 100, y: 200 }, id);
  if (created === null) throw new Error('the text was not created');
  return { doc, id: created };
};

describe('createText', () => {
  // TC-01
  it('creates a text object with the defaults, above everything already on the board', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const sticky = makeSticky(doc);
    const id = createText(doc, { x: 100, y: 200 }, 'g_test');

    expect(id).toEqual(expect.any(String));
    const map = entry(doc, id as string);
    expect(map.get('type')).toBe('text');
    expect(map.get('x')).toBe(100);
    expect(map.get('y')).toBe(200);
    expect(map.get('size')).toBe(DEFAULT_TEXT_SIZE);
    expect(map.get('widthMode')).toBe('auto');
    expect((map.get('text') as Y.Text).toString()).toBe('');
    expect(map.get('createdBy')).toBe('g_test');
    const stickyZ = Number(entry(doc, sticky).get('z'));
    expect(Number(map.get('z'))).toBeGreaterThan(stickyZ);
    // A box exists before the first measure, so the object has bounds from the moment it is made.
    expect(Number(map.get('width'))).toBeGreaterThan(0);
    expect(Number(map.get('height'))).toBeGreaterThan(0);
  });

  it.each([
    ['a missing point', (doc: Y.Doc) => createText(doc, undefined as never, 'g_test')],
    ['a point with no numbers', (doc: Y.Doc) => createText(doc, { x: NaN, y: 1 }, 'g_test')],
    ['a non-finite point', (doc: Y.Doc) => createText(doc, { x: 1, y: Infinity }, 'g_test')],
  ])('%s creates nothing and returns null', (_label, act) => {
    const doc = new Y.Doc();
    initDoc(doc);
    expect(act(doc)).toBeNull();
    expect(objectsOf(doc).size).toBe(0);
  });

  it('is the text type the board model knows, and the sticky note type stays itself', () => {
    const { doc, id } = docWithText();
    const objects = snapshot(doc);
    const text = objects.find((object) => object.id === id);
    expect(text?.type).toBe('text');
    const sticky = makeSticky(doc);
    const note = snapshot(doc).find((object) => object.id === sticky);
    expect(note?.type).toBe(STICKY_TYPE);
  });
});

describe('the text snapshot', () => {
  it('carries its own text, size and width mode for the client to draw', () => {
    const { doc, id } = docWithText();
    const ytext = getTextContent(doc, id);
    applyTextDiff(ytext as Y.Text, 'Went well', undefined);
    setTextWidthFixed(doc, id, 300);

    const object = snapshot(doc).find((candidate) => candidate.id === id);
    expect(object).toMatchObject({ type: 'text', text: 'Went well', size: 'M', widthMode: 'fixed' });
  });

  it('a document written by a client that does not know the type still lists it, without failing', () => {
    // What an older client stores is a text entry with fields this build reads defensively.
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createText(doc, { x: 5, y: 5 }, 'g_test') as string;
    const map = entry(doc, id);
    map.set('size', 'HUGE'); // not one of ours
    map.set('widthMode', 'sideways');
    expect(() => snapshot(doc)).not.toThrow();
    const object = snapshot(doc).find((candidate) => candidate.id === id);
    expect(object).toMatchObject({
      type: 'text',
      size: DEFAULT_TEXT_SIZE, // an unknown size reads as the default one
      widthMode: 'auto',
    });
  });
});

describe('setTextSize', () => {
  // TC-02
  it('writes a size it knows, and nothing else', () => {
    const { doc, id } = docWithText();
    const before = { x: entry(doc, id).get('x'), y: entry(doc, id).get('y') };

    expect(setTextSize(doc, id, 'L')).toBe(true);
    expect(entry(doc, id).get('size')).toBe('L');
    expect(entry(doc, id).get('x')).toBe(before.x);
    expect(entry(doc, id).get('y')).toBe(before.y);
  });

  it('reads a size it does not know as no change at all', () => {
    const { doc, id } = docWithText();
    expect(setTextSize(doc, id, 'XXL')).toBe(false);
    expect(setTextSize(doc, id, 42 as never)).toBe(false);
    expect(setTextSize(doc, id, '')).toBe(false);
    expect(entry(doc, id).get('size')).toBe(DEFAULT_TEXT_SIZE);
  });

  it.each([
    ['a stale id', (doc: Y.Doc) => setTextSize(doc, 'gone', 'L')],
    ['a sticky note id', (doc: Y.Doc) => setTextSize(doc, makeSticky(doc), 'L')],
  ])('%s writes nothing and returns false', (_label, act) => {
    const { doc, id } = docWithText();
    expect(act(doc)).toBe(false);
    expect(entry(doc, id).get('size')).toBe(DEFAULT_TEXT_SIZE);
  });

  it('is false when the size is already the one asked for', () => {
    const { doc, id } = docWithText();
    expect(setTextSize(doc, id, DEFAULT_TEXT_SIZE)).toBe(false);
  });
});

describe('setTextWidthFixed', () => {
  // TC-03
  it('takes the width and switches to fixed', () => {
    const { doc, id } = docWithText();
    expect(setTextWidthFixed(doc, id, 250)).toBe(true);
    expect(entry(doc, id).get('width')).toBe(250);
    expect(entry(doc, id).get('widthMode')).toBe('fixed');
  });

  it('keeps a width below the minimum at the minimum', () => {
    const { doc, id } = docWithText();
    expect(setTextWidthFixed(doc, id, 30)).toBe(true);
    expect(entry(doc, id).get('width')).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(entry(doc, id).get('widthMode')).toBe('fixed');
  });

  it.each([
    ['a stale id', (doc: Y.Doc) => setTextWidthFixed(doc, 'gone', 250)],
    ['a sticky note id', (doc: Y.Doc) => setTextWidthFixed(doc, makeSticky(doc), 250)],
  ])('%s writes nothing and returns false', (_label, act) => {
    const { doc, id } = docWithText();
    expect(act(doc)).toBe(false);
    expect(entry(doc, id).get('widthMode')).toBe('auto');
  });

  it.each([
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['a string', '250' as never],
  ])('a width that is not a number (%s) writes nothing', (_label, width) => {
    const { doc, id } = docWithText();
    const before = entry(doc, id).get('width');
    expect(setTextWidthFixed(doc, id, width)).toBe(false);
    expect(entry(doc, id).get('width')).toBe(before);
    expect(entry(doc, id).get('widthMode')).toBe('auto');
  });
});

describe('setTextBox', () => {
  it('writes both numbers', () => {
    const { doc, id } = docWithText();
    expect(setTextBox(doc, id, { width: 120, height: 52 })).toBe(true);
    expect(entry(doc, id).get('width')).toBe(120);
    expect(entry(doc, id).get('height')).toBe(52);
  });

  it.each([
    ['a stale id'],
    ['a sticky note id'],
  ])('%s writes nothing and returns false', (_label) => {
    const { doc, id } = docWithText();
    const sticky = makeSticky(doc);
    const before = { width: entry(doc, id).get('width'), height: entry(doc, id).get('height') };
    const target = _label === 'a stale id' ? 'g_missing' : sticky;
    expect(setTextBox(doc, target, { width: 120, height: 52 })).toBe(false);
    expect(entry(doc, id).get('width')).toBe(before.width);
    expect(entry(doc, id).get('height')).toBe(before.height);
  });

  it.each([
    ['a box of nothing', { width: 0, height: 0 }],
    ['a negative box', { width: -10, height: -10 }],
    ['a box with NaN in it', { width: NaN, height: 20 }],
  ])('a box with no area (%s) writes nothing', (_label, box) => {
    const { doc, id } = docWithText();
    const before = { width: entry(doc, id).get('width'), height: entry(doc, id).get('height') };
    expect(setTextBox(doc, id, box)).toBe(false);
    expect(entry(doc, id).get('width')).toBe(before.width);
    expect(entry(doc, id).get('height')).toBe(before.height);
  });

  it('is false when the box is already the one asked for, so a remeasure writes nothing', () => {
    const { doc, id } = docWithText();
    expect(setTextBox(doc, id, { width: 120, height: 52 })).toBe(true);
    expect(setTextBox(doc, id, { width: 120, height: 52 })).toBe(false);
  });
});

describe('getTextContent / isEmptyText / deleteIfEmpty', () => {
  // TC-04
  it('empties an object: isEmptyText says so, and deleteIfEmpty removes it', () => {
    const { doc, id } = docWithText();
    expect(isEmptyText(doc, id)).toBe(true);
    expect(deleteIfEmpty(doc, id)).toBe(true);
    expect(objectsOf(doc).has(id)).toBe(false);
  });

  it('keeps text that has anything in it, spaces included', () => {
    const { doc, id } = docWithText();
    (getTextContent(doc, id) as Y.Text).insert(0, '   ');
    expect(isEmptyText(doc, id)).toBe(false);
    expect(deleteIfEmpty(doc, id)).toBe(false);
    expect(objectsOf(doc).has(id)).toBe(true);
  });

  it('hands back the one Y.Text to write into', () => {
    const { doc, id } = docWithText();
    const ytext = getTextContent(doc, id);
    expect(ytext).toBeInstanceOf(Y.Text);
    ytext?.insert(0, 'Went well');
    expect(getTextContent(doc, id)?.toString()).toBe('Went well');
  });

  it.each([
    ['a stale id', (doc: Y.Doc) => [getTextContent(doc, 'gone'), isEmptyText(doc, 'gone'), deleteIfEmpty(doc, 'gone')]],
    ['a sticky note id', (doc: Y.Doc) => {
      const sticky = makeSticky(doc);
      return [getTextContent(doc, sticky), isEmptyText(doc, sticky), deleteIfEmpty(doc, sticky)];
    }],
  ])('%s has no text, is not counted empty, and is not deleted by it', (_label, act) => {
    const { doc, id } = docWithText();
    const [content, empty, deleted] = act(doc);
    expect(content).toBeUndefined();
    expect(empty).toBe(false);
    expect(deleted).toBe(false);
    // The object that was asked about is still there; the text is untouched.
    expect(objectsOf(doc).has(id)).toBe(true);
  });

  it('deleteIfEmpty removes nothing else on the board', () => {
    const { doc, id } = docWithText();
    const sticky = makeSticky(doc);
    expect(deleteIfEmpty(doc, id)).toBe(true);
    expect(objectsOf(doc).has(sticky)).toBe(true);
  });
});

describe('text objects live beside every other type', () => {
  it('select all and delete walk them like anything else', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const sticky = makeSticky(doc);
    const text = createText(doc, { x: 10, y: 10 }, 'g_test') as string;

    const ids = snapshot(doc).map((object) => object.id);
    expect(ids).toContain(sticky);
    expect(ids).toContain(text);

    expect(deleteObjects(doc, ids)).toBe(2);
    expect(snapshot(doc)).toHaveLength(0);
  });
});

describe('the shared text-edit helpers (TC-05, TC-06)', () => {
  // TC-05
  it('clampToLimit stops at the limit and never cuts an emoji in half', () => {
    expect(clampToLimit('hello', 5)).toBe('hello');
    expect(clampToLimit('hello world', 8)).toBe('hello wo');
    expect(clampToLimit('👍👍👍', 3)).toBe('👍'); // 6 UTF-16 units, 3 allowed, no half pair
    expect(clampToLimit('anything', 0)).toBe('');
    expect(clampToLimit(undefined as never, 10)).toBe('');
  });

  it('the sticky note default and the text object default are the same rule with different numbers', () => {
    // Both types read their own limit out of the settings and share this one implementation.
    expect(clampToLimit('x'.repeat(2_000), STICKY_TEXT_MAX_CHARS).length).toBe(1_000);
    expect(clampToLimit('x'.repeat(2_000), 1_000).length).toBe(1_000);
  });

  // TC-06
  it('applyTextDiff keeps the words that did not change', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('shared');
    ytext.insert(0, 'abc');

    let deletions = 0;
    let insertions = 0;
    doc.on('update', () => {
      /* observed below through the delta instead */
    });
    ytext.observe((event) => {
      for (const delta of event.delta) {
        if ('delete' in delta) deletions += (delta as { delete: number }).delete;
        if ('insert' in delta) insertions += String((delta as { insert: string }).insert).length;
      }
    });

    applyTextDiff(ytext, 'abc!', 'origin-tag');
    expect(ytext.toString()).toBe('abc!');
    expect(deletions).toBe(0);
    expect(insertions).toBe(1);
  });

  it('applyTextDiff does nothing when nothing changed', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('shared');
    ytext.insert(0, 'abc');
    let events = 0;
    ytext.observe(() => {
      events += 1;
    });
    applyTextDiff(ytext, 'abc', undefined);
    expect(events).toBe(0);
  });

  it('applyTextDiff writes the caller as the transaction origin', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('shared');
    const origins: unknown[] = [];
    doc.on('update', (_update: Uint8Array, origin: unknown) => {
      origins.push(origin);
    });
    applyTextDiff(ytext, 'abcd', 'g_local');
    expect(origins).toContain('g_local');
  });

  it('the sizes are the four the product names, smallest to largest', () => {
    expect(Object.keys(TEXT_SIZES)).toEqual(['S', 'M', 'L', 'XL']);
    const sizes = Object.values(TEXT_SIZES);
    expect(sizes).toEqual([...sizes].sort((a, b) => a - b));
    expect(TEXT_SIZES[DEFAULT_TEXT_SIZE]).toBeGreaterThan(0);
  });
});
