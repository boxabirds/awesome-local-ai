/**
 * TC-19 to TC-25 — a piece of text on the board, and the things it owes the person who wrote it.
 *
 * A text object owns very little: a place, a size preset, a width mode, and some words. Everything else
 * about it is decided by something else — its height comes out of its words, its words come out of
 * whoever is typing, its box comes out of a measurement, its place in the history comes out of a capture
 * window, and what is drawn on four other screens comes out of what this one wrote. So these tests are
 * mostly about borders: where the object stops and the layout begins, where my typing stops and somebody
 * else's begins, where one thing a person did stops and the next one starts.
 *
 * Two of them are about the object's habit of not existing. A text object left with nothing written in it
 * is taken away — a whole sentence of the PRD, and the exact opposite of the rule this product has had
 * since story 2, where an empty note is kept: a blank note is a place somebody put on the board, a blank
 * text is nothing at all. The other is a delete that arrives from the room while the caret is still in the
 * box being typed into. That is the only way an editor on this board gets taken away from underneath
 * somebody, and the only one where "the document no longer holds that object" is not allowed to turn into
 * a crash.
 *
 * The numbers are the board's own, not hand-written pixels: widths come out of the settings, from the
 * estimate this environment falls back to when it has no canvas to ask — half a character width per
 * character. Positions are always asked for through the camera the board is drawing with, so a test that
 * puts a pointer on an object is putting it where that object is actually drawn.
 */
import { describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import * as Y from 'yjs';

import { screenToWorld } from '../../src/client/canvas/camera';
import {
  OBJECTS_MAP,
  getStickyText,
  isTextSnapshot,
  objectBounds,
  snapshot as readSnapshot,
} from '../../src/shared/board-model';
import type { Rect } from '../../src/shared/geometry';
import {
  STICKY_SIZE_WORLD,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MAX_CHARS,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../src/shared/config';
import { unionRects } from '../../src/shared/geometry';
import { TEXT_GLYPH_WIDTH_RATIO, type TextSnapshot } from '../../src/shared/objects/text';
import {
  act,
  board,
  nextFrame,
  pointer,
  renderBoard,
  renderedCamera,
  type BoardFixture,
} from './harness';

/* ------------------------------------------------------------------ the small print */
/** What this environment measures a string at: half a character width per character. */
const widthOf = (text: string, size: keyof typeof TEXT_SIZES = 'M'): number =>
  text.length * TEXT_SIZES[size] * TEXT_GLYPH_WIDTH_RATIO;

/** Presses a key where the board listens, and says whether the board swallowed it. */
async function key(k: string, target: Window | Element = window): Promise<boolean> {
  let swallowed: boolean = true;
  await act(async () => {
    swallowed = !fireEvent.keyDown(target, { key: k });
    await nextFrame();
  });
  return swallowed;
}

/** A press, a release, and the click a browser makes out of them. */
async function tap(target: HTMLElement, point = { x: 0, y: 0 }): Promise<void> {
  pointer('pointerDown', target, point);
  pointer('pointerUp', target, point);
  await act(async () => {
    fireEvent.click(target, { clientX: point.x, clientY: point.y });
    await nextFrame();
  });
}

const tapBoard = (point = { x: 320, y: 240 }): Promise<void> => tap(board(), point);

/** Types into the open text box, one change event, the way a keyboard does. */
async function type(text: string): Promise<void> {
  const el = editorEl();
  await act(async () => {
    fireEvent.change(el, { target: { value: `${el.value}${text}` } });
    await nextFrame();
  });
}

/** Replaces what the open box holds, the way a paste does. */
async function paste(value: string): Promise<void> {
  await act(async () => {
    fireEvent.change(editorEl(), { target: { value } });
    await nextFrame();
  });
}

const editorEl = (): HTMLTextAreaElement => screen.getByTestId('text-editor') as HTMLTextAreaElement;

/** Asks the board for a text object and writes the words that came to be written. */
async function place(fixture: BoardFixture, point = { x: 320, y: 240 }, text = ''): Promise<string> {
  await key('t');
  await tapBoard(point);
  const id = fixture.selection().selectedId;
  if (typeof id !== 'string') throw new Error('placing text at that point selected nothing');
  if (text !== '') await type(text);
  return id;
}

/** Asks for a text object, writes it, and finishes with it: an object to select, not to type into. */
async function placeAndClose(
  fixture: BoardFixture,
  point: { x: number; y: number },
  text: string,
): Promise<string> {
  const id = await place(fixture, point, text);
  await key('Escape', editorEl());
  return id;
}

/** The text object as the document holds it. */
function textOf(fixture: BoardFixture, id: string): TextSnapshot {
  const object = fixture.objects().find((candidate) => candidate.id === id);
  if (object === undefined || !isTextSnapshot(object)) throw new Error(`no text object ${id} on the board`);
  return object;
}

/** The text object with this id, or nothing when the board has no such text. */
function textOrNull(fixture: BoardFixture, id: string): TextSnapshot | undefined {
  const object = fixture.objects().find((candidate) => candidate.id === id);
  return object !== undefined && isTextSnapshot(object) ? object : undefined;
}

/** Any object the board still holds, by id. */
function objectOf(fixture: BoardFixture, id: string) {
  const object = readSnapshot(fixture.doc()).find((candidate) => candidate.id === id);
  if (object === undefined) throw new Error(`object ${id} is not on the board`);
  return object;
}

/** The box the document holds, which is the box every screen draws. */
function boxOf(fixture: BoardFixture, id: string): { width: number; height: number } {
  const object = textOf(fixture, id);
  return { width: object.width ?? Number.NaN, height: object.height ?? Number.NaN };
}

/** The same box as the board drew it, read back off the element. */
function drawnBox(fixture: BoardFixture, id: string): { width: number; height: number } {
  const bounds = fixture.boundsOf(id);
  return { width: bounds.width, height: bounds.height };
}

/** The number of lines the stored height is made of, or nothing when it is not a whole number of them. */
function linesOf(height: number, size: keyof typeof TEXT_SIZES = 'M'): number {
  const lines = Math.round(height / (TEXT_SIZES[size] * TEXT_LINE_HEIGHT));
  expect(height).toBeCloseTo(lines * TEXT_SIZES[size] * TEXT_LINE_HEIGHT, 3);
  return lines;
}

/** Where the objects in the selection are, together. */
function selectionBox(fixture: BoardFixture): Rect {
  const selected = fixture.objects().filter((object) => fixture.selection().ids.has(object.id));
  const box = unionRects(selected.map(objectBounds));
  if (box === null) throw new Error('nothing is selected, so there is no box');
  return box;
}

/** Where a note centred on a world point starts. */
const centred = (x: number, y: number): { x: number; y: number } => ({
  x: x - STICKY_SIZE_WORLD / 2,
  y: y - STICKY_SIZE_WORLD / 2,
});

const worldAt = (point: { x: number; y: number }) => screenToWorld(renderedCamera(), point);

/** Writes as somebody else: a transaction that did not come from this board. */
async function bySomebodyElse(doc: Y.Doc, write: () => void): Promise<void> {
  await act(async () => {
    doc.transact(write);
    await nextFrame();
  });
}

/**
 * The distance between two objects, measured from the left edge of the one named first.
 *
 * A group scaled by one number keeps every distance inside it scaled by that number, so a gap like this
 * one is the group's scale in the only form a test can read off the board without repeating the gesture's
 * own arithmetic back at it.
 */
function gap(fixture: BoardFixture, from: string, to: string): number {
  return objectBounds(objectOf(fixture, to)).x - objectBounds(objectOf(fixture, from)).x;
}

/* ------------------------------------------------------------------ the object, typed into */

describe('a piece of text on the board', () => {
  it('TC-19 opens with the caret where the typing goes on, and keeps Enter for a newline', async () => {
    const fixture = renderBoard();
    const id = await place(fixture, { x: 320, y: 240 }, 'Went well');

    // Somebody who asks to write a thing has already decided what they will do next: type. So the box
    // opens with the caret after the last character and not before the first, and with the focus.
    const editor = editorEl();
    expect(editor.value).toBe('Went well');
    expect(document.activeElement).toBe(editor);
    expect(editor.selectionStart).toBe('Went well'.length);
    expect(editor.selectionEnd).toBe('Went well'.length);

    // A heading is more than one line long and the board offers no other way to say so: Enter is not a
    // close-this key here. It is not swallowed either — putting the newline in the box is the browser's
    // job, and what the browser puts in the box is what the document is told about.
    let newline: boolean = true;
    await act(async () => {
      newline = !fireEvent.keyDown(editor, { key: 'Enter', code: 'Enter' });
      await nextFrame();
    });
    expect(newline).toBe(false);
    expect(fixture.selection().editingId).toBe(id);
    expect(textOf(fixture, id).text).toBe('Went well');

    await type('\nand so did the rest');
    const written = 'Went well\nand so did the rest';
    expect(textOf(fixture, id).text).toBe(written);
    // Two lines now, and the box in the document says two lines: the words are the only thing that has
    // changed the shape of this object.
    expect(linesOf(boxOf(fixture, id).height)).toBe(2);

    // Escape is the board's key and it means "these words are finished": they are kept, the object is
    // kept, and the object is what is selected afterwards — so the next thing this person does is to the
    // text they just wrote, not to the empty board behind it.
    expect(await key('Escape', editor)).toBe(true);
    expect(screen.queryByTestId('text-editor')).toBeNull();
    expect(textOf(fixture, id).text).toBe(written);
    expect(fixture.selection().editingId).toBeNull();
    expect(fixture.selection().selectedId).toBe(id);
    expect((fixture.objectEl(id) as HTMLElement).dataset['interaction']).toBe('selected');

    // And it opens again where it left off: at the end of what is there now.
    const at = fixture.screenOf(id);
    await tap(fixture.objectEl(id) as HTMLElement, at);
    expect(fixture.selection().editingId).toBeNull();
    await act(async () => {
      fireEvent.dblClick(fixture.objectEl(id) as HTMLElement, { clientX: at.x, clientY: at.y });
      await nextFrame();
    });
    expect(editorEl().selectionStart).toBe(written.length);
  });

  it('TC-20 takes away the text that was left with nothing written in it', async () => {
    const fixture = renderBoard();

    // Placed and never typed into. The click that put it down asked for a box to write in; a box that was
    // never written in is not a thing to leave on a shared board. It goes, and the selection goes with it,
    // because an object that is not there cannot be pointing at anything.
    const empty = await place(fixture, { x: 300, y: 220 });
    expect(fixture.objects()).toHaveLength(1);
    await key('Escape', editorEl());
    expect(fixture.objects()).toHaveLength(0);
    expect(fixture.objectEl(empty)).toBeNull();
    expect(fixture.selection().size).toBe(0);
    expect(fixture.selection().editingId).toBeNull();

    // Spaces and newlines are characters somebody typed. The rule is about characters — "ending editing
    // with no characters removes the text object" — and a box full of blanks is not a box that was never
    // written in: it is a box whose words happen to be blanks, and the object that was never written in is
    // the one that goes. Measuring it is the same as measuring anything else: two lines, three characters
    // at their widest.
    const blanks = await place(fixture, { x: 320, y: 240 }, '   \n  ');
    await key('Escape', editorEl());
    expect(textOf(fixture, blanks).text).toBe('   \n  ');
    expect(linesOf(boxOf(fixture, blanks).height)).toBe(2);

    // A word with a space around it is a thing somebody wrote. The spaces stay: the board keeps the text
    // as it was typed, and the person who wrote "hi " may have a reason.
    const kept = await place(fixture, { x: 340, y: 260 }, ' hi ');
    await key('Escape', editorEl());
    expect(textOf(fixture, kept).text).toBe(' hi ');
    expect(drawnBox(fixture, kept).width).toBeCloseTo(widthOf(' hi '), 6);

    // The rule is the text object's and not the board's: a sticky note left empty stays exactly where it
    // was, because a blank note is a place somebody put on the board.
    await key('n');
    // The note the key made, found by what it is rather than by the selection: the text object written a
    // moment ago is still in the selection too, and a piece of paper of one's own is what is being asked
    // about here.
    const note = (fixture.notes()[0] as { id: string }).id;
    await key('Escape', screen.getByTestId('sticky-editor'));
    expect(fixture.notes()).toHaveLength(1);
    expect(getStickyText(fixture.doc(), note)?.toString()).toBe('');
    expect(fixture.objectEl(note)).toBeTruthy();
  });

  it('TC-21 says how big it is in a bar of four sizes, and gets bigger when asked', async () => {
    const fixture = renderBoard();
    const id = await placeAndClose(fixture, { x: 320, y: 240 }, 'Big');

    // One text object selected: the bar is the four sizes and a bin, in the place the board puts a bar,
    // and the size it is drawn at is the size that reads as pressed.
    expect(fixture.barEl()?.dataset['objectType']).toBe('text');
    expect(screen.getByTestId('text-toolbar')).toBeTruthy();
    expect(screen.getByTestId('text-size-M').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('text-size-S').getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByTestId('text-size-XL').getAttribute('aria-pressed')).toBe('false');

    const before = boxOf(fixture, id);
    expect(before.width).toBeCloseTo(widthOf('Big'), 6);

    await tap(screen.getByTestId('text-size-XL') as HTMLElement);
    const after = textOf(fixture, id);
    expect(after.size).toBe('XL');
    // The same words, bigger: the width is those words measured at the new size and the height is one
    // line at the new size. Nobody was asked to re-measure — the size change is the measurement's input.
    expect(after.width).toBeCloseTo(widthOf('Big', 'XL'), 6);
    expect(after.height).toBeCloseTo(TEXT_SIZES.XL * TEXT_LINE_HEIGHT, 6);
    expect(linesOf(boxOf(fixture, id).height, 'XL')).toBe(1);
    expect(screen.getByTestId('text-size-XL').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('text-size-M').getAttribute('aria-pressed')).toBe('false');
    // The board draws what the document holds, at the font size the preset says.
    const drawn = fixture.objectEl(id) as HTMLElement;
    expect(drawn.dataset['size']).toBe('XL');
    expect(drawnBox(fixture, id).width).toBeCloseTo(widthOf('Big', 'XL'), 6);

    // One press of undo takes back the one thing that was done: the size, and the box that was measured
    // from it with it. A person who changed their mind about a heading does not undo their words too.
    await tap(screen.getByTestId('undo') as HTMLElement);
    expect(textOf(fixture, id).size).toBe('M');
    expect(boxOf(fixture, id)).toEqual(before);
    await tap(screen.getByTestId('redo') as HTMLElement);
    expect(textOf(fixture, id).size).toBe('XL');
  });

  it('TC-21 bins the text it is hanging over and nothing else', async () => {
    const fixture = renderBoard();
    const note = await fixture.create(600, 400);
    const id = await placeAndClose(fixture, { x: 320, y: 240 }, 'throw me away');

    await tap(screen.getByTestId('delete-text') as HTMLElement);

    expect(textOrNull(fixture, id)).toBeUndefined();
    expect(fixture.objects()).toHaveLength(1);
    expect(fixture.notes()).toHaveLength(1);
    expect(fixture.selection().size).toBe(0);
    expect(screen.queryByTestId('text-toolbar')).toBeNull();
    // The note is where it was and the same colour it was: the bin took the text and not the board.
    const still = objectBounds(objectOf(fixture, note));
    expect(still.x).toBeCloseTo(centred(600, 400).x, 6);
    expect(still.width).toBeCloseTo(STICKY_SIZE_WORLD, 6);
  });

  it('TC-21 keeps the bar about one object, and goes back to counting for two', async () => {
    const fixture = renderBoard();
    const id = await place(fixture, { x: 320, y: 240 }, 'a heading');

    // The bar is offered while the caret is in the object: making a heading bigger is something a person
    // decides while they are looking at it, and taking them out of the text to do it would be a strange
    // price for a font size.
    expect(screen.getByTestId('text-toolbar')).toBeTruthy();
    await key('Escape', editorEl());
    expect(screen.getByTestId('text-toolbar')).toBeTruthy();

    // Two objects selected is no longer a question about the size of one of them, so the four buttons go
    // away and the group's count comes back: a bar that applied a size to two things at once would be a
    // bar about neither.
    const other = await place(fixture, { x: 780, y: 560 }, 'another');
    await key('Escape', editorEl());
    expect(fixture.selection().size).toBe(1);
    expect(other).toBeTruthy();
    await fixture.shiftClick(id, fixture.screenOf(id));
    expect(fixture.selection().size).toBe(2);
    expect(screen.queryByTestId('text-toolbar')).toBeNull();
    expect(fixture.barText()).toBe('2 selected');
  });

  /* ------------------------------------------------------------------ what a handle may give it */

  it('TC-22 offers a piece of text the two handles it has any use for', async () => {
    const fixture = renderBoard();
    const id = await placeAndClose(fixture, { x: 320, y: 240 }, 'one line');

    // A handle on the top or bottom edge of a thing whose height is the number of lines it makes is an
    // offer this board cannot keep: the next keystroke would take it back. So the box around one piece of
    // text has the handles on its sides, which is the only thing a handle can give it, and says so.
    expect(fixture.handles()).toEqual(['w', 'e']);
    const overlay = fixture.overlayEl() as HTMLElement;
    expect(overlay.dataset['handles']).toBe('horizontal');
    expect(overlay.dataset['resizable']).toBe('true');
    expect(screen.queryByTestId('resize-se')).toBeNull();
    expect(screen.queryByTestId('resize-n')).toBeNull();
    // and the size of the words is not something a handle was ever going to change.
    expect(textOf(fixture, id).size).toBe('M');
  });

  it('TC-22 keeps a width a person pulled for it, and re-wraps the lines into it', async () => {
    const fixture = renderBoard();
    const words = 'one two three four five';
    const id = await placeAndClose(fixture, { x: 320, y: 240 }, words);

    const before = boxOf(fixture, id);
    expect(before.width).toBeCloseTo(widthOf(words), 6);
    expect(linesOf(before.height)).toBe(1);

    // A pull inwards on the east handle, with nothing else selected: this is not a group being scaled, this
    // is somebody saying how wide the column should be.
    await fixture.dragHandle('e', { x: 700, y: 400 }, { x: 600, y: 400 });

    const after = textOf(fixture, id);
    const afterBox = boxOf(fixture, id);
    // 100 screen pixels in, at this camera's zoom, is 100 world units off the width.
    expect(afterBox.width).toBeCloseTo(widthOf(words) - 100, 4);
    // The words are the words; the lines they make are more than one now, and the stored height is exactly
    // that many lines. Nobody was asked to wrap anything: the width was chosen and the wrapping follows.
    expect(after.text).toBe(words);
    expect(linesOf(afterBox.height)).toBeGreaterThan(1);
    // It keeps that width over the lines that follow, which is the whole difference between a text object
    // that has been sized and one that has not.
    expect(after.widthMode).toBe('fixed');
    // The size of the writing is nobody's business but the bar of four buttons'.
    expect(after.size).toBe('M');
    expect(drawnBox(fixture, id).width).toBeCloseTo(afterBox.width, 4);

    // The other handle does the same job from the other side: narrower still, and it is the left edge that
    // gives way, not the right one that was already where the person left it.
    await fixture.dragHandle('w', { x: 700, y: 400 }, { x: 740, y: 400 });
    const shrunk = textOf(fixture, id);
    expect(shrunk.widthMode).toBe('fixed');
    expect(boxOf(fixture, id).width).toBeLessThan(afterBox.width);
    expect(linesOf(boxOf(fixture, id).height)).toBeGreaterThan(1);
  });

  it('TC-22 stops a column at the width the settings say is too narrow to read', async () => {
    const fixture = renderBoard();
    const id = await placeAndClose(fixture, { x: 320, y: 240 }, 'one two three four five');

    // A pull far past the object's own left edge: what is stored is the narrowest column there is — not a
    // negative width, and not the position the pointer happened to stop at.
    await fixture.dragHandle('e', { x: 700, y: 400 }, { x: 100, y: 400 });

    const after = textOf(fixture, id);
    expect(boxOf(fixture, id).width).toBeCloseTo(TEXT_MIN_WIDTH_WORLD, 4);
    expect(after.widthMode).toBe('fixed');
    expect(linesOf(boxOf(fixture, id).height)).toBeGreaterThan(2);
  });

  it('TC-23 gives the handles back when something with them is selected, and only moves the text', async () => {
    const fixture = renderBoard();
    const note = await fixture.create(300, 200);
    const id = await placeAndClose(fixture, { x: 900, y: 520 }, 'a line of words');
    await fixture.shiftClick(note, fixture.screenOf(note));
    expect(fixture.selection().size).toBe(2);

    // A note is in the selection, and a note has eight handles: the box around the two of them has all
    // eight, because that box is the group's and not the text's — and it is the box the two of them fill
    // together, which is the thing a handle drags.
    expect(fixture.handles()).toHaveLength(8);
    const overlay = fixture.overlayEl() as HTMLElement;
    expect(overlay.dataset['handles']).toBe('all');
    const box = selectionBox(fixture);
    expect(Number(overlay.dataset['width'])).toBeCloseTo(box.width, 3);
    expect(Number(overlay.dataset['height'])).toBeCloseTo(box.height, 3);

    const was = new Map(fixture.objects().map((object) => [object.id, objectBounds(object)]));
    await fixture.dragHandle('se', { x: 900, y: 600 }, { x: 1000, y: 700 });
    const now = new Map(fixture.objects().map((object) => [object.id, objectBounds(object)]));

    const noteWas = was.get(note) as Rect;
    const noteNow = now.get(note) as Rect;
    const textWas = was.get(id) as Rect;
    const textNow = now.get(id) as Rect;

    // The note is a square of paper that grew, and the scale it grew by is the group's: one number, which
    // is what everything else in the selection is measured against here.
    expect(noteNow.width).toBeGreaterThan(noteWas.width);
    expect(noteNow.width).toBeCloseTo(noteNow.height, 6);
    const scale = noteNow.width / noteWas.width;
    expect(scale).toBeGreaterThan(1);

    // The text travelled with the rest of them — the space between the two of them is the space it had,
    // scaled — which is what "the layout scales with the box" means for an object that has no size of its
    // own to scale. Its own size is the one thing the drag was not given: its width is what its words made
    // it, and so is the height, and the size of the writing is nobody's business but the bar of four's.
    expect(textNow.x - noteNow.x).toBeCloseTo((textWas.x - noteWas.x) * scale, 3);
    expect(textNow.y - noteNow.y).toBeCloseTo((textWas.y - noteWas.y) * scale, 3);
    expect(textOf(fixture, id).width).toBeCloseTo(textWas.width, 6);
    expect(textOf(fixture, id).height).toBeCloseTo(textWas.height, 6);
    expect(textOf(fixture, id).size).toBe('M');
  });

  it('TC-23 scales a width that was chosen and leaves a width the words chose alone', async () => {
    const fixture = renderBoard();
    const chosen = await placeAndClose(fixture, { x: 260, y: 300 }, 'one two three');
    // Somebody sized this column: it holds a width now, and keeps it over the lines that follow.
    await fixture.dragHandle('e', { x: 700, y: 400 }, { x: 820, y: 400 });
    expect(textOf(fixture, chosen).widthMode).toBe('fixed');

    const words = await placeAndClose(fixture, { x: 700, y: 320 }, 'four five');
    await fixture.shiftClick(chosen, fixture.screenOf(chosen));
    expect(fixture.selection().size).toBe(2);
    // Two things sized by their words are still two things with no use for a handle above them.
    expect(fixture.handles()).toEqual(['w', 'e']);

    const chosenWas = boxOf(fixture, chosen);
    const wordsWas = boxOf(fixture, words);
    const gapWas = gap(fixture, chosen, words);
    expect(gapWas).toBeGreaterThan(0);
    await fixture.dragHandle('e', { x: 900, y: 400 }, { x: 1000, y: 400 });

    // The gap the two of them had is the gap they have now, scaled: that is the group's scale, and this
    // time it is read off the board rather than predicted, so what is being tested is the one thing left
    // to test — that the width somebody chose travels with the group and the width the words chose does
    // not. A width the next keystroke would take back is not a width worth writing.
    const scale = gap(fixture, chosen, words) / gapWas;
    expect(scale).toBeGreaterThan(1);
    expect(boxOf(fixture, chosen).width).toBeCloseTo(chosenWas.width * scale, 3);
    expect(boxOf(fixture, words).width).toBeCloseTo(wordsWas.width, 6);
    // Both are still the two of them they were: one holds a width, the other holds its lines.
    expect(textOf(fixture, words).widthMode).toBe('auto');
    expect(textOf(fixture, chosen).widthMode).toBe('fixed');
  });

  /* ------------------------------------------------------------------ and what is done to it */

  it('TC-24 stops editing a piece of text that somebody else took away', async () => {
    const fixture = renderBoard();
    const doc = fixture.doc();
    const id = await place(fixture, { x: 320, y: 240 }, 'mid-typing');
    expect(screen.getByTestId('text-editor')).toBeTruthy();

    // The caret is in the box and the object is gone from under it: a colleague's delete, or their undo.
    // There is no editor to keep open and nothing left to commit it to, and the board has to go on
    // answering — this is the one way an editor leaves without being asked to, so it may not be the way
    // the board stops working.
    await bySomebodyElse(doc, () => {
      doc.getMap<Y.Map<unknown>>(OBJECTS_MAP).delete(id);
    });

    expect(screen.queryByTestId('text-editor')).toBeNull();
    expect(textOrNull(fixture, id)).toBeUndefined();
    expect(fixture.selection().editingId).toBeNull();
    expect(fixture.selection().ids.has(id)).toBe(false);
    expect(screen.getByTestId('board-toolbar')).toBeTruthy();

    // Nothing was committed on the way out, and the history is no stranger for it: the board still takes
    // text, and still writes one step at a time.
    await tapBoard({ x: 200, y: 620 });
    expect(fixture.selection().size).toBe(0);
    const next = await placeAndClose(fixture, { x: 400, y: 500 }, 'still working');
    expect(textOf(fixture, next).text).toBe('still working');
  });

  it('TC-25 takes back the words and the box they were drawn in as one thing', async () => {
    const fixture = renderBoard();
    const id = await place(fixture, { x: 320, y: 240 });
    const created = boxOf(fixture, id);
    const written = 'a whole line of words, typed at once';

    await type(written);
    const typed = boxOf(fixture, id);
    expect(typed.width).toBeGreaterThan(created.width);
    expect(screen.getByTestId('text-editor')).toBeTruthy();

    // One thing was done here — some words were written — so one press of undo takes it back: the words
    // *and* the box they were drawn in, together. Two steps would mean an undo that leaves the board
    // holding a box of the old size around words that are no longer there, and a second press whose
    // effect nobody can predict.
    await tap(screen.getByTestId('undo') as HTMLElement);
    expect(textOf(fixture, id).text).toBe('');
    expect(boxOf(fixture, id)).toEqual(created);

    // The typing is gone and the object is still on the board: an undo is not a delete, and it does not
    // get to use the rule about empty text, which is a rule about a person finishing with an object.
    expect(fixture.objects()).toHaveLength(1);
    expect(textOrNull(fixture, id)).toBeDefined();

    // The click that placed the object is the step before the typing, and comes apart from it: undoing
    // that one takes the object away, and redoing puts the object back before it puts the words back.
    await tap(screen.getByTestId('undo') as HTMLElement);
    expect(textOrNull(fixture, id)).toBeUndefined();
    await tap(screen.getByTestId('redo') as HTMLElement);
    expect(textOf(fixture, id).text).toBe('');
    expect(boxOf(fixture, id)).toEqual(created);
    await tap(screen.getByTestId('redo') as HTMLElement);
    expect(textOf(fixture, id).text).toBe(written);
    expect(boxOf(fixture, id)).toEqual(typed);
  });

  it('refuses the characters of a paste past five thousand, and the width past the widest column', async () => {
    const fixture = renderBoard();
    const sentence = 'the quick brown fox jumps over the lazy dog ';
    const long = sentence.repeat(Math.ceil(TEXT_MAX_CHARS / sentence.length) + 2);
    const id = await place(fixture, { x: 320, y: 240 }, 'start');

    await paste(long);

    // The limit is how many characters the object holds, not how many the box was offered: the extra ones
    // are not added, and what was there before the paste is gone because the paste replaced it.
    expect(textOf(fixture, id).text).toBe(long.slice(0, TEXT_MAX_CHARS));
    expect(editorEl().value).toHaveLength(TEXT_MAX_CHARS);
    // A thing that long cannot be as wide as its own line: the widest automatic column is the setting, and
    // the height is whatever that many lines asks for.
    const box = boxOf(fixture, id);
    expect(box.width).toBeCloseTo(TEXT_MAX_AUTO_WIDTH_WORLD, 6);
    expect(linesOf(box.height)).toBeGreaterThan(40);
  });

  it('draws the box the document holds, and does not hold it again', async () => {
    const fixture = renderBoard();
    const id = await placeAndClose(fixture, { x: 320, y: 240 }, 'twelve characters');

    const held = boxOf(fixture, id);
    expect(held.width).toBeCloseTo(widthOf('twelve characters'), 6);
    // The element is drawn at the box in the document, not at the box this browser would have chosen:
    // every screen draws the same rectangle because the same numbers are in everybody's document.
    expect(drawnBox(fixture, id)).toEqual(held);

    // A box that arrived from somewhere else is drawn as it came. It is not re-measured on every reload:
    // the board is shared, and an object that rewrote its own box whenever anybody looked at it is traffic
    // that nobody asked for, said slightly differently on every machine.
    const foreign = 'seededtext0000000000000001';
    await fixture.seedObject(foreign, {
      type: 'text',
      x: 100,
      y: 100,
      width: 222,
      height: 333,
      size: 'L',
      widthMode: 'fixed',
      z: 3,
      text: new Y.Text('a box from elsewhere'),
    });
    expect(drawnBox(fixture, foreign)).toEqual({ width: 222, height: 333 });
    expect(textOf(fixture, foreign).widthMode).toBe('fixed');

    const writes = watchingBoxes(fixture);
    await act(async () => {
      await nextFrame();
      await nextFrame();
    });
    expect(writes.count()).toBe(0);
    writes.stop();
    expect(boxOf(fixture, foreign)).toEqual({ width: 222, height: 333 });

    // Even a box that is plainly not the size of the words is left alone until something happens to the
    // words: the person who typed into this object is the one who measures it, and nobody else.
    await fixture.shiftClick(foreign, fixture.screenOf(foreign));
    expect(textOf(fixture, foreign).width).toBe(222);
  });

  it('TC-19 puts the words where the pointer asked for them, and only where it asked', async () => {
    const fixture = renderBoard();
    const point = { x: 480, y: 360 };
    const id = await place(fixture, point, 'exactly here');

    // The top-left of the object is the point that was clicked, not its centre: a person pointing at
    // somewhere to write is pointing at where the words begin.
    const world = worldAt(point);
    const object = textOf(fixture, id);
    expect(object.x).toBeCloseTo(world.x, 6);
    expect(object.y).toBeCloseTo(world.y, 6);
    // Up to the next one: the editor is closed first, because while somebody is writing, keys belong to
    // the writing — which is the rule that keeps a letter from becoming a tool.
    await key('Escape', editorEl());
    // Two clicks are two pieces of text, at two points, and the second did not move the first.
    const second = await placeAndClose(fixture, { x: 520, y: 400 }, 'and here');
    expect(objectBounds(objectOf(fixture, id))).toMatchObject({
      x: world.x,
      y: world.y,
      width: widthOf('exactly here'),
    });
    expect(textOf(fixture, second).x).toBeCloseTo(worldAt({ x: 520, y: 400 }).x, 6);
    expect(textOf(fixture, second).width).toBeCloseTo(widthOf('and here'), 6);
  });
});

/* ------------------------------------------------------------------ a counter for box writes */

/**
 * Counts the writes that change a stored box, from now until asked.
 *
 * It counts boxes that came out different rather than transactions that happened, because that is the
 * question: did this board write something about the size of an object that it was not asked to?
 */
function watchingBoxes(fixture: BoardFixture): { count(): number; stop(): void } {
  const doc = fixture.doc();
  const objects = doc.getMap<Y.Map<unknown>>(OBJECTS_MAP);
  const held = new Map<string, string>();
  const remember = (): void => {
    for (const [id, value] of objects) {
      if (value instanceof Y.Map) held.set(id, `${String(value.get('width'))}x${String(value.get('height'))}`);
    }
  };
  remember();
  let writes = 0;
  const listener = (): void => {
    const before = new Map(held);
    remember();
    for (const [id, box] of held) if (before.get(id) !== box) writes += 1;
  };
  doc.on('update', listener);
  return {
    count: () => writes,
    stop: () => {
      doc.off('update', listener);
    },
  };
}
