import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import type { Doc } from 'yjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteObject, snapshot } from '../../src/shared/board-model';
import { DRAG_THRESHOLD_PX, STICKY_SIZE_WORLD, ZOOM_STEP_FACTOR } from '../../src/shared/config';
import {
  cancelPressOn,
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
  typeInto,
  worldLayerOf,
  CENTRED_TRANSFORM,
} from './helpers';

/**
 * TC-18 - TC-22, TC-25, TC-35 - TC-37: the interaction states of a sticky note
 * (select, drag, deselect, keyboard delete, edit, note deleted underneath an
 * interaction). Pointer events are the kind a browser dispatches.
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

/** Select a note with a short press and release, as a click does. */
function clickNote(id: string, x = 100, y = 100): void {
  const el = noteEl(id);
  pressOn(el, x, y);
  releaseOn(el, x, y);
}

function stateOf(id: string): string {
  return noteEl(id).dataset.state ?? '';
}

function selectedOf(id: string): boolean {
  return noteEl(id).dataset.selected === 'true';
}

describe('selecting a sticky note', () => {
  it('TC-18 selects a note with a short press and keeps the board still', () => {
    const id = createNote(doc, -60, -40);

    pressOn(noteEl(id), 100, 100);
    releaseOn(noteEl(id), 100, 100);

    expect(selectedOf(id)).toBe(true);
    expect(stateOf(id)).toBe('selected');
    // The toolbar of the selected note is rendered.
    expect(screen.getByRole('toolbar', { name: 'Sticky note toolbar' })).toBeTruthy();
    // Nothing is selected besides that one note.
    expect(noteEls().filter((el) => el.dataset.selected === 'true')).toHaveLength(1);
    // The board did not pan: its transform is the centred one from mount.
    expect(worldLayerOf(document.body).style.transform).toBe(CENTRED_TRANSFORM);
    expect(surfaceOf(document.body).dataset.state).toBe('idle');
  });

  it('TC-19 stays selected and unmoved when the press travels under the threshold', () => {
    const id = createNote(doc, 10, 20);
    const before = noteData(doc, id);

    pressOn(noteEl(id), 100, 100);
    moveTo(noteEl(id), 102, 100);
    expect(stateOf(id)).toBe('pressed');
    releaseOn(noteEl(id), 102, 100);

    expect(selectedOf(id)).toBe(true);
    expect(noteData(doc, id)).toEqual(before);
    expect(snapshot(doc)).toHaveLength(1);
  });

  it('TC-20 drags from a press once the threshold is reached, without panning', () => {
    const id = createNote(doc, 10, 20);

    pressOn(noteEl(id), 100, 100);
    moveTo(noteEl(id), 100 + DRAG_THRESHOLD_PX, 100);

    expect(stateOf(id)).toBe('dragging');
    // A press on a note never pans the board, even at the maximum distance.
    expect(worldLayerOf(document.body).style.transform).toBe(CENTRED_TRANSFORM);
    expect(surfaceOf(document.body).dataset.state).toBe('idle');

    moveTo(noteEl(id), 180, 100);
    releaseOn(noteEl(id), 180, 100);
    expect(stateOf(id)).toBe('selected');
  });

  it('TC-21 ends a drag on pointercancel at the position it was last shown at', () => {
    const id = createNote(doc, 10, 20);
    const before = noteData(doc, id)!;

    pressOn(noteEl(id), 100, 100);
    moveTo(noteEl(id), 140, 120);
    flushFrame();
    const shown = noteData(doc, id);
    // 40 and 20 screen pixels at zoom 1 are 40 and 20 board units.
    expect(shown?.x).toBe(before.x + 40);
    expect(shown?.y).toBe(before.y + 20);

    cancelPressOn(noteEl(id));

    expect(stateOf(id)).toBe('selected');
    expect(selectedOf(id)).toBe(true);
    expect(noteData(doc, id)).toEqual(shown);
  });

  it('TC-22 deselects when the empty board is clicked', () => {
    const id = createNote(doc, 10, 20);
    clickNote(id);
    expect(selectedOf(id)).toBe(true);

    const surface = surfaceOf(document.body);
    pressOn(surface, 600, 600);
    releaseOn(surface, 600, 600);

    expect(selectedOf(id)).toBe(false);
    expect(stateOf(id)).toBe('unselected');
    expect(screen.queryByRole('toolbar', { name: 'Sticky note toolbar' })).toBeNull();
  });
});

describe('the selected note and the keyboard', () => {
  it('TC-25 deletes the selected note with Delete and with Backspace', () => {
    for (const key of ['Delete', 'Backspace']) {
      const id = createNote(doc, 10, 20);
      clickNote(id);

      fireEvent.keyDown(window, { key });

      expect(snapshot(doc)).toEqual([]);
      expect(noteEls()).toEqual([]);
      expect(document.querySelector('[data-note-id]')).toBeNull();
    }
  });

  it('TC-36 does nothing when Enter is pressed with nothing selected', () => {
    fireEvent.keyDown(window, { key: 'Enter' });

    expect(snapshot(doc)).toEqual([]);
    expect(noteEls()).toEqual([]);
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('TC-37 ends a drag or an edit when the note is deleted underneath it, and never recreates it', () => {
    // 1. deleted mid-drag
    const dragged = createNote(doc, 10, 20);
    pressOn(noteEl(dragged), 100, 100);
    moveTo(noteEl(dragged), 130, 100);
    expect(stateOf(dragged)).toBe('dragging');

    act(() => {
      deleteObject(doc, dragged);
    });
    // The in-flight frame writes to a note that is gone: nothing throws, and
    // the pointer keeps working on the board the note used to cover.
    flushFrame();
    const surface = surfaceOf(document.body);
    moveTo(surface, 160, 100);
    releaseOn(surface, 160, 100);

    expect(noteEls()).toEqual([]);
    expect(snapshot(doc)).toHaveLength(0);
    expect(document.querySelector('[data-note-id]')).toBeNull();

    // 2. deleted while being edited
    const edited = createNote(doc, 0, 0);
    setNoteText(doc, edited, NOTE_TEXT);
    clickNote(edited);
    fireEvent.keyDown(window, { key: 'Enter' });
    typeInto(screen.getByRole('textbox') as HTMLTextAreaElement, 'typed');

    act(() => {
      deleteObject(doc, edited);
    });
    flushFrame();

    expect(screen.queryByRole('textbox')).toBeNull();
    expect(noteEls()).toEqual([]);
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('TC-35 double-clicks an existing note to edit it without creating another one', () => {
    const id = createNote(doc, -60, -40);
    setNoteText(doc, id, NOTE_TEXT);

    fireEvent.doubleClick(noteEl(id));

    expect(snapshot(doc)).toHaveLength(1);
    expect(noteEls()).toHaveLength(1);
    expect(stateOf(id)).toBe('editing');
    expect(screen.getByRole('textbox')).toBeTruthy();
  });
});

describe('the dragged note and the board', () => {
  it('moves the note in world coordinates, brings it to the front, and selects it on release', () => {
    const first = createNote(doc, 0, 0);
    const second = createNote(doc, 20, 20);
    const before = noteData(doc, second)!;
    expect(snapshot(doc)[0]?.id).toBe(first);

    pressOn(noteEl(second), 100, 100);
    moveTo(noteEl(second), 160, 100);
    flushFrame();

    // It is drawn last, above the note it overlaps.
    expect(snapshot(doc).map((note) => note.id)).toEqual([first, second]);
    expect(noteData(doc, second)?.x).toBe(before.x + 60);

    releaseOn(noteEl(second), 160, 100);
    expect(selectedOf(second)).toBe(true);
    // Only the note moved; the board did not.
    expect(worldLayerOf(document.body).style.transform).toBe(CENTRED_TRANSFORM);
  });

  it('keeps its size in board units while the board is zoomed', () => {
    const id = createNote(doc, 0, 0);
    const el = noteEl(id);
    const size = `${STICKY_SIZE_WORLD}px`;
    expect(el.style.width).toBe(size);
    expect(el.style.height).toBe(size);

    fireEvent.keyDown(window, { key: '+', ctrlKey: true });
    flushFrame();
    expect(el.style.width).toBe(size);
  });

  it('spreads several notes apart without merging them', () => {
    const ids = [createNote(doc, 0, 0), createNote(doc, 220, 0), createNote(doc, 440, 0)];

    pressOn(noteEl(ids[2]!), 100, 100);
    moveTo(noteEl(ids[2]!), 200, 100);
    flushFrame();
    releaseOn(noteEl(ids[2]!), 200, 100);

    expect(noteEls()).toHaveLength(3);
    // Centres are 0, 220 and 440; the third moved 100 board units to the left
    // of nothing: it is still a separate note, 100 further right than before.
    expect(snapshot(doc).map((note) => note.x)).toEqual([-100, 120, 440]);
  });

  it('places the floating toolbar above the note at a constant screen size', () => {
    const id = createNote(doc, 0, 0);
    clickNote(id);
    const toolbar = screen.getByRole('toolbar', { name: 'Sticky note toolbar' }) as HTMLElement;
    // 1 / zoom, so it never scales with the board.
    expect(noteEl(id).style.getPropertyValue('--note-inv-zoom')).toBe('1');
    expect(toolbar.className).toContain('note-toolbar');

    fireEvent.keyDown(window, { key: '+', ctrlKey: true });
    flushFrame();
    expect(noteEl(id).style.getPropertyValue('--note-inv-zoom')).toBe(String(1 / ZOOM_STEP_FACTOR));
  });
});
