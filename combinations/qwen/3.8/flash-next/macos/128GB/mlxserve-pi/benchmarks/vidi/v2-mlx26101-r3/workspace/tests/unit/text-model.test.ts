import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  LOCAL_ORIGIN,
  OBJECTS_MAP,
  createSticky,
  initDoc,
  snapshot,
} from '../../src/shared/board-model';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_CHARS,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  type TextSize,
} from '../../src/shared/config';
import { clampToLimit } from '../../src/shared/text-edit';
import { clampToLimit as stickyClampToLimit } from '../../src/client/objects/StickyText';
import {
  TEXT_TYPE,
  TEXT_SIZE_ORDER,
  asTextSnapshot,
  createText,
  deleteIfEmpty,
  getTextContent,
  isEmptyText,
  setTextBox,
  setTextSize,
  setTextWidthFixed,
} from '../../src/shared/objects/text';
import { proseOfLength } from '../fixtures/texts';

/**
 * text.model unit tests (TC-01 to TC-06) against a **real** `Y.Doc`: the document is the store
 * under test, so nothing is mocked. Every mutation is also counted in `update` events - one per
 * change that was accepted, none for a rejection - because story 3 turns each of those into sync
 * traffic, and a setter that writes what the document already holds is a bug nobody sees on their
 * own screen.
 */

interface Counted<T> {
  result: T;
  updates: number;
  origins: unknown[];
}

/** Run `run` while counting the doc's `update` events and the origins that caused them. */
function countUpdates<T>(doc: Y.Doc, run: () => T): Counted<T> {
  let updates = 0;
  const origins: unknown[] = [];
  const observer = (_update: Uint8Array, origin: unknown): void => {
    updates += 1;
    origins.push(origin);
  };
  doc.on('update', observer);
  try {
    return { result: run(), updates, origins };
  } finally {
    doc.off('update', observer);
  }
}

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function objectsOf(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>(OBJECTS_MAP);
}

function rawObject(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  return objectsOf(doc).get(id);
}

/** The one text object on the board, as the board reads it. */
function onlyText(doc: Y.Doc) {
  const texts = snapshot(doc).filter((object) => object.type === TEXT_TYPE);
  if (texts.length !== 1) {
    throw new Error(`expected exactly one text object, found ${texts.length}`);
  }
  const text = asTextSnapshot(texts[0]);
  if (text === null) {
    throw new Error('the text object on the board does not read as one');
  }
  return text;
}

describe('text.model: createText', () => {
  it('TC-01: creates an empty size M text at the point, above everything else', () => {
    const doc = newDoc();
    // Something already on the board, so "on top" means more than "not zero".
    const sticky = createSticky(doc, { x: 0, y: 0 });
    expect(sticky).not.toBe('');
    expect(snapshot(doc)).toHaveLength(1);

    const { result: id, updates, origins } = countUpdates(doc, () =>
      createText(doc, { x: 100, y: 50 }, 'g_test'),
    );

    expect(id).not.toBeNull();
    expect(id).toBeTruthy();
    expect(updates, 'creating one object is one change').toBe(1);
    expect(origins[0], 'the board writes as itself, which is what undo reads').toBe(LOCAL_ORIGIN);

    const text = onlyText(doc);
    expect(text.id).toBe(id);
    expect(text.type).toBe(TEXT_TYPE);
    // The point is the top-left, not the centre: a heading goes where the pointer was.
    expect(text.x).toBe(100);
    expect(text.y).toBe(50);
    expect(text.size).toBe(DEFAULT_TEXT_SIZE);
    expect(text.size).toBe('M');
    expect(text.widthMode).toBe('auto');
    expect(text.text).toBe('');
    expect(text.z).toBeGreaterThan((snapshot(doc).find((o) => o.id === sticky)?.z ?? 0));
    expect(text.createdBy).toBe('g_test');

    const raw = rawObject(doc, id as string);
    expect(raw?.get('text'), 'the text is a Y.Text, so peers merge into it').toBeInstanceOf(Y.Text);
    expect((raw?.get('text') as Y.Text).length).toBe(0);
    expect(typeof raw?.get('createdAt')).toBe('number');
    // A brand new object has no width of its own, so it starts at the smallest box there is:
    // big enough to be selected, and rewritten by the first keystroke that measures it.
    expect(raw?.get('width')).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(raw?.get('height')).toBe(
      Math.round(TEXT_SIZES[DEFAULT_TEXT_SIZE] * TEXT_LINE_HEIGHT),
    );
  });

  it('stacks each new text above the last, notes included', () => {
    const doc = newDoc();
    const first = createText(doc, { x: 0, y: 0 }, 'me') as string;
    const second = createText(doc, { x: 10, y: 0 }, 'me') as string;
    const note = createSticky(doc, { x: 0, y: 300 });
    const third = createText(doc, { x: 20, y: 0 }, 'me') as string;

    const zOf = (id: string): number => snapshot(doc).find((object) => object.id === id)?.z ?? -1;
    expect(zOf(second)).toBeGreaterThan(zOf(first));
    expect(zOf(third)).toBeGreaterThan(zOf(note));
    expect(zOf(third)).toBeGreaterThan(zOf(second));
  });

  it('TC-06: rejects a point that is not a place on the board, without a transaction', () => {
    const doc = newDoc();
    for (const at of [
      { x: Number.NaN, y: 0 },
      { x: 0, y: Number.NaN },
      { x: Number.POSITIVE_INFINITY, y: 4 },
      { x: 3, y: Number.NEGATIVE_INFINITY },
    ]) {
      const { result, updates } = countUpdates(doc, () => createText(doc, at, 'me'));
      expect(result, `${JSON.stringify(at)} is not a point`).toBeNull();
      expect(updates).toBe(0);
    }
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('rejects an empty author name rather than storing a text nobody made', () => {
    const doc = newDoc();
    const { result, updates } = countUpdates(doc, () => createText(doc, { x: 1, y: 1 }, ''));
    expect(result).toBeNull();
    expect(updates).toBe(0);
  });
});

describe('text.model: setTextSize', () => {
  it('TC-02: takes a size the product offers, and refuses one it does not', () => {
    const doc = newDoc();
    const id = createText(doc, { x: 100, y: 50 }, 'me') as string;

    const applied = countUpdates(doc, () => setTextSize(doc, id, 'XL'));
    expect(applied.result).toBe(true);
    expect(applied.updates).toBe(1);
    expect(onlyText(doc).size).toBe('XL');

    // An unknown size is an error, not a size to round to the nearest one.
    const rejected = countUpdates(doc, () => setTextSize(doc, id, 'XXL' as TextSize));
    expect(rejected.result).toBe(false);
    expect(rejected.updates, 'a rejected write must cost no sync traffic').toBe(0);
    expect(onlyText(doc).size).toBe('XL');

    // The size it already has is not a change.
    expect(countUpdates(doc, () => setTextSize(doc, id, 'XL')).updates).toBe(0);

    // Every size in the toolbar is a size the document can hold.
    for (const size of TEXT_SIZE_ORDER) {
      expect(setTextSize(doc, id, size)).toBe(true);
      expect(onlyText(doc).size).toBe(size);
    }
  });

  it('leaves position, box and text alone when it changes the size', () => {
    const doc = newDoc();
    const id = createText(doc, { x: 100, y: 50 }, 'me') as string;
    setTextWidthFixed(doc, id, 300);
    const before = rawObject(doc, id);
    const beforeText = getTextContent(doc, id) as Y.Text;
    beforeText.insert(0, 'Went well');

    setTextSize(doc, id, 'XL');

    const after = rawObject(doc, id);
    expect(after?.get('x')).toBe(before?.get('x'));
    expect(after?.get('y')).toBe(before?.get('y'));
    expect(after?.get('widthMode')).toBe('fixed');
    expect(after?.get('width')).toBe(300);
    expect(after?.get('text')).toBe(beforeText);
    expect(after?.get('z')).toBe(before?.get('z'));
  });
});

describe('text.model: setTextWidthFixed', () => {
  it('TC-03: clamps a drag past the narrow the product allows, and says the width is fixed', () => {
    const doc = newDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'me') as string;

    const { result, updates } = countUpdates(doc, () => setTextWidthFixed(doc, id, 30));
    expect(result).toBe(true);
    expect(updates).toBe(1);

    const text = onlyText(doc);
    expect(text.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(text.widthMode).toBe('fixed');
  });

  it('keeps a width that is wide enough, and stops being auto', () => {
    const doc = newDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'me') as string;

    expect(setTextWidthFixed(doc, id, 320)).toBe(true);
    expect(onlyText(doc).width).toBe(320);
    expect(onlyText(doc).widthMode).toBe('fixed');

    // Exactly at the limit is legal; the same width twice is not a change.
    expect(setTextWidthFixed(doc, id, TEXT_MIN_WIDTH_WORLD)).toBe(true);
    expect(onlyText(doc).width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(countUpdates(doc, () => setTextWidthFixed(doc, id, TEXT_MIN_WIDTH_WORLD)).updates).toBe(
      0,
    );

    // Auto at the same width is still a change: the mode is the whole point of the gesture.
    doc.transact(() => {
      rawObject(doc, id)?.set('widthMode', 'auto');
      rawObject(doc, id)?.set('width', 200);
    });
    expect(setTextWidthFixed(doc, id, 200)).toBe(true);
    expect(onlyText(doc).widthMode).toBe('fixed');
    expect(onlyText(doc).width).toBe(200);
  });

  it('rejects a width that is not a number, and leaves the box alone', () => {
    const doc = newDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'me') as string;
    setTextWidthFixed(doc, id, 260);

    for (const width of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const { result, updates } = countUpdates(doc, () => setTextWidthFixed(doc, id, width));
      expect(result).toBe(false);
      expect(updates).toBe(0);
    }
    expect(onlyText(doc).width).toBe(260);
  });
});

describe('text.model: setTextBox', () => {
  it('stores a measured box, and writes nothing when the measurement agrees with the document', () => {
    const doc = newDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'me') as string;

    expect(countUpdates(doc, () => setTextBox(doc, id, { width: 120, height: 26 })).result).toBe(
      true,
    );
    expect(countUpdates(doc, () => setTextBox(doc, id, { width: 120, height: 26 })).updates).toBe(0);
    expect(onlyText(doc).width).toBe(120);
    expect(onlyText(doc).height).toBe(26);

    for (const box of [
      { width: 0, height: 26 },
      { width: -4, height: 26 },
      { width: 120, height: 0 },
      { width: Number.NaN, height: 26 },
      { width: 120, height: Number.POSITIVE_INFINITY },
    ]) {
      const { result, updates } = countUpdates(doc, () => setTextBox(doc, id, box));
      expect(result, `${JSON.stringify(box)} is not a box`).toBe(false);
      expect(updates).toBe(0);
    }
    expect(onlyText(doc).width).toBe(120);
  });

  it('leaves the width mode as it was: the box says how big, not how decided', () => {
    const doc = newDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'me') as string;
    setTextWidthFixed(doc, id, 200);
    setTextBox(doc, id, { width: 200, height: 78 });
    const text = onlyText(doc);
    expect(text.widthMode).toBe('fixed');
    expect(text.height).toBe(78);
  });
});

describe('text.model: empty text', () => {
  it('TC-04: removes a text with no characters, and keeps one with whitespace in it', () => {
    const doc = newDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'me') as string;
    expect(isEmptyText(doc, id)).toBe(true);

    const { result, updates } = countUpdates(doc, () => deleteIfEmpty(doc, id));
    expect(result).toBe(true);
    expect(updates).toBe(1);
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('keeps whitespace: a space that was typed is text somebody put there', () => {
    const doc = newDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'me') as string;
    (getTextContent(doc, id) as Y.Text).insert(0, '   ');

    expect(isEmptyText(doc, id)).toBe(false);
    expect(countUpdates(doc, () => deleteIfEmpty(doc, id)).result).toBe(false);
    expect(snapshot(doc)).toHaveLength(1);
  });

  it('counts a text that had something and lost it as empty again', () => {
    const doc = newDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'me') as string;
    const text = getTextContent(doc, id) as Y.Text;
    text.insert(0, 'Went well');
    text.delete(0, 'Went well'.length);

    expect(isEmptyText(doc, id)).toBe(true);
    expect(deleteIfEmpty(doc, id)).toBe(true);
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('is not empty and not deletable when there is no such object', () => {
    const doc = newDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'me') as string;
    deleteIfEmpty(doc, id);

    expect(isEmptyText(doc, id)).toBe(false);
    expect(countUpdates(doc, () => deleteIfEmpty(doc, id)).result).toBe(false);
  });

  it('does not delete a sticky note that happens to be empty', () => {
    const doc = newDoc();
    const note = createSticky(doc, { x: 0, y: 0 });

    expect(isEmptyText(doc, note)).toBe(false);
    expect(countUpdates(doc, () => deleteIfEmpty(doc, note)).result).toBe(false);
    expect(snapshot(doc)).toHaveLength(1);
  });
});

describe('text.model: the length limit', () => {
  it('TC-05: keeps the first 5,000 characters of a longer paste, and all of one character fewer', () => {
    const over = proseOfLength(TEXT_MAX_CHARS + 1);
    const atLimit = proseOfLength(TEXT_MAX_CHARS);
    expect(over).toHaveLength(TEXT_MAX_CHARS + 1);

    expect(clampToLimit(over, TEXT_MAX_CHARS)).toHaveLength(TEXT_MAX_CHARS);
    expect(clampToLimit(over, TEXT_MAX_CHARS)).toBe(atLimit);

    const oneShort = proseOfLength(TEXT_MAX_CHARS - 1);
    expect(clampToLimit(`${oneShort}!`, TEXT_MAX_CHARS)).toHaveLength(TEXT_MAX_CHARS);
    expect(clampToLimit(oneShort, TEXT_MAX_CHARS)).toBe(oneShort);
  });

  it('keeps the whole text when it is inside the limit, and drops half an emoji', () => {
    expect(clampToLimit('Went well', TEXT_MAX_CHARS)).toBe('Went well');
    expect(clampToLimit('', TEXT_MAX_CHARS)).toBe('');
    // A cut that would leave half of a pair behind drops it.
    expect(clampToLimit(`ab\u{1f600}`, 3)).toBe('ab');
    expect(clampToLimit('abcdefghij', 0)).toBe('');
  });

  it('leaves the note its own, shorter limit: the story 2 callers are unchanged', () => {
    const long = proseOfLength(1_200);
    expect(stickyClampToLimit(long)).toHaveLength(1_000);
    expect(stickyClampToLimit('abcdefghij', 4)).toBe('abcd');
    expect(clampToLimit(long, TEXT_MAX_CHARS)).toHaveLength(1_200);
  });
});

describe('text.model: stale ids', () => {
  it('every setter says no to an object that is not on the board, and writes nothing', () => {
    const doc = newDoc();
    const gone = createText(doc, { x: 0, y: 0 }, 'me') as string;
    deleteIfEmpty(doc, gone);
    expect(snapshot(doc)).toHaveLength(0);

    const calls: ((id: string) => unknown)[] = [
      (id) => setTextSize(doc, id, 'L'),
      (id) => setTextWidthFixed(doc, id, 240),
      (id) => setTextBox(doc, id, { width: 240, height: 26 }),
      (id) => deleteIfEmpty(doc, id),
    ];
    for (const call of calls) {
      const { result, updates } = countUpdates(doc, () => call(gone));
      expect(result, 'a stale id is rejected').toBe(false);
      expect(updates, 'and costs no update').toBe(0);
    }
    expect(getTextContent(doc, gone)).toBeUndefined();
    expect(asTextSnapshot(snapshot(doc).find((object) => object.id === gone))).toBeNull();
  });

  it('a text object that a peer wrote without a Y.Text is skipped, not half-drawn', () => {
    const doc = newDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'me') as string;
    // Somebody else's client wrote a broken object: the reader must not crash on it.
    doc.transact(() => {
      rawObject(doc, id)?.set('text', 'not a Y.Text');
    });

    expect(snapshot(doc).filter((object) => object.type === TEXT_TYPE)).toHaveLength(0);
    expect(() => snapshot(doc)).not.toThrow();
  });

  it('a text object with a size or width mode nobody has heard of reads as the default', () => {
    const doc = newDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'me') as string;
    doc.transact(() => {
      const object = rawObject(doc, id);
      object?.set('size', 'XXL');
      object?.set('widthMode', 'diagonal');
    });

    // The geometry is fine, so the object is drawn - at the size the product does have.
    const text = onlyText(doc);
    expect(text.size).toBe(DEFAULT_TEXT_SIZE);
    expect(text.widthMode).toBe('auto');
  });
});

describe('text.model: reading', () => {
  it('reads the text out of the Y.Text, so a client sees what a peer typed', () => {
    const doc = newDoc();
    const id = createText(doc, { x: 0, y: 0 }, 'me') as string;
    (getTextContent(doc, id) as Y.Text).insert(0, 'Went ');
    (getTextContent(doc, id) as Y.Text).insert(5, 'well');

    expect(onlyText(doc).text).toBe('Went well');
  });

  it('reads a text object in draw order alongside the notes', () => {
    const doc = newDoc();
    const note = createSticky(doc, { x: 0, y: 0 });
    const heading = createText(doc, { x: 0, y: -100 }, 'me') as string;

    // The text was made second, so it is on top: draw order is by `z`, whichever type it is.
    expect(snapshot(doc).map((object) => object.id)).toEqual([note, heading]);
  });
});
