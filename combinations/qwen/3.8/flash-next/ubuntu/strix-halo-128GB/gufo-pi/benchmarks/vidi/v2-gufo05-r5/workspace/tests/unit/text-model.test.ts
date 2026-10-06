/**
 * Text object model unit tests (TC-01 to TC-06) against a real Y.Doc.
 *
 * The contract under test is `text.model`: a text object is `type 'text'` with a stored box,
 * a size preset, an auto/fixed width mode, a shared `Y.Text` and the person who made it. Every
 * accepted change is exactly one `LOCAL_ORIGIN` transaction; every rejection (stale id, unknown
 * size, non-finite number) happens before a transaction is opened, so it produces no update at
 * all.
 */
import * as Y from 'yjs';
import { describe, expect, test } from 'vitest';
import {
  initDoc,
  createSticky,
  snapshot,
  LOCAL_ORIGIN,
  type TextSnapshot,
} from '../../src/shared/board-model';
import {
  createText,
  deleteIfEmpty,
  getTextContent,
  growTextBox,
  isEmptyText,
  setTextBox,
  setTextSize,
  setTextWidthFixed,
} from '../../src/shared/objects/text';
import { applyTextDiff, clampToLimit } from '../../src/shared/text-edit';
import {
  DEFAULT_TEXT_SIZE,
  STICKY_SIZE_WORLD,
  TEXT_MAX_CHARS,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../src/shared/config';

function board(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/** Every update this screen wrote, counted at the document. */
function watchLocalWrites(doc: Y.Doc): { count: number } {
  const seen = { count: 0 };
  doc.on('update', (_update: Uint8Array, origin: unknown) => {
    if (origin === LOCAL_ORIGIN) seen.count += 1;
  });
  return seen;
}

function textOf(doc: Y.Doc, id: string): TextSnapshot | undefined {
  return snapshot(doc).find((obj) => obj.id === id) as TextSnapshot | undefined;
}

describe('text.model.create', () => {
  test('TC-01 createText places a size M auto-width text at the point, on top, owned by the creator', () => {
    const doc = board();
    const note = createSticky(doc, { x: 0, y: 0 });
    const noteZ = snapshot(doc).find((obj) => obj.id === note)!.z;

    const id = createText(doc, { x: 100, y: 50 }, 'g_test');
    expect(id).toBeTruthy();

    const text = textOf(doc, id!);
    expect(text).toBeDefined();
    expect(text!.type).toBe('text');
    expect(text!.x).toBe(100);
    expect(text!.y).toBe(50);
    expect(text!.size).toBe(DEFAULT_TEXT_SIZE);
    expect(text!.widthMode).toBe('auto');
    expect(text!.text).toBe('');
    expect(text!.createdBy).toBe('g_test');
    expect(text!.z).toBeGreaterThan(noteZ);
    // a box exists before anything is measured, so selection bounds are usable
    expect(Number.isFinite(text!.width)).toBe(true);
    expect(Number.isFinite(text!.height)).toBe(true);
    expect(text!.width).toBeGreaterThan(0);
    expect(text!.height).toBeGreaterThan(0);

    // the shared text is a real Y.Text, empty
    const ytext = getTextContent(doc, id!);
    expect(ytext).toBeInstanceOf(Y.Text);
    expect(ytext!.toString()).toBe('');
  });

  test('TC-06 a non-finite create point writes nothing and returns null', () => {
    const doc = board();
    const writes = watchLocalWrites(doc);

    expect(createText(doc, { x: Number.NaN, y: 10 }, 'g_test')).toBeNull();
    expect(createText(doc, { x: 10, y: Number.POSITIVE_INFINITY }, 'g_test')).toBeNull();
    expect(writes.count).toBe(0);
    expect(snapshot(doc)).toHaveLength(0);
  });

  test('a stale id is false for every setter and opens no transaction', () => {
    const doc = board();
    const writes = watchLocalWrites(doc);

    expect(setTextSize(doc, 'gone', 'XL')).toBe(false);
    expect(setTextWidthFixed(doc, 'gone', 300)).toBe(false);
    expect(setTextBox(doc, 'gone', { width: 10, height: 10 })).toBe(false);
    expect(deleteIfEmpty(doc, 'gone')).toBe(false);
    expect(getTextContent(doc, 'gone')).toBeUndefined();
    expect(writes.count).toBe(0);
  });

  test('a sticky note id is not a text object: the setters refuse it', () => {
    const doc = board();
    const note = createSticky(doc, { x: 0, y: 0 });
    const writes = watchLocalWrites(doc);

    expect(setTextSize(doc, note, 'XL')).toBe(false);
    expect(setTextWidthFixed(doc, note, 300)).toBe(false);
    expect(setTextBox(doc, note, { width: 10, height: 10 })).toBe(false);
    expect(getTextContent(doc, note)).toBeUndefined();
    expect(writes.count).toBe(0);
  });
});

describe('text.model.size', () => {
  test('TC-02 setTextSize applies a known preset and refuses an unknown one without a transaction', () => {
    const doc = board();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;

    const writes = watchLocalWrites(doc);
    expect(setTextSize(doc, id, 'XL')).toBe(true);
    expect(writes.count).toBe(1);
    expect(textOf(doc, id)!.size).toBe('XL');

    const before = writes.count;
    expect(setTextSize(doc, id, 'XXL')).toBe(false);
    expect(setTextSize(doc, id, '')).toBe(false);
    expect(setTextSize(doc, id, 'm')).toBe(false);
    expect(writes.count).toBe(before);
    expect(textOf(doc, id)!.size).toBe('XL');
    expect(textOf(doc, id)!.x).toBe(0);
    expect(textOf(doc, id)!.y).toBe(0);
  });

  test('every documented size preset is accepted', () => {
    const doc = board();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    for (const size of Object.keys(TEXT_SIZES)) {
      expect(setTextSize(doc, id, size)).toBe(true);
      expect(textOf(doc, id)!.size).toBe(size);
    }
  });
});

describe('text.model.width', () => {
  test('TC-03 a fixed width below the minimum is clamped up and switches the mode', () => {
    const doc = board();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;

    expect(setTextWidthFixed(doc, id, 30)).toBe(true);
    let text = textOf(doc, id)!;
    expect(text.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(text.widthMode).toBe('fixed');

    // exactly the minimum is kept (boundary)
    expect(setTextWidthFixed(doc, id, TEXT_MIN_WIDTH_WORLD)).toBe(false); // already that box
    expect(setTextWidthFixed(doc, id, 250)).toBe(true);
    text = textOf(doc, id)!;
    expect(text.width).toBe(250);
    expect(text.widthMode).toBe('fixed');
  });

  test('a non-finite width, height or box is refused without a transaction', () => {
    const doc = board();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const writes = watchLocalWrites(doc);

    expect(setTextWidthFixed(doc, id, Number.NaN)).toBe(false);
    expect(setTextWidthFixed(doc, id, Number.POSITIVE_INFINITY)).toBe(false);
    expect(setTextBox(doc, id, { width: Number.NaN, height: 10 })).toBe(false);
    expect(setTextBox(doc, id, { width: 10, height: Number.NaN })).toBe(false);
    expect(writes.count).toBe(0);
  });

  test('setTextBox writes only when the box actually differs', () => {
    const doc = board();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const before = textOf(doc, id)!;

    const writes = watchLocalWrites(doc);
    expect(setTextBox(doc, id, { width: before.width, height: before.height })).toBe(false);
    expect(writes.count).toBe(0);

    // only the key that differs moves, and the height was already right
    const changed: string[] = [];
    doc.getMap<Y.Map<unknown>>('objects').get(id)!.observe((event: Y.YMapEvent<unknown>) => {
      for (const key of event.keys.keys()) changed.push(key);
    });

    expect(setTextBox(doc, id, { width: 120, height: 26 })).toBe(true);
    expect(changed).toEqual(['width']);
    expect(writes.count).toBe(1);
    expect(setTextBox(doc, id, { width: 120, height: 26 })).toBe(false);
    expect(writes.count).toBe(1);
    const after = textOf(doc, id)!;
    expect(after.width).toBe(120);
    expect(after.height).toBe(26);
    // and the position is never part of a box write
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
  });
});

describe('text.model.fit', () => {
  // A screen that drew words its stored box cannot hold grows the box. It never shrinks one and it
  // never rewrites a width a person dragged, so the repair cannot undo anybody's decision - and it
  // is not written as this user's edit, so it is not an undo step either.
  function everyWrite(doc: Y.Doc): unknown[] {
    const origins: unknown[] = [];
    doc.on('update', (_update: Uint8Array, origin: unknown) => origins.push(origin));
    return origins;
  }

  test('a box that already holds the words is not touched at all', () => {
    const doc = board();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const before = textOf(doc, id)!;
    const origins = everyWrite(doc);

    expect(growTextBox(doc, id, { width: before.width, height: before.height }, true)).toBe(false);
    // smaller than the box is somebody else's business, not a repair
    expect(growTextBox(doc, id, { width: 1, height: 1 }, true)).toBe(false);
    expect(origins).toEqual([]);
    expect(textOf(doc, id)).toEqual(before);
  });

  test('a box too small for what a screen drew grows in one transaction that is not a local edit', () => {
    const doc = board();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const before = textOf(doc, id)!;

    const changed: string[] = [];
    doc.getMap<Y.Map<unknown>>('objects').get(id)!.observe((event: Y.YMapEvent<unknown>) => {
      for (const key of event.keys.keys()) changed.push(key);
    });

    const origins = everyWrite(doc);
    expect(growTextBox(doc, id, { width: before.width + 20, height: before.height + 52 }, true)).toBe(
      true,
    );
    expect(origins).toHaveLength(1);
    // the UndoManager follows LOCAL_ORIGIN; a repair is not something a person did, so it stays out
    expect(origins[0]).not.toBe(LOCAL_ORIGIN);
    expect(changed.sort()).toEqual(['height', 'width']);

    const after = textOf(doc, id)!;
    expect(after.width).toBe(before.width + 20);
    expect(after.height).toBe(before.height + 52);
    expect(after.x).toBe(before.x);
    expect(after.text).toBe('');
  });

  test('a fixed width belongs to the person who dragged it: only the height grows', () => {
    const doc = board();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    setTextWidthFixed(doc, id, 140);
    const before = textOf(doc, id)!;
    expect(before.widthMode).toBe('fixed');

    const origins = everyWrite(doc);
    // widen is asked for, and refused: the mode, not the caller, decides
    expect(growTextBox(doc, id, { width: 400, height: before.height + 26 }, true)).toBe(true);
    expect(origins).toHaveLength(1);
    const after = textOf(doc, id)!;
    expect(after.width).toBe(before.width);
    expect(after.widthMode).toBe('fixed');
    expect(after.height).toBe(before.height + 26);
  });

  test('a stale id, a sticky note and a nonsense measurement grow nothing', () => {
    const doc = board();
    const note = createSticky(doc, { x: 0, y: 0 });
    const origins = everyWrite(doc);

    expect(growTextBox(doc, 'missing', { width: 100, height: 100 }, true)).toBe(false);
    expect(growTextBox(doc, note, { width: 100, height: 100 }, true)).toBe(false);
    expect(growTextBox(doc, note, { width: Number.NaN, height: 100 }, true)).toBe(false);
    expect(growTextBox(doc, note, { width: 100, height: Number.POSITIVE_INFINITY }, true)).toBe(false);
    expect(origins).toEqual([]);
  });
});

describe('text.model.empty', () => {
  test('TC-04 zero characters is empty and deleteIfEmpty removes it; whitespace is kept', () => {
    const doc = board();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;

    expect(isEmptyText(doc, id)).toBe(true);
    expect(deleteIfEmpty(doc, id)).toBe(true);
    expect(textOf(doc, id)).toBeUndefined();

    const kept = createText(doc, { x: 10, y: 10 }, 'g_test')!;
    applyTextDiff(getTextContent(doc, kept)!, '   ', LOCAL_ORIGIN);
    expect(isEmptyText(doc, kept)).toBe(false);
    expect(deleteIfEmpty(doc, kept)).toBe(false);
    expect(textOf(doc, kept)).toBeDefined();

    applyTextDiff(getTextContent(doc, kept)!, '', LOCAL_ORIGIN);
    expect(isEmptyText(doc, kept)).toBe(true);
    expect(deleteIfEmpty(doc, kept)).toBe(true);
    expect(textOf(doc, kept)).toBeUndefined();
  });

  test('deleteIfEmpty on a stale id is false and writes nothing', () => {
    const doc = board();
    const writes = watchLocalWrites(doc);
    expect(deleteIfEmpty(doc, 'never-existed')).toBe(false);
    expect(writes.count).toBe(0);
  });
});

describe('text.model.limit', () => {
  test('TC-05 clampToLimit cuts at the limit and accepts one character under it', () => {
    expect(clampToLimit('x'.repeat(5001), TEXT_MAX_CHARS)).toHaveLength(5000);
    expect(clampToLimit(`${'x'.repeat(4999)}y`, TEXT_MAX_CHARS)).toHaveLength(5000);
    expect(clampToLimit('x'.repeat(4999), TEXT_MAX_CHARS)).toHaveLength(4999);
    expect(clampToLimit('x'.repeat(5000), TEXT_MAX_CHARS)).toHaveLength(5000);
    expect(clampToLimit('', TEXT_MAX_CHARS)).toBe('');
  });

  test('clampToLimit never cuts an emoji in half', () => {
    const withEmoji = `${'x'.repeat(4999)}\u{1F600}`;
    const clamped = clampToLimit(withEmoji, TEXT_MAX_CHARS);
    expect(clamped).toHaveLength(4999);
    expect(clamped).toBe('x'.repeat(4999));
  });

  test('applyTextDiff writes the minimal edit into a text object', () => {
    const doc = board();
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const ytext = getTextContent(doc, id)!;

    applyTextDiff(ytext, 'abc', LOCAL_ORIGIN);
    expect(ytext.toString()).toBe('abc');
    applyTextDiff(ytext, 'abXc', LOCAL_ORIGIN);
    expect(ytext.toString()).toBe('abXc');
    applyTextDiff(ytext, 'ab', LOCAL_ORIGIN);
    expect(ytext.toString()).toBe('ab');
    // the box fallback of a created object is a positive size, unrelated to text length
    expect(textOf(doc, id)!.width).toBeGreaterThan(0);
  });
});

describe('text.model.snapshot', () => {
  test('a board without text objects is unaffected, and unknown types are skipped', () => {
    const doc = board();
    const note = createSticky(doc, { x: 0, y: 0 });
    expect(snapshot(doc).map((obj) => obj.id)).toEqual([note]);

    // an object of a type this build does not know is skipped rather than crashing the board
    doc.getMap<Y.Map<unknown>>('objects').set('weird', new Y.Map([['type', 'from-the-future']]));
    expect(snapshot(doc).map((obj) => obj.id)).toEqual([note]);
  });

  test('text and sticky objects share one render order', () => {
    const doc = board();
    const note = createSticky(doc, { x: 0, y: 0 });
    const text = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const order = snapshot(doc).map((obj) => obj.id);
    expect(order).toEqual([note, text]);
    expect(snapshot(doc).find((obj) => obj.id === text)!.type).toBe('text');
    expect(snapshot(doc).find((obj) => obj.id === note)!.type).toBe('sticky');
    // the fallback box of a note is the square, and STICKY_SIZE_WORLD is that square
    expect(snapshot(doc).find((obj) => obj.id === note)!.width ?? STICKY_SIZE_WORLD).toBe(
      STICKY_SIZE_WORLD,
    );
  });
});
