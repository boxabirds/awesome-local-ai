/**
 * The text object model (spec anchor `text.model`) against a real `Y.Doc`.
 *
 * TC-01 createText            → type 'text', size M, auto width, empty Y.Text, on top, createdBy
 * TC-02 setTextSize           → applied; an unknown size is refused with no update
 * TC-03 setTextWidthFixed     → clamped to the minimum, and switches the box to fixed
 * TC-04 isEmptyText           → zero characters only; whitespace-only text is kept
 * TC-05 clampToLimit          → 5,001 characters become 5,000; 4,999 + 1 is accepted
 * TC-06 createText            → a point that is not a number creates nothing at all
 *       stale ids             → every setter answers false and writes nothing
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import {
  createSticky,
  highestZ,
  initDoc,
  objectSnapshots,
  OBJECTS_KEY,
  LOCAL_ORIGIN,
} from '../../src/shared/board-model';
import {
  DEFAULT_TEXT_SIZE,
  STICKY_SIZE_WORLD,
  TEXT_MAX_CHARS,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../src/shared/config';
import {
  createText,
  deleteIfEmpty,
  getText,
  isEmptyText,
  setTextBox,
  setTextSize,
  setTextWidthFixed,
  TEXT_TYPE,
} from '../../src/shared/objects/text';
import { applyTextDiff, clampToLimit } from '../../src/shared/text-edit';

/** Open a document the way the app does, and watch how often it changes. */
function trackedDoc(): { doc: Y.Doc; updates: () => number } {
  const doc = new Y.Doc();
  initDoc(doc);
  let updates = 0;
  doc.on('update', () => {
    updates += 1;
  });
  return { doc, updates: () => updates };
}

/** The raw `Y.Map` behind an object, to check what is actually stored. */
function rawObject(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  return (doc.getMap(OBJECTS_KEY) as Y.Map<Y.Map<unknown>>).get(id);
}

/** Run an action and report how many document updates it produced. */
function countUpdates(doc: Y.Doc, action: () => unknown): number {
  let updates = 0;
  const listener = () => {
    updates += 1;
  };
  doc.on('update', listener);
  try {
    action();
  } finally {
    doc.off('update', listener);
  }
  return updates;
}

describe('text.model: creating text', () => {
  it('TC-01 places text at the clicked point, size M, automatic width, empty, on top', () => {
    const { doc } = trackedDoc();
    const stickyId = createSticky(doc, { x: 40, y: 40 });
    const below = objectSnapshots(doc).find((object) => object.id === stickyId);
    if (!below) throw new Error('the fixture note is missing');

    const id = createText(doc, { x: 100, y: 50 }, 'g_test');

    expect(id).toBeTruthy();
    const map = rawObject(doc, id as string);
    expect(map).toBeDefined();
    expect(map?.get('type')).toBe(TEXT_TYPE);
    // The point is the top-left, not the centre: text lands where it was clicked.
    expect(map?.get('x')).toBe(100);
    expect(map?.get('y')).toBe(50);
    expect(map?.get('size')).toBe(DEFAULT_TEXT_SIZE);
    expect(map?.get('widthMode')).toBe('auto');
    expect(map?.get('createdBy')).toBe('g_test');
    expect(map?.get('text')).toBeInstanceOf(Y.Text);
    expect((map?.get('text') as Y.Text).toString()).toBe('');
    // On top of every other object, so text placed over notes is readable.
    expect(Number(map?.get('z'))).toBeGreaterThan(below.z);
    expect(getText(doc, id as string)?.toString()).toBe('');
    // It is readable as a text object, with a box so the selection has bounds.
    const snapshot = objectSnapshots(doc).find((object) => object.id === id);
    expect(snapshot?.type).toBe('text');
    expect(Number(snapshot?.width)).toBeGreaterThan(0);
    expect(Number(snapshot?.height)).toBeGreaterThan(0);
  });

  it('TC-06 refuses a point that is not a number and opens no transaction', () => {
    const { doc } = trackedDoc();
    const before = objectSnapshots(doc).length;

    for (const point of [
      { x: Number.NaN, y: 10 },
      { x: 10, y: Number.NaN },
      { x: Number.POSITIVE_INFINITY, y: 0 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any[]) {
      expect(createText(doc, point, 'g_test')).toBeNull();
    }
    expect(objectSnapshots(doc)).toHaveLength(before);
    expect(countUpdates(doc, () => createText(doc, { x: Number.NaN, y: 0 }, 'g_test'))).toBe(0);
  });

  it('writes the new object in one local transaction', () => {
    const { doc } = trackedDoc();
    let origins: unknown[] = [];
    doc.on('afterTransaction', (transaction: Y.Transaction) => {
      origins.push(transaction.origin);
    });
    const id = createText(doc, { x: 10, y: 10 }, 'g_test');
    expect(id).toBeTruthy();
    expect(origins).toEqual([LOCAL_ORIGIN]);
  });
});

describe('text.model: changing size', () => {
  it('TC-02 applies a known size and refuses an unknown one with no update', () => {
    const { doc } = trackedDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test') as string;
    const map = rawObject(doc, id);
    const x = map?.get('x');
    const y = map?.get('y');

    expect(setTextSize(doc, id, 'XL')).toBe(true);
    expect(map?.get('size')).toBe('XL');
    // Every preset is a real font size, and XL is the biggest of them.
    expect(TEXT_SIZES.XL).toBeGreaterThan(TEXT_SIZES.S);

    const refused = countUpdates(doc, () => setTextSize(doc, id, 'XXL'));
    expect(refused).toBe(0);
    expect(map?.get('size')).toBe('XL');
    // The position belongs to the object, not to its size: `x` and `y` are
    // untouched by a size change (`text.size`).
    expect(map?.get('x')).toBe(x);
    expect(map?.get('y')).toBe(y);
  });

  it('refuses a stale id and a size that is not a key of the presets', () => {
    const { doc } = trackedDoc();
    expect(countUpdates(doc, () => setTextSize(doc, 'gone', 'M'))).toBe(0);
    expect(setTextSize(doc, 'gone', 'M')).toBe(false);

    const stickyId = createSticky(doc, { x: 0, y: 0 });
    // A sticky note has no text size to change.
    expect(setTextSize(doc, stickyId, 'L')).toBe(false);
  });
});

describe('text.model: width mode', () => {
  it('TC-03 clamps a drag below the minimum and marks the width fixed', () => {
    const { doc } = trackedDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test') as string;
    const map = rawObject(doc, id);

    expect(setTextWidthFixed(doc, id, 30)).toBe(true);
    expect(map?.get('widthMode')).toBe('fixed');
    expect(map?.get('width')).toBe(TEXT_MIN_WIDTH_WORLD);

    // Exactly the minimum is allowed, and so is anything above it.
    expect(setTextWidthFixed(doc, id, TEXT_MIN_WIDTH_WORLD)).toBe(true);
    expect(map?.get('width')).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(setTextWidthFixed(doc, id, 240)).toBe(true);
    expect(map?.get('width')).toBe(240);
  });

  it('refuses a width that is not a number, and a stale id', () => {
    const { doc } = trackedDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test') as string;
    const width = rawObject(doc, id)?.get('width');

    expect(countUpdates(doc, () => setTextWidthFixed(doc, id, Number.NaN))).toBe(0);
    expect(setTextWidthFixed(doc, id, Number.NaN)).toBe(false);
    expect(rawObject(doc, id)?.get('width')).toBe(width);
    expect(setTextWidthFixed(doc, 'gone', 120)).toBe(false);
  });

  it('writes a box only when it is different, and refuses a box that is not a box', () => {
    const { doc } = trackedDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test') as string;
    const map = rawObject(doc, id);

    expect(setTextBox(doc, id, { width: 120, height: 26 })).toBe(true);
    expect(map?.get('width')).toBe(120);
    expect(map?.get('height')).toBe(26);
    // The same box again is not a change: no update, so no traffic and no undo step.
    expect(countUpdates(doc, () => setTextBox(doc, id, { width: 120, height: 26 }))).toBe(0);
    expect(setTextSize(doc, id, 'L') && setTextBox(doc, id, { width: 120, height: 42 })).toBe(true);

    expect(setTextBox(doc, id, { width: 0, height: 26 })).toBe(false);
    expect(setTextBox(doc, id, { width: 120, height: Number.NaN })).toBe(false);
    expect(setTextBox(doc, 'gone', { width: 120, height: 26 })).toBe(false);
  });
});

describe('text.model: empty text', () => {
  it('TC-04 treats zero characters as empty and removes the object with it', () => {
    const { doc } = trackedDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test') as string;

    expect(isEmptyText(doc, id)).toBe(true);
    expect(deleteIfEmpty(doc, id)).toBe(true);
    expect(objectSnapshots(doc)).toHaveLength(0);
    expect(getText(doc, id)).toBeUndefined();
    // A second attempt on an id that is gone says so rather than throwing.
    expect(deleteIfEmpty(doc, id)).toBe(false);
    expect(isEmptyText(doc, id)).toBe(false);
  });

  it('keeps whitespace-only text: only zero characters counts as empty', () => {
    const { doc } = trackedDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test') as string;
    const ytext = getText(doc, id);
    if (!ytext) throw new Error('the text container is missing');

    doc.transact(() => ytext.insert(0, '  '), LOCAL_ORIGIN);
    expect(isEmptyText(doc, id)).toBe(false);
    expect(deleteIfEmpty(doc, id)).toBe(false);
    expect(objectSnapshots(doc)).toHaveLength(1);
  });
});

describe('text.model: the character limit', () => {
  it('TC-05 keeps the first 5,000 characters and accepts 4,999 plus one', () => {
    expect(clampToLimit('x'.repeat(TEXT_MAX_CHARS + 1), TEXT_MAX_CHARS)).toHaveLength(
      TEXT_MAX_CHARS,
    );
    expect(clampToLimit('x'.repeat(TEXT_MAX_CHARS), TEXT_MAX_CHARS)).toHaveLength(TEXT_MAX_CHARS);
    const atLimit = `${'x'.repeat(TEXT_MAX_CHARS - 1)}y`;
    expect(clampToLimit(atLimit, TEXT_MAX_CHARS)).toBe(atLimit);
    // A character over the limit is not added, not even at the end.
    expect(clampToLimit(atLimit, TEXT_MAX_CHARS)).not.toContain('z');
  });

  it('writes a difference into a Y.Text without touching what is already there', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createText(doc, { x: 0, y: 0 }, 'g_test') as string;
    const ytext = getText(doc, id);
    if (!ytext) throw new Error('the text container is missing');

    applyTextDiff(ytext, 'Went well', LOCAL_ORIGIN);
    expect(ytext.toString()).toBe('Went well');
    // The same value again is not a change at all.
    expect(countUpdates(doc, () => applyTextDiff(ytext, 'Went well', LOCAL_ORIGIN))).toBe(0);
    applyTextDiff(ytext, 'Went well!\nAnd fast.', LOCAL_ORIGIN);
    expect(ytext.toString()).toBe('Went well!\nAnd fast.');
  });
});

/**
 * A text object behaves like every other object for the generic operations,
 * which is what `text.consistent` promises: the sticky note's default size must
 * not leak into a text object that has no stored box.
 */
describe('text.model: text in the generic snapshot', () => {
  it('reports its own box rather than a sticky note default', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createText(doc, { x: 5, y: 5 }, 'g_test') as string;
    // Take the stored box away, as a client from before this story would leave it.
    const map = rawObject(doc, id);
    doc.transact(() => {
      map?.delete('width');
      map?.delete('height');
    }, LOCAL_ORIGIN);

    const object = objectSnapshots(doc).find((candidate) => candidate.id === id);
    expect(object).toBeDefined();
    expect(object?.width).not.toBe(STICKY_SIZE_WORLD);
    expect(object?.height).not.toBe(STICKY_SIZE_WORLD);
    expect(Number(object?.width)).toBeGreaterThan(0);
    expect(Number(object?.height)).toBeGreaterThan(0);
    expect(highestZ(doc)).toBe(Number(map?.get('z')));
  });
});
