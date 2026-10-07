/**
 * The text object model - `tests/unit/text-model.test.ts`.
 *
 * Everything the text feature does to the shared document goes through
 * `src/shared/objects/text.ts`, and the behaviour that matters is the behaviour a
 * later story depends on: a size change writes one field, an unknown size is
 * refused, a width below the minimum is clamped instead of stored, empty text is
 * removed and whitespace is not empty, and a no-op writes nothing. A stale id
 * ("text on a stale id is a no-op returning false") is checked for every writer
 * here, and TC-14 checks it for the writers that live elsewhere.
 *
 * These are Y.Doc-only tests: no component, no canvas, no rendering. The
 * measurement of text is `src/client/objects/textLayout.ts` and belongs to
 * `tests/unit/text-layout.test.ts`; the writes back into the document belong to
 * `tests/component/TextBoxSync.test.tsx`.
 */

import * as Y from 'yjs';
import { describe, expect, it, vi } from 'vitest';

import {
  createSticky,
  deleteObjects,
  DOC_OBJECTS_MAP,
  initDoc,
  moveObjects,
} from '../../src/shared/board-model.js';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_CHARS,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../src/shared/config.js';
import {
  createText,
  deleteIfEmpty,
  getTextContent,
  isEmptyText,
  setTextBox,
  setTextWidthFixed,
  setTextSize,
  type TextSnapshot,
} from '../../src/shared/objects/text.js';

const docWith = (...types: ('sticky' | 'text')[]): Y.Doc => {
  const doc = new Y.Doc();
  initDoc(doc);
  for (const type of types) {
    if (type === 'sticky') createSticky(doc, { x: 100, y: 100 }, 'pink');
    else createText(doc, { x: 100, y: 100 }, 'g_other');
  }
  return doc;
};

const mapOf = (doc: Y.Doc, id: string): Y.Map<unknown> | undefined =>
  doc.getMap<Y.Map<unknown>>(DOC_OBJECTS_MAP).get(id);

/** The `z` of every object in the document, in insertion order. */
const zs = (doc: Y.Doc): number[] =>
  [...doc.getMap<Y.Map<unknown>>(DOC_OBJECTS_MAP).values()].map((map) => map.get('z') as number);

const textOf = (doc: Y.Doc, id: string): TextSnapshot => {
  const map = mapOf(doc, id);
  expect(map?.get('type')).toBe('text');
  return {
    id,
    type: 'text',
    x: map!.get('x') as number,
    y: map!.get('y') as number,
    width: map!.get('width') as number,
    height: map!.get('height') as number,
    z: map!.get('z') as number,
    createdAt: map!.get('createdAt') as number,
    createdBy: map!.get('createdBy') as string,
    text: (map!.get('text') as Y.Text).toString(),
    size: map!.get('size') as TextSnapshot['size'],
    widthMode: map!.get('widthMode') as TextSnapshot['widthMode'],
  };
};

const aText = (doc: Y.Doc): string => {
  const id = createText(doc, { x: 320, y: 240 }, 'g_local');
  expect(id).not.toBeNull();
  return id as string;
};

/** Count the transactions a call actually puts on the document. */
const countUpdates = (doc: Y.Doc, run: () => void): number => {
  let updates = 0;
  const observer = (): void => {
    updates += 1;
  };
  doc.on('update', observer);
  try {
    run();
  } finally {
    doc.off('update', observer);
  }
  return updates;
};

describe('text.create', () => {
  it('TC-01 makes a text object at the click point, with the click point in it', () => {
    const doc = docWith('sticky');
    const before = zs(doc);
    const spy = vi.fn();
    doc.on('update', spy);

    const id = createText(doc, { x: 271.5, y: 40.25 }, 'g_creator') as string;

    expect(typeof id).toBe('string');
    // Exactly one transaction: the object and its text go together (TC-15).
    expect(spy).toHaveBeenCalledTimes(1);

    const text = textOf(doc, id);
    expect(text.type).toBe('text');
    expect(text.x).toBe(271.5);
    expect(text.y).toBe(40.25);
    expect(text.size).toBe(DEFAULT_TEXT_SIZE);
    expect(TEXT_SIZES[text.size]).toBe(20);
    expect(text.widthMode).toBe('auto');
    expect(text.text).toBe('');
    expect(text.createdBy).toBe('g_creator');
    // A box exists before the first measurement, so the object has bounds.
    expect(Number.isFinite(text.width)).toBe(true);
    expect(Number.isFinite(text.height)).toBe(true);
    expect(text.width).toBeGreaterThanOrEqual(TEXT_MIN_WIDTH_WORLD);
    // One line of the default size, at least.
    expect(text.height).toBeGreaterThanOrEqual(TEXT_SIZES[DEFAULT_TEXT_SIZE] * TEXT_LINE_HEIGHT);
    // On top of everything that was already there.
    expect(before.length).toBe(1);
    expect(text.z).toBeGreaterThan(before[0] as number);
    expect(Number.isFinite(text.createdAt)).toBe(true);
  });

  it('TC-02 writes the size, and rejects an unknown one without writing', () => {
    const doc = docWith('text');
    const id = [...doc.getMap(DOC_OBJECTS_MAP).keys()][0] as string;
    const before = textOf(doc, id);

    expect(setTextSize(doc, id, 'XL')).toBe(true);
    expect(textOf(doc, id).size).toBe('XL');
    expect(textOf(doc, id).x).toBe(before.x);

    expect(setTextSize(doc, id, 'XXL')).toBe(false);
    expect(textOf(doc, id).size).toBe('XL');
    // A rejected size is not a transaction; the undo manager is not invited either.
    expect(countUpdates(doc, () => setTextSize(doc, id, ''))).toBe(0);
    expect(textOf(doc, id).size).toBe('XL');
  });

  it('TC-03 clamps a width below the minimum, and remembers it as a fixed width', () => {
    const doc = docWith('text');
    const id = [...doc.getMap(DOC_OBJECTS_MAP).keys()][0] as string;

    expect(setTextWidthFixed(doc, id, 30)).toBe(true);
    let text = textOf(doc, id);
    expect(text.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(text.widthMode).toBe('fixed');

    // A width that fits is stored as asked, and the object stays where it is.
    expect(setTextWidthFixed(doc, id, 240)).toBe(true);
    text = textOf(doc, id);
    expect(text.width).toBe(240);
    expect(text.x).toBe(100);
    // A width that is not a number is refused, and changes nothing.
    expect(countUpdates(doc, () => setTextWidthFixed(doc, id, Number.NaN))).toBe(0);
    expect(textOf(doc, id).width).toBe(240);
  });

  it('TC-04 removes text with zero characters and leaves whitespace alone', () => {
    const doc = new Y.Doc();
    initDoc(doc);

    const empty = aText(doc);
    expect(isEmptyText(doc, empty)).toBe(true);
    expect(deleteIfEmpty(doc, empty)).toBe(true);
    expect(mapOf(doc, empty)).toBeUndefined();
    // Already gone: a no-op, not an error.
    expect(deleteIfEmpty(doc, empty)).toBe(false);

    const whitespace = aText(doc);
    getTextContent(doc, whitespace)?.insert(0, '   ');
    expect(isEmptyText(doc, whitespace)).toBe(false);
    expect(countUpdates(doc, () => deleteIfEmpty(doc, whitespace))).toBe(0);
    expect(mapOf(doc, whitespace)).toBeDefined();

    // And it works the same on a sticky-shaped object: an empty note is not
    // empty text, and only text objects are ever removed here.
    const sticky = createSticky(doc, { x: 0, y: 0 });
    expect(sticky).not.toBe(false);
    expect(deleteIfEmpty(doc, sticky as string)).toBe(false);
    expect(mapOf(doc, sticky as string)).toBeDefined();
  });

  it('TC-05 accepts 5000 characters and truncates to 5000', async () => {
    const { clampToLimit } = await import('../../src/shared/text-edit.js');

    const long = 'x'.repeat(TEXT_MAX_CHARS + 1);
    expect(clampToLimit(long, TEXT_MAX_CHARS)).toHaveLength(TEXT_MAX_CHARS);
    // Text under the limit passes through untouched.
    expect(clampToLimit('abc', TEXT_MAX_CHARS)).toBe('abc');
    // Exactly at the limit is kept, and so is a change that lands exactly on it.
    const atLimit = 'y'.repeat(TEXT_MAX_CHARS - 1);
    expect(clampToLimit(atLimit + 'z', TEXT_MAX_CHARS)).toHaveLength(TEXT_MAX_CHARS);
    expect(clampToLimit(atLimit, TEXT_MAX_CHARS)).toBe(atLimit);
  });

  it('TC-06 makes nothing when the point is not a place on the board', () => {
    const doc = docWith('sticky');
    const before = [...doc.getMap(DOC_OBJECTS_MAP).keys()];

    expect(countUpdates(doc, () => createText(doc, { x: Number.NaN, y: 10 }, 'g_me'))).toBe(0);
    expect(countUpdates(doc, () => createText(doc, { x: 0, y: Number.POSITIVE_INFINITY }, 'g_me'))).toBe(
      0,
    );
    expect(countUpdates(doc, () => createText(doc, { x: '3' as unknown as number, y: 0 }, 'g_me'))).toBe(
      0,
    );
    expect([...doc.getMap(DOC_OBJECTS_MAP).keys()]).toEqual(before);
  });

  it('leaves the text empty on creation and puts it in the object, not beside it', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = aText(doc);

    const text = getTextContent(doc, id);
    expect(text).toBeInstanceOf(Y.Text);
    expect(text?.toString()).toBe('');
    // The text is the object's own `text` field: TC-15's single transaction.
    expect(mapOf(doc, id)?.get('text')).toBe(text);
  });

  it('creates the text even when it cannot say who asked for it', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createText(doc, { x: 1, y: 1 }, '   ');

    // An object without attribution is a smaller lie than a click that did nothing.
    expect(id).not.toBeNull();
    expect(mapOf(doc, id as string)?.get('createdBy')).toBeUndefined();
  });
});

describe('text.model: writers on a stale id', () => {
  it('every writer is a no-op that returns false for a deleted or unknown id', () => {
    const doc = docWith('text', 'text');
    const [first, second] = [...doc.getMap(DOC_OBJECTS_MAP).keys()];
    // The survivor holds a character: an empty text object is not a no-op for
    // deleteIfEmpty, it is exactly what that function is for (see TC-04).
    getTextContent(doc, second as string)?.insert(0, 'x');
    deleteObjects(doc, [first as string]);

    for (const id of [first, second, 'missing']) {
      expect(setTextSize(doc, id, 'L')).toBe(id === second);
      expect(setTextWidthFixed(doc, id, 120)).toBe(id === second);
      expect(setTextBox(doc, id, { width: 120, height: 40 })).toBe(id === second);
      expect(deleteIfEmpty(doc, id)).toBe(false);
      expect(isEmptyText(doc, id)).toBe(false);
      const content = getTextContent(doc, id);
      if (id === second) expect(content).toBeInstanceOf(Y.Text);
      else expect(content).toBeUndefined();
    }
  });

  it('a text object moves and deletes with the group operations', () => {
    const doc = docWith('text');
    const sticky = createSticky(doc, { x: 0, y: 0 });
    const id = [...doc.getMap(DOC_OBJECTS_MAP).keys()].find((key) => key !== sticky) as string;

    // A text object is a *known* object type, which is what lets story 7's group
    // operations, story 8's undo and story 4's persistence all carry it.
    expect(moveObjects(doc, new Map([[id, { x: 330, y: 245 }]]))).toBe(1);
    expect(textOf(doc, id).x).toBe(330);
    expect(textOf(doc, id).y).toBe(245);
    expect(deleteObjects(doc, [id])).toBe(1);
    expect(mapOf(doc, id)).toBeUndefined();
  });

  it('a text object survives a round trip through an update (a reload reads it)', () => {
    const doc = docWith('text');
    const id = [...doc.getMap(DOC_OBJECTS_MAP).keys()][0] as string;
    getTextContent(doc, id)?.insert(0, 'Week 12');
    setTextSize(doc, id, 'L');

    const restored = new Y.Doc();
    initDoc(restored);
    Y.applyUpdate(restored, Y.encodeStateAsUpdate(doc));
    expect(textOf(restored, id).text).toBe('Week 12');
    expect(textOf(restored, id).size).toBe('L');
    expect(textOf(restored, id).widthMode).toBe('auto');
  });
});
