import { describe, expect, it } from 'vitest';
import { within } from '@testing-library/react';
import { flushFrames } from './helpers';
import {
  centreOf,
  clickAt,
  dragWithPointer,
  mountSticky,
  moveTo,
  press,
  pressKey,
  pressKeyIn,
  release,
  viewCentreWorld,
  type MountedSticky,
} from './helpers/sticky';
import { STICKY_COLORS, STICKY_SIZE_WORLD, type StickyColor } from '../../src/shared/config';
import { createSticky, getStickyText, snapshot } from '../../src/shared/board-model';

/**
 * The two toolbars (sticky.toolbar): the board's Sticky note button and the toolbar that
 * floats above a selected note. What is checked is which operation each button performs on
 * the document, and that the toolbars are board UI - a press on them is never a press on
 * the board itself.
 */

const NOTE_AT = { x: -30, y: 70 };

async function oneNote(board: MountedSticky, at = NOTE_AT): Promise<string> {
  const id = createSticky(board.doc, at);
  await flushFrames();
  return id;
}

/** Select the note the way a user does: press and release on it. */
async function selectNote(board: MountedSticky, index = 0): Promise<void> {
  clickAt(board.note(index), board.screenOf(NOTE_AT));
  await flushFrames();
}

describe('sticky.toolbar: the board toolbar', () => {
  it('has a Sticky note button with an accessible name, and is board UI', async () => {
    const board = await mountSticky();

    const button = within(board.view.container).getByRole('button', { name: 'Sticky note (N)' });
    expect(button).toBeTruthy();
    expect(button.closest('[data-board-ui]')).not.toBeNull();
    // The tooltip tells the user the other way to do the same thing.
    expect(button.getAttribute('title')).toBe('Sticky note \u2013 or double-click the board');
  });

  it('TC-28: the button adds a note in the middle of the view and starts typing', async () => {
    const board = await mountSticky();

    clickButton(board, 'Sticky note (N)');
    await flushFrames();

    expect(board.notes()).toHaveLength(1);
    const note = board.notes()[0];
    const centre = viewCentreWorld(board);
    expect(centreOf(board.note())).toEqual(centre);
    expect(note?.x).toBe(centre.x - STICKY_SIZE_WORLD / 2);
    expect(note?.color).toBe('yellow');
    expect(note?.z).toBe(1);
    // Ready for typing straight away, without another click.
    expect(board.editorOrNull()).not.toBeNull();
    expect(board.editor()).toBe(document.activeElement);
  });

  it('TC-28b: notes created twice are stacked one above the other', async () => {
    const board = await mountSticky();

    clickButton(board, 'Sticky note (N)');
    await flushFrames();
    // The first note is being edited; a second one needs the button again.
    clickButton(board, 'Sticky note (N)');
    await flushFrames();

    const notes = board.notes();
    expect(notes).toHaveLength(2);
    expect(notes[0]?.z).toBe(1);
    expect(notes[1]?.z).toBe(2);
    // The newer note is the one being edited, and is the one drawn last in the DOM.
    expect(board.note(1).dataset.noteId).toBe(notes[1]?.id);
  });

  it('TC-28c: after panning far away the new note is still in the middle of the view', async () => {
    const board = await mountSticky();

    await dragWithPointer(board.board, { x: 640, y: 400 }, { x: 120, y: 90 });
    const centre = viewCentreWorld(board);
    expect(Math.abs(centre.x)).toBeGreaterThan(100);

    clickButton(board, 'Sticky note (N)');
    await flushFrames();

    expect(centreOf(board.note())).toEqual(centre);
    // It is on screen: inside the board area at the current zoom.
    const onScreen = board.screenOf(centreOf(board.note()));
    expect(onScreen.x).toBeGreaterThan(0);
    expect(onScreen.x).toBeLessThan(1280);
    expect(onScreen.y).toBeGreaterThan(0);
    expect(onScreen.y).toBeLessThan(800);
  });

  it('TC-28d: a press on the board toolbar does not pan the board', async () => {
    const board = await mountSticky();
    const before = board.camera();
    const toolbar = board.view.container.querySelector<HTMLElement>('[data-testid="board-toolbar"]');
    if (toolbar === null) {
      throw new Error('the board toolbar is missing');
    }

    press(toolbar, { x: 40, y: 40 });
    moveTo(toolbar, { x: 240, y: 240 });
    release(toolbar, { x: 240, y: 240 });
    await flushFrames();

    expect(board.camera()).toEqual(before);
    expect(board.notes()).toHaveLength(0);
  });
});

function clickButton(board: MountedSticky, name: string): void {
  const button = within(board.view.container).getByRole('button', { name });
  button.click();
}

describe('sticky.toolbar: colour and delete on a selected note', () => {
  it('shows six colour swatches, named, with the current colour pressed', async () => {
    const board = await mountSticky();
    await oneNote(board);
    await selectNote(board);

    const toolbar = board.toolbar();
    const swatches = [...toolbar.querySelectorAll<HTMLElement>('[data-testid="note-color"]')];
    expect(swatches).toHaveLength(Object.keys(STICKY_COLORS).length);
    expect(swatches.map((swatch) => swatch.getAttribute('aria-label'))).toEqual([
      'Yellow colour',
      'Orange colour',
      'Green colour',
      'Blue colour',
      'Pink colour',
      'Violet colour',
    ]);
    expect(swatches.map((swatch) => swatch.getAttribute('aria-pressed'))).toEqual([
      'true',
      'false',
      'false',
      'false',
      'false',
      'false',
    ]);
    // A name and a tooltip, so the swatches are not told apart by colour alone.
    expect(swatches[5]?.getAttribute('title')).toBe('Violet colour');
    expect(within(toolbar).getByRole('button', { name: 'Delete note' })).toBeTruthy();
  });

  it('TC-27: clicking a swatch changes only the colour', async () => {
    const board = await mountSticky();
    const id = await oneNote(board);
    await selectNote(board);
    const before = board.notes().find((note) => note.id === id);

    clickButton(board, 'Pink colour');
    await flushFrames();

    const after = board.notes().find((note) => note.id === id);
    expect(after?.color).toBe('pink');
    expect(after?.text).toBe(before?.text);
    expect(after?.x).toBe(before?.x);
    expect(after?.y).toBe(before?.y);
    expect(after?.z).toBe(before?.z);
    // The note stays selected, so its toolbar is still up.
    expect(board.note().dataset.selected).toBe('true');
    expect(board.toolbarOrNull()).not.toBeNull();
    // ...and the new colour is the pressed one.
    const pressed = board.toolbar().querySelectorAll<HTMLElement>('[aria-pressed="true"]');
    expect(pressed).toHaveLength(1);
    expect(pressed[0]?.getAttribute('aria-label')).toBe('Pink colour');
  });

  it('TC-27b: every colour can be chosen, and the note keeps its text', async () => {
    const board = await mountSticky();
    const id = await oneNote(board);
    const ytext = getStickyText(board.doc, id);
    ytext?.insert(0, 'keep me');
    await flushFrames();
    await selectNote(board);

    const colours = Object.keys(STICKY_COLORS) as StickyColor[];
    for (const colour of colours) {
      clickButton(board, `${colour[0]?.toUpperCase()}${colour.slice(1)} colour`);
      await flushFrames();
      expect(board.notes().find((note) => note.id === id)?.color).toBe(colour);
    }
    expect(board.textOf()).toBe('keep me');
  });

  it('TC-29: the delete button removes the note and clears the selection', async () => {
    const board = await mountSticky();
    const id = await oneNote(board);
    await selectNote(board);

    clickButton(board, 'Delete note');
    await flushFrames();

    expect(board.notes()).toHaveLength(0);
    expect(board.noteCount()).toBe(0);
    expect(board.toolbarOrNull()).toBeNull();
    expect(snapshot(board.doc)).toEqual([]);
    expect(getStickyText(board.doc, id)).toBeUndefined();
  });

  it('TC-29b: deleting one of two notes leaves the other on the board, deselected', async () => {
    const board = await mountSticky();
    const first = createSticky(board.doc, { x: 0, y: 0 });
    createSticky(board.doc, { x: 500, y: 0 });
    await flushFrames();

    clickAt(board.note(1), board.screenOf({ x: 500, y: 0 }));
    await flushFrames();
    clickButton(board, 'Delete note');
    await flushFrames();

    expect(board.notes().map((note) => note.id)).toEqual([first]);
    expect(board.note().dataset.selected).toBe('false');
    expect(board.toolbarOrNull()).toBeNull();
  });

  it('TC-29c: the note toolbar is board UI, so a press on it selects nothing else and pans nothing', async () => {
    const board = await mountSticky();
    await oneNote(board);
    await selectNote(board);
    const before = board.camera();

    // Press and drag on the toolbar's own padding, between the buttons.
    press(board.toolbar(), { x: 20, y: 8 });
    moveTo(board.toolbar(), { x: 180, y: 8 });
    release(board.toolbar(), { x: 180, y: 8 });
    await flushFrames();

    expect(board.camera()).toEqual(before);
    expect(board.note().dataset.selected).toBe('true');
  });

  it('TC-29d: the toolbar is hidden while the note is being edited or dragged', async () => {
    const board = await mountSticky();
    await oneNote(board);
    await selectNote(board);
    expect(board.toolbarOrNull()).not.toBeNull();

    pressKey('Enter');
    await flushFrames();
    expect(board.editorOrNull()).not.toBeNull();
    expect(board.toolbarOrNull()).toBeNull();

    pressKeyIn(board.editor(), 'Escape');
    await flushFrames();
    expect(board.toolbarOrNull()).not.toBeNull();

    // While the pointer is down on the note and moving it, there is no toolbar either.
    const at = board.screenOf(NOTE_AT);
    press(board.note(), at);
    moveTo(board.note(), { x: at.x + 40, y: at.y + 40 });
    expect(board.toolbarOrNull()).toBeNull();
    release(board.note(), { x: at.x + 40, y: at.y + 40 });
    await flushFrames();
    expect(board.toolbarOrNull()).not.toBeNull();
  });
});
