// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { snapshot } from '../../src/shared/board-model';
import { DEFAULT_STICKY_COLOR, DRAG_THRESHOLD_PX, STICKY_SIZE_WORLD } from '../../src/shared/config';
import {
  boardDoc,
  boardNotes,
  createNote,
  createNoteViaButton,
  deleteNote,
  dragNote,
  doubleClick,
  editorElement,
  flushFrames,
  getStickyTextFor,
  noteElement,
  noteElements,
  notePosition,
  noteToolbarElement,
  pointerDownOn,
  pointerMoveOn,
  pointerUpOn,
  pressKey,
  readCamera,
  remotePatch,
  remoteSetText,
  renderBoard,
  screenPointOf,
  selectNote,
  selectedNoteIds,
  startEditingNote,
  typeText,
  waitForNotes,
  worldPointAt,
} from './fixtures/board';

/**
 * Integration tests (design): the shipped components over a real Y.Doc.
 *
 * Story 3 owns "two browsers on one document". Until then these stand in for the other
 * browser by changing the document directly and checking what the board renders, and by
 * checking exactly which mutations the board is allowed to make to it.
 */

/** The document as plain data, for "nothing else changed" assertions. */
const doc = () => snapshot(boardDoc());
/** One note of the document, by id. */
const of = (id: string) => {
  const note = doc().find((entry) => entry.id === id);
  if (!note) throw new Error(`no note with id ${id} in the document`);
  return note;
};
/** Where a note's centre sits on screen, from its top-left in the document. */
const centreOf = (note: { x: number; y: number }) =>
  screenPointOf(readCamera(), { x: note.x + STICKY_SIZE_WORLD / 2, y: note.y + STICKY_SIZE_WORLD / 2 });

beforeEach(async () => {
  await renderBoard();
  expect(readCamera().zoom).toBe(1);
});

describe('sticky note creation integration', () => {
  it('both entry points add exactly one sticky with the model defaults', async () => {
    expect(doc()).toEqual([]);

    // The toolbar button: the note lands in the middle of the screen.
    const fromButton = await createNoteViaButton();
    await waitForNotes(1);
    const centre = worldPointAt(readCamera(), { x: 640, y: 400 });
    expect(of(fromButton)).toMatchObject({
      type: 'sticky',
      color: DEFAULT_STICKY_COLOR,
      x: centre.x - STICKY_SIZE_WORLD / 2,
      y: centre.y - STICKY_SIZE_WORLD / 2,
      z: 1,
      text: '',
    });
    // jsdom's CSSOM never grew width/height accessors, so the attribute is read back.
    const declared = noteElement(fromButton).getAttribute('style') ?? '';
    expect(declared).toMatch(new RegExp(`width: ${STICKY_SIZE_WORLD}px`));
    expect(declared).toMatch(new RegExp(`height: ${STICKY_SIZE_WORLD}px`));

    // A double-click on empty board space: the note is centred on the pointer.
    const at = { x: 400, y: 300 };
    const before = new Set(boardNotes().map((note) => note.id));
    doubleClick(at);
    await flushFrames(2);
    await waitForNotes(2);
    const added = boardNotes().filter((note) => !before.has(note.id));
    expect(added).toHaveLength(1);
    const worldAt = worldPointAt(readCamera(), at);
    expect(added[0]).toMatchObject({
      type: 'sticky',
      color: DEFAULT_STICKY_COLOR,
      x: worldAt.x - STICKY_SIZE_WORLD / 2,
      y: worldAt.y - STICKY_SIZE_WORLD / 2,
      text: '',
      z: 2,
    });
  });
});

describe('drag integration', () => {
  it('a drag sequence changes x and y in the document and nothing else', async () => {
    const created = createNote({ x: 200, y: 200 });
    await waitForNotes(1);
    const before = doc();

    await dragNote(created, { x: 60, y: 30 }, 5);

    expect(doc().map((note) => note.id)).toEqual(before.map((note) => note.id));
    expect(of(created)).toEqual({ ...before.find((note) => note.id === created), x: 160, y: 130 });
  });

  it('a pointer sequence that stays under the drag threshold leaves the position untouched', async () => {
    const created = createNote({ x: 200, y: 200 });
    await waitForNotes(1);
    const before = doc();
    const at = centreOf(notePosition(created));
    const element = noteElement(created);

    // Every step stays under the drag threshold, so this is a press, not a drag.
    const wiggle = Math.floor(DRAG_THRESHOLD_PX / 2);
    pointerDownOn(element, at);
    pointerMoveOn(element, { x: at.x + wiggle, y: at.y });
    pointerMoveOn(element, { x: at.x, y: at.y + wiggle });
    pointerUpOn(element, { x: at.x, y: at.y + wiggle });
    await flushFrames(2);

    expect(doc()).toEqual(before);
    expect(selectedNoteIds()).toEqual([created]);
  });

  it('the note keeps moving while the button is down and stops where the last frame saw it', async () => {
    const created = createNote({ x: 200, y: 200 });
    await waitForNotes(1);
    const from = centreOf(notePosition(created));
    const element = noteElement(created);

    pointerDownOn(element, from);
    pointerMoveOn(element, { x: from.x + 40, y: from.y + 20 });
    await flushFrames(1);
    const midway = notePosition(created);
    pointerMoveOn(element, { x: from.x + 100, y: from.y + 60 });
    pointerUpOn(element, { x: from.x + 100, y: from.y + 60 });
    await flushFrames(2);
    const settled = notePosition(created);

    expect(midway.x).toBeCloseTo(140, 6);
    expect(settled.x).toBeCloseTo(200, 6);
    expect(settled.y).toBeCloseTo(160, 6);
    expect(noteElement(created).style.left).toBe(`${settled.x}px`);
  });

  it('a drag on one note leaves every other note exactly where it was', async () => {
    const first = createNote({ x: 200, y: 200 });
    const second = createNote({ x: 900, y: 900 });
    await waitForNotes(2);
    const before = { first: of(first), second: of(second) };

    await dragNote(first, { x: 30, y: -20 }, 4);

    expect(of(second)).toEqual(before.second);
    expect(of(first).x).toBeCloseTo(before.first.x + 30, 6);
    expect(of(first).y).toBeCloseTo(before.first.y - 20, 6);
  });
});

describe('the document is the only shared state', () => {
  it('selecting and editing change nothing in the document', async () => {
    const created = createNote({ x: 200, y: 200 });
    await waitForNotes(1);
    const before = doc();

    await selectNote(created);
    expect(selectedNoteIds()).toEqual([created]);
    expect(doc()).toEqual(before);

    await startEditingNote(created);
    expect(editorElement()).toBeTruthy();
    expect(doc()).toEqual(before);

    pressKey('Escape', editorElement()!);
    await flushFrames();
    expect(selectedNoteIds()).toEqual([created]);
    expect(doc()).toEqual(before);
  });

  it('a change made to the document somewhere else shows up on the board', async () => {
    const created = createNote({ x: 200, y: 200 });
    const other = createNote({ x: 900, y: 900 });
    await waitForNotes(2);

    remotePatch(created, { x: 900, color: 'blue' });
    await flushFrames(2);

    expect(notePosition(created)).toMatchObject({ x: 900, color: 'blue' });
    expect(noteElement(created).dataset.noteColor).toBe('blue');
    expect(noteElement(created).style.left).toBe('900px');
    // The other note, and the number of notes, are unchanged.
    expect(boardNotes().map((note) => note.id).sort()).toEqual([created, other].sort());
  });

  it('a delete made to the document somewhere else removes the note from the board', async () => {
    const created = createNote({ x: 200, y: 200 });
    await waitForNotes(1);
    await selectNote(created);
    expect(noteToolbarElement()).toBeTruthy();

    deleteNote(created);
    await waitForNotes(0);
    expect(noteElements()).toEqual([]);
    expect(noteToolbarElement()).toBeNull();
  });

  it('text written elsewhere is on the note, and typing here writes to the same document', async () => {
    const created = createNote({ x: 200, y: 200 });
    await waitForNotes(1);

    remoteSetText(created, 'from elsewhere');
    await flushFrames(2);
    expect(noteElement(created).textContent).toContain('from elsewhere');
    expect(getStickyTextFor(created)).toBe('from elsewhere');

    await startEditingNote(created);
    expect(editorElement()?.value).toBe('from elsewhere');
    typeText('!');
    await flushFrames(2);
    expect(getStickyTextFor(created)).toBe('from elsewhere!');
  });

  it('a note deleted from the document while it is being edited takes the editor with it', async () => {
    const created = createNote({ x: 200, y: 200 });
    await waitForNotes(1);
    await startEditingNote(created);
    expect(editorElement()).toBeTruthy();

    deleteNote(created);
    await waitForNotes(0);
    expect(editorElement()).toBeNull();
  });
});
