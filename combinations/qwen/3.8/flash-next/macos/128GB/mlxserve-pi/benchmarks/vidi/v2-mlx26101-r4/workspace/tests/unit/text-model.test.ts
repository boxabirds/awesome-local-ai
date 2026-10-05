/**
 * Unit tests for the text object model (story 9, `text.model`, TC-01 to TC-06).
 *
 * A real `Y.Doc`, as the story-2 and story-7 model tests use one: the document is the thing under test,
 * and the two questions it has to answer are "what is stored" and "how many transactions did that cost".
 * The second is not a detail — a mutation that writes when it has nothing to say puts a sync message on
 * the wire and an empty step in five people's undo histories, which is why almost every assertion here is
 * paired with a count of updates.
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import {
  LOCAL_ORIGIN,
  createSticky,
  initDoc,
  resizeObjects,
  snapshot,
} from '../../src/shared/board-model';
import {
  DEFAULT_TEXT_SIZE,
  MAX_OBJECT_SIZE_WORLD,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_CHARS,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  type TextSize,
} from '../../src/shared/config';
import { applyTextDiff, clampToLimit } from '../../src/shared/text-edit';
import {
  TEXT_OBJECT_TYPE,
  createText,
  deleteIfEmpty,
  getText,
  getTextContent,
  getTextSize,
  getTextWidthMode,
  isEmptyText,
  isTextSnapshot,
  readText,
  setTextBox,
  setTextSize,
  setTextWidthFixed,
  textLineHeight,
  textSnapshots,
} from '../../src/shared/objects/text';
import { TEXT_AT_LIMIT, TOO_LONG_TEXT, HEADING_TO_IMPROVE, HEADING_WENT_WELL } from '../fixtures/texts';

/** A fresh, initialised document, the way `useBoardDoc` leaves it. */
function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function objectsOf(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('objects');
}

/** Starts counting `update` events; returns a reader of the count. */
function countUpdates(doc: Y.Doc): () => number {
  let updates = 0;
  doc.on('update', () => {
    updates += 1;
  });
  return () => updates;
}

/** A piece of text on the board, with a sticky note underneath it to stack against. */
function withText(doc: Y.Doc = newDoc()): { id: string; text: () => Y.Map<unknown> } {
  const id = createText(doc, { x: 100, y: 50 }, 'g_test');
  if (id === null) throw new Error('the fixture could not put text on the board');
  return {
    id,
    text: () => {
      const object = objectsOf(doc).get(id);
      if (!(object instanceof Y.Map)) throw new Error(`no object with id ${id}`);
      return object;
    },
  };
}

/** A text id that was never created, and cannot be. */
const NO_SUCH_ID = '00000000-0000-4000-8000-000000000000';

describe('text model createText', () => {
  it('TC-01: puts a text object at the point clicked, on top, with the fields a text object has', () => {
    const doc = newDoc();
    const note = createSticky(doc, { x: 400, y: 400 });
    const updates = countUpdates(doc);
    const before = updates();

    const id = createText(doc, { x: 100, y: 50 }, 'g_test');

    expect(id).not.toBeNull();
    // One transaction: one sync message, one undo step.
    expect(updates()).toBe(before + 1);

    const stored = objectsOf(doc).get(id!)!;
    expect(stored.get('type')).toBe(TEXT_OBJECT_TYPE);
    // The *top-left* is where it was clicked: a heading starts where the cursor was, not half a heading
    // further along, which is the one way text is placed differently from a sticky note.
    expect(stored.get('x')).toBe(100);
    expect(stored.get('y')).toBe(50);
    expect(stored.get('size')).toBe('M');
    expect(stored.get('size')).toBe(DEFAULT_TEXT_SIZE);
    expect(stored.get('widthMode')).toBe('auto');
    expect(stored.get('createdBy')).toBe('g_test');
    expect(stored.get('text')).toBeInstanceOf(Y.Text);
    expect((stored.get('text') as Y.Text).toString()).toBe('');

    // On top of everything, whatever "everything" is.
    const z = stored.get('z') as number;
    const noteZ = objectsOf(doc).get(note)!.get('z') as number;
    expect(z).toBeGreaterThan(noteZ);

    // There is a box before anything has been measured, because an object with no size cannot be
    // selected, marqueeed or dragged.
    const read = readText(doc, id!);
    expect(read).not.toBeNull();
    expect(read!.width).toBeGreaterThan(0);
    expect(read!.height).toBe(textLineHeight(DEFAULT_TEXT_SIZE));

    // And it is a text object as far as the board is concerned.
    const reported = snapshot(doc).find((object) => object.id === id!);
    expect(reported).toBeDefined();
    expect(reported!.x).toBe(100);
    expect(isTextSnapshot(reported)).toBe(false); // the generic snapshot does not carry text's fields
    expect(isTextSnapshot(readText(doc, id!))).toBe(true);
  });

  it('TC-06: refuses a point that is not a place on the board, and opens no transaction', () => {
    const doc = newDoc();
    const updates = countUpdates(doc);
    const before = updates();

    for (const at of [
      { x: Number.NaN, y: 50 },
      { x: 100, y: Number.NaN },
      { x: Number.POSITIVE_INFINITY, y: 50 },
      { x: 100, y: Number.NEGATIVE_INFINITY },
      // Not points at all: what a caller that never checked its own arithmetic would hand over.
      { x: undefined, y: 50 },
    ]) {
      expect(createText(doc, at as { x: number; y: number }, 'g_test')).toBeNull();
    }

    expect(updates()).toBe(before);
    expect(objectsOf(doc).size).toBe(0);
  });

  it('stacks each new text above the last, and reports them in stacking order', () => {
    const doc = newDoc();
    const first = createText(doc, { x: 0, y: 0 }, 'g_a')!;
    const second = createText(doc, { x: 10, y: 10 }, 'g_b')!;

    const texts = textSnapshots(doc);
    expect(texts.map((text) => text.id)).toEqual([first, second]);
    expect(texts[1]!.z).toBeGreaterThan(texts[0]!.z);
    expect(texts.map((text) => text.createdBy)).toEqual(['g_a', 'g_b']);
  });
});

describe('text model setTextSize', () => {
  it('TC-02: stores the size key, and refuses a size the board does not have without writing', () => {
    const doc = newDoc();
    const { id, text } = withText(doc);
    const updates = countUpdates(doc);

    expect(setTextSize(doc, id, 'XL')).toBe(true);
    expect(text().get('size')).toBe('XL');
    expect(getTextSize(doc, id)).toBe('XL');
    expect(textLineHeight('XL')).toBe(TEXT_SIZES.XL * TEXT_LINE_HEIGHT);

    const before = updates();
    // An unknown size key is not a size: nothing is written, and the heading keeps the size it had.
    expect(setTextSize(doc, id, 'XXL')).toBe(false);
    expect(setTextSize(doc, id, '')).toBe(false);
    expect(setTextSize(doc, id, 'm')).toBe(false); // the keys are the four names, not any casing of them
    expect(updates()).toBe(before);
    expect(text().get('size')).toBe('XL');

    // The same size again changes nothing, so it costs nothing.
    expect(setTextSize(doc, id, 'XL')).toBe(false);

    // An object that is not there cannot be resized, and a text object's size is not a sticky note's
    // size — a note has no size key at all, and writing one to it would be a field nothing reads.
    expect(setTextSize(doc, NO_SUCH_ID, 'L')).toBe(false);
    const note = createSticky(doc, { x: 0, y: 0 });
    const beforeNote = updates();
    expect(setTextSize(doc, note, 'L')).toBe(false);
    expect(updates()).toBe(beforeNote);
    expect(objectsOf(doc).get(note)!.has('size')).toBe(false);
  });

  it('changes the letters and nothing else: position, stacking, box and words are untouched', () => {
    const doc = newDoc();
    const { id, text } = withText(doc);
    applyTextDiff(getTextContent(doc, id)!, HEADING_WENT_WELL, LOCAL_ORIGIN);
    const before = { ...readText(doc, id)! };

    expect(setTextSize(doc, id, 'XL')).toBe(true);
    const after = readText(doc, id)!;

    expect(after.size).toBe('XL');
    expect(after.text).toBe(HEADING_WENT_WELL);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.z).toBe(before.z);
    expect(after.width).toBe(before.width);
    expect(after.height).toBe(before.height);
    // The box is the caller's business: a bigger text in an unchanged box is what has to be measured.
    expect(after.widthMode).toBe(before.widthMode);
    expect(text().get('size')).toBe('XL');
  });
});

describe('text model setTextWidthFixed', () => {
  it('TC-03: clamps a drag past the narrowest width to it, and puts the object in fixed-width mode', () => {
    const doc = newDoc();
    const { id, text } = withText(doc);

    expect(setTextWidthFixed(doc, id, 30)).toBe(true);
    expect(text().get('width')).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(text().get('widthMode')).toBe('fixed');

    // A width inside the range is taken as asked.
    expect(setTextWidthFixed(doc, id, 250)).toBe(true);
    expect(text().get('width')).toBe(250);

    // The widest object the board accepts is the board's own limit, not text's.
    expect(setTextWidthFixed(doc, id, MAX_OBJECT_SIZE_WORLD * 10)).toBe(true);
    expect(text().get('width')).toBe(MAX_OBJECT_SIZE_WORLD);

    const updates = countUpdates(doc);

    // The same width twice is no width change, so it is no transaction either.
    expect(setTextWidthFixed(doc, id, MAX_OBJECT_SIZE_WORLD)).toBe(false);
    expect(updates()).toBe(0);

    expect(setTextWidthFixed(doc, id, 250)).toBe(true);
    const before = updates();
    expect(setTextWidthFixed(doc, id, 250)).toBe(false);
    expect(updates()).toBe(before);

    // A width that is not a number is refused rather than guessed; a stale id is refused.
    expect(setTextWidthFixed(doc, id, Number.NaN)).toBe(false);
    expect(setTextWidthFixed(doc, id, Number.POSITIVE_INFINITY)).toBe(false);
    expect(setTextWidthFixed(doc, NO_SUCH_ID, 200)).toBe(false);
    expect(updates()).toBe(before);
  });

  it('leaves the words alone, and leaves auto mode for fixed mode only when asked', () => {
    const doc = newDoc();
    const { id } = withText(doc);
    applyTextDiff(getTextContent(doc, id)!, HEADING_TO_IMPROVE, LOCAL_ORIGIN);

    expect(getTextWidthMode(doc, id)).toBe('auto');
    // Exactly the width it already has, but asked for: that *is* a change of mode, and it is written.
    const width = readText(doc, id)!.width;
    expect(setTextWidthFixed(doc, id, width)).toBe(true);
    expect(getTextWidthMode(doc, id)).toBe('fixed');
    expect(getText(doc, id)).toBe(HEADING_TO_IMPROVE);
  });
});

describe('text model setTextBox', () => {
  it('writes a measured box, and writes nothing when the box is already that box', () => {
    const doc = newDoc();
    const { id, text } = withText(doc);
    const updates = countUpdates(doc);

    expect(setTextBox(doc, id, { width: 98, height: 26 })).toBe(true);
    expect(text().get('width')).toBe(98);
    expect(text().get('height')).toBe(26);

    const before = updates();
    expect(setTextBox(doc, id, { width: 98, height: 26 })).toBe(false);
    expect(updates()).toBe(before);
  });

  it('refuses a box that is not a box, and an id that is not text', () => {
    const doc = newDoc();
    const { id } = withText(doc);
    const updates = countUpdates(doc);
    const before = updates();

    for (const box of [
      { width: 0, height: 26 },
      { width: -8, height: 26 },
      { width: 98, height: 0 },
      { width: Number.NaN, height: 26 },
      { width: 98, height: Number.POSITIVE_INFINITY },
      undefined,
    ]) {
      expect(setTextBox(doc, id, box as { width: number; height: number })).toBe(false);
    }
    expect(setTextBox(doc, NO_SUCH_ID, { width: 98, height: 26 })).toBe(false);

    expect(updates()).toBe(before);
    expect(setTextSize(doc, id, 'L')).toBe(true); // the object is untouched and still writable
  });
});

describe('text model empty text', () => {
  it('TC-04: removes text with no characters in it, keeps text that is only whitespace, and says so', () => {
    const doc = newDoc();

    const empty = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    expect(isEmptyText(doc, empty)).toBe(true);
    expect(deleteIfEmpty(doc, empty)).toBe(true);
    expect(objectsOf(doc).has(empty)).toBe(false);
    // A second ask removes nothing, and does not open a transaction to say so.
    expect(deleteIfEmpty(doc, empty)).toBe(false);

    // Spaces and newlines are characters: a person who wrote them put something on the board.
    const whitespace = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    for (const only of [' ', '  ', '\n', ' \n ']) {
      applyTextDiff(getTextContent(doc, whitespace)!, only, LOCAL_ORIGIN);
      expect(isEmptyText(doc, whitespace)).toBe(false);
      expect(deleteIfEmpty(doc, whitespace)).toBe(false);
      expect(objectsOf(doc).has(whitespace)).toBe(true);
    }

    // Text with words in it is never removed by this, whoever asks.
    const written = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    applyTextDiff(getTextContent(doc, written)!, HEADING_WENT_WELL, LOCAL_ORIGIN);
    expect(isEmptyText(doc, written)).toBe(false);
    expect(deleteIfEmpty(doc, written)).toBe(false);
    expect(getText(doc, written)).toBe(HEADING_WENT_WELL);

    // An object that is not there has no characters, and there is nothing to delete.
    expect(isEmptyText(doc, NO_SUCH_ID)).toBe(true);
    expect(deleteIfEmpty(doc, NO_SUCH_ID)).toBe(false);
  });

  it('a text object whose text field went missing is repaired rather than left untypeable', () => {
    const doc = newDoc();
    const { id, text } = withText(doc);
    text().delete('text');

    const repaired = getTextContent(doc, id);
    expect(repaired).toBeInstanceOf(Y.Text);
    expect(repaired!.toString()).toBe('');
    applyTextDiff(repaired!, HEADING_TO_IMPROVE, LOCAL_ORIGIN);
    expect(getText(doc, id)).toBe(HEADING_TO_IMPROVE);

    // A sticky note's text is not a text object's text.
    const note = createSticky(doc, { x: 0, y: 0 });
    expect(getTextContent(doc, note)).toBeUndefined();
  });
});

describe('shared text-edit clampToLimit and applyTextDiff', () => {
  it('TC-05: cuts a paste to the limit and accepts one character up to it', () => {
    expect(TEXT_MAX_CHARS).toBe(5000);

    // 5,001 characters in: 5,000 out, and they are the first 5,000.
    const cut = clampToLimit(TOO_LONG_TEXT, TEXT_MAX_CHARS);
    expect(cut.length).toBe(TEXT_MAX_CHARS);
    expect(cut).toBe(TEXT_AT_LIMIT);

    // 4,999 plus one is 5,000, which is not over the limit and so is not cut at all.
    const lastCharacter = `${TEXT_AT_LIMIT.slice(0, TEXT_MAX_CHARS - 1)}x`;
    expect(lastCharacter.length).toBe(TEXT_MAX_CHARS);
    expect(clampToLimit(lastCharacter, TEXT_MAX_CHARS)).toBe(lastCharacter);

    // Under the limit the text comes back identical, not merely equal, so a caller can compare and skip
    // the write.
    expect(clampToLimit(HEADING_WENT_WELL, TEXT_MAX_CHARS)).toBe(HEADING_WENT_WELL);
    expect(clampToLimit('', TEXT_MAX_CHARS)).toBe('');

    // The limit is a parameter: a sticky note's 1,000 still works on the same function.
    expect(clampToLimit(TOO_LONG_TEXT, 1000).length).toBe(1000);
  });

  it('applyTextDiff writes the difference and nothing else, marked as this client\'s', () => {
    const doc = newDoc();
    const { id } = withText(doc);
    const ytext = getTextContent(doc, id)!;
    const origins: unknown[] = [];
    doc.on('update', (_update: Uint8Array, origin: unknown) => origins.push(origin));

    applyTextDiff(ytext, HEADING_WENT_WELL, LOCAL_ORIGIN);
    expect(ytext.toString()).toBe(HEADING_WENT_WELL);
    expect(origins).toEqual([LOCAL_ORIGIN]);

    // A keystroke at the end is one insert, not a rewrite of the heading.
    applyTextDiff(ytext, `${HEADING_WENT_WELL}!`, LOCAL_ORIGIN);
    expect(origins.length).toBe(2);
    expect(ytext.toString()).toBe(`${HEADING_WENT_WELL}!`);

    // Nothing to change is nothing to write.
    applyTextDiff(ytext, ytext.toString(), LOCAL_ORIGIN);
    expect(origins.length).toBe(2);

    // Text with no document cannot be written to: there is nothing to transact through, and the way that
    // shows up in the caller's world is that the keystroke is dropped rather than the app falling over.
    const detached = new Y.Text();
    expect(detached.doc).toBeNull();
    expect(() => applyTextDiff(detached, 'orphan two', LOCAL_ORIGIN)).not.toThrow();
  });
});

describe('text model reading', () => {
  it('reads an unknown size key as the default size instead of losing the text', () => {
    const doc = newDoc();
    const { id, text } = withText(doc);
    applyTextDiff(getTextContent(doc, id)!, HEADING_WENT_WELL, LOCAL_ORIGIN);

    // Story 13's board stores a size this build has never heard of.
    text().set('size', 'Huge' as TextSize);
    const read = readText(doc, id)!;
    expect(read.size).toBe(DEFAULT_TEXT_SIZE);
    // The words survive: hiding text because its size is a surprise would be the worse answer.
    expect(read.text).toBe(HEADING_WENT_WELL);

    text().set('widthMode', 'content');
    expect(readText(doc, id)!.widthMode).toBe('auto');

    // An object that is not text is not read as text.
    const note = createSticky(doc, { x: 0, y: 0 });
    expect(readText(doc, note)).toBeNull();
    expect(readText(doc, NO_SUCH_ID)).toBeNull();
    expect(textSnapshots(doc).map((entry) => entry.id)).toEqual([id]);
  });

  it('an object with no stored box is one line at the narrowest width, not a sticky note', () => {
    const doc = newDoc();
    const { id, text } = withText(doc);
    text().delete('width');
    text().delete('height');
    // The generic resize puts a note-sized box on it: a stored box is a stored box, whatever put it there.
    expect(resizeObjects(doc, new Map([[id, { x: 0, y: 0, width: 200, height: 200 }]]))).toBe(1);

    const read = readText(doc, id)!;
    expect(read.width).toBe(200);
    expect(read.height).toBe(200);

    text().delete('width');
    expect(readText(doc, id)!.width).toBe(TEXT_MIN_WIDTH_WORLD);
  });
});
