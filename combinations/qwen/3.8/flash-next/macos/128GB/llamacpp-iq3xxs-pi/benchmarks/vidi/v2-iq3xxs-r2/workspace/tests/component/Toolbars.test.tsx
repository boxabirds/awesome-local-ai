import { describe, expect, it } from 'vitest';
import { act } from '@testing-library/react';
import { STICKY_COLORS, STICKY_SIZE_WORLD } from '../../src/shared/config';
import {
  VIEWPORT_FIXTURE,
  boardNotes,
  createNote,
  deleteNoteButton,
  editorElement,
  flushFrames,
  getStickyTextFor,
  noteElement,
  notePosition,
  noteToolbarElement,
  readCamera,
  renderBoard,
  selectNote,
  selectedNoteIds,
  stickyToolbarButton,
  swatchButton,
  waitForNotes,
  worldPointAt,
} from './fixtures/board';

function createViaButton(): void {
  act(() => {
    stickyToolbarButton().click();
  });
}

describe('the Sticky note button (TC-28)', () => {
  it('TC-28: with no notes on the board, the button creates one in the middle and starts editing', async () => {
    await renderBoard();
    const button = stickyToolbarButton();
    // Exact UI copy (PRD: left-side vertical toolbar with a "Sticky note" button), with the
    // shortcut story 9 named in brackets next to it.
    expect(button.getAttribute('aria-label')).toBe('Sticky note (N)');
    expect(button.getAttribute('title')).toBe('Sticky note – or double-click the board');
    expect(boardNotes()).toEqual([]);

    createViaButton();
    await flushFrames();
    await waitForNotes(1);

    const [note] = boardNotes();
    // Centred on the middle of the visible board area, whatever the camera.
    const centre = worldPointAt(readCamera(), {
      x: VIEWPORT_FIXTURE.width / 2,
      y: VIEWPORT_FIXTURE.height / 2,
    });
    expect(note.x + STICKY_SIZE_WORLD / 2).toBeCloseTo(centre.x, 6);
    expect(note.y + STICKY_SIZE_WORLD / 2).toBeCloseTo(centre.y, 6);
    expect(note.color).toBe('yellow');
    expect(note.z).toBe(1);
    // It accepts typing straight away, and is selected.
    expect(editorElement()).not.toBeNull();
    expect(selectedNoteIds()).toEqual([note.id]);
  });

  it('each new note from the button lands on top of the ones already there', async () => {
    await renderBoard();
    createViaButton();
    await flushFrames();
    createViaButton();
    await flushFrames();
    await waitForNotes(2);

    const notes = boardNotes();
    expect(notes.map((note) => note.z)).toEqual([1, 2]);
  });

  it('a click on the button never reaches the viewport, so the selection survives', async () => {
    await renderBoard();
    const id = createNote({ x: 0, y: 0 });
    await selectNote(id);

    createViaButton();
    await flushFrames();

    // The new note is now the selected one; the old note is simply still there.
    const created = boardNotes().find((note) => note.id !== id);
    expect(created).toBeDefined();
    expect(selectedNoteIds()).toEqual([created?.id]);
  });
});

describe('the note toolbar colours (TC-27)', () => {
  it('TC-27: clicking the Pink swatch recolours the note and keeps it selected', async () => {
    await renderBoard();
    const id = createNote({ x: 0, y: 0 });
    await selectNote(id);
    const before = notePosition(id);

    const swatches = document.querySelectorAll<HTMLButtonElement>(
      '[data-testid="note-toolbar"] button[aria-label$="colour"]',
    );
    expect(swatches).toHaveLength(6);
    expect(swatchButton('Yellow').getAttribute('aria-pressed')).toBe('true');
    expect(swatchButton('Pink').getAttribute('aria-pressed')).toBe('false');

    act(() => {
      swatchButton('Pink').click();
    });
    await flushFrames();

    expect(notePosition(id).color).toBe('pink');
    expect(noteElement(id).dataset.noteColor).toBe('pink');
    expect(noteElement(id).style.backgroundColor).toBe('rgb(244, 143, 177)');
    // The setting and the painted colour are the same colour (CSS normalises to rgb).
    expect(STICKY_COLORS.pink.toUpperCase()).toBe('#F48FB1');
    expect(swatchButton('Pink').getAttribute('aria-pressed')).toBe('true');
    expect(swatchButton('Yellow').getAttribute('aria-pressed')).toBe('false');
    // Only the colour changed.
    expect(notePosition(id).x).toBe(before.x);
    expect(notePosition(id).y).toBe(before.y);
    expect(notePosition(id).z).toBe(before.z);
    expect(selectedNoteIds()).toEqual([id]);
  });

  it('names every swatch, in the order the design lists them', async () => {
    await renderBoard();
    const id = createNote({ x: 0, y: 0 });
    await selectNote(id);

    const names = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        '[data-testid="note-toolbar"] button[aria-label$="colour"]',
      ),
    ).map((button) => button.getAttribute('aria-label'));
    expect(names).toEqual([
      'Yellow colour',
      'Orange colour',
      'Green colour',
      'Blue colour',
      'Pink colour',
      'Violet colour',
    ]);
    // The toolbar itself is a labelled group.
    expect(noteToolbarElement()?.getAttribute('aria-label')).toBe('Note options');
  });

  it('the note toolbar does not scale with zoom: it is counter-scaled by 1/zoom', async () => {
    await renderBoard();
    const id = createNote({ x: 0, y: 0 });
    act(() => {
      window.__vidi6?.setCamera({ x: -640, y: -400, zoom: 2 });
    });
    await flushFrames();
    expect(readCamera().zoom).toBe(2);
    await selectNote(id);

    const anchor = noteToolbarElement()?.parentElement as HTMLElement | null;
    expect(anchor?.style.transform).toBe('scale(0.5)');
  });
});

describe('the note toolbar delete button (TC-29)', () => {
  it('TC-29: the bin button removes the note and clears the selection', async () => {
    await renderBoard();
    const id = createNote({ x: 0, y: 0 });
    await selectNote(id);
    const button = deleteNoteButton();
    expect(button.getAttribute('aria-label')).toBe('Delete note');
    expect(button.getAttribute('title')).toBe('Delete note');

    act(() => {
      button.click();
    });
    await flushFrames();

    expect(boardNotes()).toEqual([]);
    expect(selectedNoteIds()).toEqual([]);
    expect(noteToolbarElement()).toBeNull();
  });

  it('deleting one note leaves the others and their text alone', async () => {
    await renderBoard();
    const first = createNote({ x: 0, y: 0 });
    const second = createNote({ x: 400, y: 0 });
    await selectNote(second);

    act(() => {
      deleteNoteButton().click();
    });
    await flushFrames();

    expect(boardNotes().map((note) => note.id)).toEqual([first]);
    expect(getStickyTextFor(first)).toBe('');
    expect(selectedNoteIds()).toEqual([]);
  });
});
