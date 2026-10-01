import { cleanup, fireEvent, screen } from '@testing-library/react';
import type { Doc } from 'yjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { snapshot } from '../../src/shared/board-model';
import { DEFAULT_STICKY_COLOR, DRAG_THRESHOLD_PX, STICKY_COLORS, STICKY_SIZE_WORLD } from '../../src/shared/config';
import {
  createNote,
  flushFrame,
  moveTo,
  noteData,
  noteEl,
  noteEls,
  pressOn,
  releaseOn,
  renderBoard,
  setNoteText,
  surfaceOf,
  textareaEl,
  worldLayerOf,
  CENTRED_TRANSFORM,
  FAR,
} from './helpers';

/**
 * TC-27, TC-28, TC-29: the toolbars. The left toolbar creates a note, the note
 * toolbar recolours without touching anything else and deletes, and no click
 * on a toolbar ever reaches the board.
 */

const NOTE_TEXT = 'Faster onboarding';

let doc: Doc;

beforeEach(() => {
  vi.useFakeTimers();
  doc = renderBoard();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** A note with some text, as a test's subject. */
function subject(x = 0, y = 0): string {
  const id = createNote(doc, x, y);
  setNoteText(doc, id, NOTE_TEXT);
  return id;
}

function clickNote(noteId: string): void {
  pressOn(noteEl(noteId), 100, 100);
  releaseOn(noteEl(noteId), 100, 100);
}

function swatch(colour: string): HTMLElement {
  return screen.getByRole('button', { name: `${colour[0]!.toUpperCase()}${colour.slice(1)} colour` });
}

describe('the note toolbar colour swatches', () => {
  it('TC-27 recolours the note with the pink swatch and keeps it selected', () => {
    const id = subject();
    clickNote(id);
    const before = noteData(doc, id)!;

    fireEvent.click(swatch('pink'));

    expect(noteData(doc, id)?.color).toBe('pink');
    expect(noteEl(id).dataset.selected).toBe('true');
    // Only the colour changed.
    expect(noteData(doc, id)?.text).toBe(before.text);
    expect(noteData(doc, id)?.x).toBe(before.x);
    expect(noteData(doc, id)?.y).toBe(before.y);
    expect(noteData(doc, id)?.z).toBe(before.z);
    // The pressed swatch follows the colour of the note.
    expect(swatch('pink').getAttribute('aria-pressed')).toBe('true');
    expect(swatch('yellow').getAttribute('aria-pressed')).toBe('false');
  });

  it('recolours with every one of the six colours and keeps exactly six swatches', () => {
    const id = subject();
    clickNote(id);

    for (const colour of Object.keys(STICKY_COLORS)) {
      fireEvent.click(swatch(colour));
      expect(noteData(doc, id)?.color).toBe(colour);
    }
    expect(screen.getAllByRole('button', { name: / colour$/ })).toHaveLength(6);
    expect(noteEls()).toHaveLength(1);
  });

  it('keeps the default colour for a note that was never recoloured', () => {
    const id = subject();
    expect(noteData(doc, id)?.color).toBe(DEFAULT_STICKY_COLOR);
    expect(noteEl(id).style.backgroundColor).not.toBe('');
  });

  it('ignores clicks on the toolbar as far as the board is concerned', () => {
    const id = subject();
    clickNote(id);

    // A double-click on a swatch recolours once and does not reach the board,
    // so no second note is created underneath the toolbar.
    const green = swatch('green');
    fireEvent.click(green);
    fireEvent.doubleClick(green);

    expect(noteEls()).toHaveLength(1);
    expect(noteData(doc, id)?.color).toBe('green');
    expect(noteEl(id).dataset.selected).toBe('true');
    expect(worldLayerOf(document.body).style.transform).toBe(CENTRED_TRANSFORM);
  });
});

describe('the note toolbar delete button', () => {
  it('TC-29 removes the note and clears the selection', () => {
    const id = subject();
    clickNote(id);

    fireEvent.click(screen.getByRole('button', { name: 'Delete note' }));

    expect(snapshot(doc)).toEqual([]);
    expect(noteEls()).toEqual([]);
    expect(screen.queryByRole('toolbar', { name: 'Sticky note toolbar' })).toBeNull();
  });

  it('leaves the other notes alone and keeps the board still', () => {
    const other = createNote(doc, 300, 0);
    const id = subject();
    clickNote(id);

    fireEvent.click(screen.getByRole('button', { name: 'Delete note' }));

    expect(snapshot(doc).map((note) => note.id)).toEqual([other]);
    expect(worldLayerOf(document.body).style.transform).toBe(CENTRED_TRANSFORM);
  });
});

describe('the board toolbar', () => {
  it('TC-28 creates a note at the centre of the visible board and opens it for editing', () => {
    // The board is centred on the world origin, so its centre is (0, 0).
    expect(worldLayerOf(document.body).style.transform).toBe(CENTRED_TRANSFORM);

    fireEvent.click(screen.getByRole('button', { name: 'Sticky note' }));

    const notes = snapshot(doc);
    expect(notes).toHaveLength(1);

    // Centred on the viewport centre: the note's top-left is half a size away.
    expect(notes[0]?.x).toBe(-STICKY_SIZE_WORLD / 2);
    expect(notes[0]?.y).toBe(-STICKY_SIZE_WORLD / 2);
    expect(notes[0]?.color).toBe(DEFAULT_STICKY_COLOR);
    const created = notes[0]!.id;
    expect(noteEl(created).dataset.state).toBe('editing');
    expect(noteEl(created).dataset.selected).toBe('true');
    expect(document.activeElement).toBe(textareaEl());
  });

  it('creates a note even when the board is panned far away, and keeps the camera', () => {
    const surface = surfaceOf(document.body);
    pressOn(surface, 640, 400);
    moveTo(surface, 640 - FAR, 400 - FAR / 2);
    releaseOn(surface, 640 - FAR, 400 - FAR / 2);
    flushFrame();
    const transform = worldLayerOf(document.body).style.transform;
    expect(transform).not.toBe(CENTRED_TRANSFORM);

    fireEvent.click(screen.getByRole('button', { name: 'Sticky note' }));
    flushFrame();

    expect(snapshot(doc)).toHaveLength(1);
    expect(noteEls()).toHaveLength(1);
    expect(screen.queryByRole('textbox')).not.toBeNull();
    // Creating a note never moves the board.
    expect(worldLayerOf(document.body).style.transform).toBe(transform);
  });

  it('shows the sticky note tool with its tooltip text', () => {
    const button = screen.getByRole('button', { name: 'Sticky note' });
    expect(button.getAttribute('title')).toBe('Sticky note – or double-click the board');
  });

  it('does not clear the selection of the selected note', () => {
    const id = subject();
    clickNote(id);

    fireEvent.click(screen.getByRole('button', { name: 'Sticky note' }));

    expect(snapshot(doc)).toHaveLength(2);
    // The new note is the selected one; the old note is not selected anymore.
    const created = snapshot(doc).find((note) => note.id !== id)!;
    expect(noteEl(created.id).dataset.selected).toBe('true');
    expect(noteEl(id).dataset.selected).toBe('false');
  });
});

describe('clicking the empty board', () => {
  it('clears the selection but keeps the note and its colour', () => {
    const id = subject();
    clickNote(id);
    fireEvent.click(swatch('blue'));
    const before = noteData(doc, id)!;

    const surface = surfaceOf(document.body);
    pressOn(surface, 300, 300);
    // A press that travels less than the threshold is still a click.
    releaseOn(surface, 300 + DRAG_THRESHOLD_PX - 1, 300);

    expect(noteEl(id).dataset.selected).toBe('false');
    expect(noteData(doc, id)).toEqual(before);
  });

  it('does not clear the selection when the board is panned', () => {
    const id = subject();
    clickNote(id);

    const surface = surfaceOf(document.body);
    pressOn(surface, 300, 300);
    moveTo(surface, 420, 380);
    releaseOn(surface, 420, 380);
    flushFrame();

    expect(noteEl(id).dataset.selected).toBe('true');
    expect(worldLayerOf(document.body).style.transform).not.toBe(CENTRED_TRANSFORM);
  });
});
