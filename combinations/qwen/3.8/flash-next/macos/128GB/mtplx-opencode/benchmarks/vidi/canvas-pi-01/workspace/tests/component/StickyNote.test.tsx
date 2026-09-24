/**
 * Story 2 · task 7 — sticky note interaction component tests (TC-18 … TC-22,
 * TC-25, TC-35 … TC-37) in jsdom, against a real `Y.Doc`.
 *
 * jsdom has no layout and no pointer capture, so we drive the handlers with
 * dispatched pointer events (the app guards `setPointerCapture`) and assert
 * DOM facts (data-phase / data-selected / position) rather than measured
 * pixels. Pixel-accurate drag and zoom are covered by the Playwright suite.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { BoardShell } from '../../src/client/App';
import { deleteObject } from '../../src/shared/board-model';
import { dblclick, key, pointer, seedDoc } from './helpers';

const VIEWPORT = { width: 800, height: 600 };

beforeEach(() => {
  cleanup();
});

function renderBoard(doc: Y.Doc) {
  return render(<BoardShell viewport={VIEWPORT} doc={doc} />);
}

function noteEl(id: string): HTMLElement {
  return screen.getByTestId(`note-${id}`) as HTMLElement;
}

function position(el: HTMLElement): { x: number; y: number } {
  return { x: Number(el.dataset.x), y: Number(el.dataset.y) };
}

describe('select (TC-18, TC-22)', () => {
  it('TC-18: press + release without moving selects the note and shows the toolbar', () => {
    const { doc, ids } = seedDoc([{ id: 'a', centre: { x: 300, y: 300 } }]);
    renderBoard(doc);
    const note = noteEl(ids[0]);

    fireEvent(note, pointer('pointerdown', 300, 300));
    fireEvent(note, pointer('pointerup', 300, 300));

    expect(note.dataset.selected).toBe('true');
    expect(screen.getByTestId('note-toolbar')).toBeTruthy();
  });

  it('TC-22: clicking empty board space clears the selection and hides the toolbar', () => {
    const { doc, ids } = seedDoc([{ id: 'a', centre: { x: 300, y: 300 } }]);
    renderBoard(doc);
    const note = noteEl(ids[0]);

    // Select first.
    fireEvent(note, pointer('pointerdown', 300, 300));
    fireEvent(note, pointer('pointerup', 300, 300));
    expect(note.dataset.selected).toBe('true');

    // A plain click on empty space (the board surface) clears it.
    const surface = screen.getByTestId('board-viewport');
    fireEvent(surface, pointer('pointerdown', 650, 150));
    fireEvent(surface, pointer('pointerup', 650, 150));

    expect(note.dataset.selected).toBe('false');
    expect(screen.queryByTestId('note-toolbar')).toBeNull();
  });
});

describe('drag to move (TC-19, TC-20, TC-21)', () => {
  it('TC-19: a 2px move is below the threshold — stays selected, no moveObject', () => {
    const { doc, ids } = seedDoc([{ id: 'a', centre: { x: 300, y: 300 } }]);
    renderBoard(doc);
    const note = noteEl(ids[0]);
    const before = position(note);

    fireEvent(note, pointer('pointerdown', 300, 300));
    fireEvent(note, pointer('pointermove', 302, 300)); // 2px, under DRAG_THRESHOLD_PX
    fireEvent(note, pointer('pointerup', 302, 300));

    // Selection happened (press selects), but the note never moved.
    expect(note.dataset.selected).toBe('true');
    expect(position(note)).toEqual(before);
  });

  it('TC-20: a 3px move drags the note and never pans the board', () => {
    const { doc, ids } = seedDoc([{ id: 'a', centre: { x: 300, y: 300 } }]);
    renderBoard(doc);
    const note = noteEl(ids[0]);
    const before = position(note);
    const cameraBefore = (screen.getByTestId('world-layer') as HTMLElement).dataset.camera;

    fireEvent(note, pointer('pointerdown', 300, 300));
    fireEvent(note, pointer('pointermove', 303, 300)); // exactly the threshold
    fireEvent(note, pointer('pointermove', 320, 300));

    expect(note.dataset.phase).toBe('dragging');
    // The note moved (moveObject ran) ...
    expect(Number(note.dataset.x)).toBeGreaterThan(before.x);
    // ... but the camera did not (no pan: pointerdown stopped propagation).
    const cameraAfter = (screen.getByTestId('world-layer') as HTMLElement).dataset.camera;
    expect(cameraAfter).toBe(cameraBefore);
  });

  it('TC-21: a cancelled drag keeps the last applied position', () => {
    const { doc, ids } = seedDoc([{ id: 'a', centre: { x: 300, y: 300 } }]);
    renderBoard(doc);
    const note = noteEl(ids[0]);

    fireEvent(note, pointer('pointerdown', 300, 300));
    fireEvent(note, pointer('pointermove', 340, 300)); // start + move the drag
    expect(note.dataset.phase).toBe('dragging');
    const dragged = position(note);
    expect(dragged.x).toBeGreaterThan(0);

    // The drag is interrupted (pointer released outside / system cancel).
    fireEvent(note, pointer('pointercancel', 340, 300));
    expect(note.dataset.phase).toBe('idle');
    // The note stays exactly where it was last shown.
    expect(position(note)).toEqual(dragged);
  });
});

describe('keyboard delete (TC-25)', () => {
  it('removes a selected note with the Delete key', () => {
    const { doc, ids } = seedDoc([{ id: 'a', centre: { x: 300, y: 300 } }]);
    renderBoard(doc);
    const note = noteEl(ids[0]);
    fireEvent(note, pointer('pointerdown', 300, 300));
    fireEvent(note, pointer('pointerup', 300, 300));
    expect(note.dataset.selected).toBe('true');

    act(() => {
      window.dispatchEvent(key('Delete'));
    });
    expect(screen.queryByTestId(`note-${ids[0]}`)).toBeNull();
    expect(doc.getMap('objects').size).toBe(0);
  });

  it('removes a selected note with the Backspace key', () => {
    const { doc, ids } = seedDoc([{ id: 'a', centre: { x: 300, y: 300 } }]);
    renderBoard(doc);
    const note = noteEl(ids[0]);
    fireEvent(note, pointer('pointerdown', 300, 300));
    fireEvent(note, pointer('pointerup', 300, 300));

    act(() => {
      window.dispatchEvent(key('Backspace'));
    });
    expect(screen.queryByTestId(`note-${ids[0]}`)).toBeNull();
    expect(doc.getMap('objects').size).toBe(0);
  });
});

describe('double-click and Enter (TC-35, TC-36)', () => {
  it('TC-35: double-clicking an existing note edits it and does not create a note', () => {
    const { doc, ids } = seedDoc([{ id: 'a', centre: { x: 300, y: 300 }, text: 'hello' }]);
    renderBoard(doc);
    const note = noteEl(ids[0]);

    fireEvent(note, dblclick(300, 300));

    // Editing started on the existing note ...
    expect(screen.getByTestId('sticky-editor')).toBeTruthy();
    // ... and no second note was created (still exactly one object).
    expect(doc.getMap('objects').size).toBe(1);
  });

  it('TC-36: pressing Enter with nothing selected creates nothing', () => {
    const { doc, ids } = seedDoc([{ id: 'a', centre: { x: 300, y: 300 } }]);
    renderBoard(doc);
    expect(screen.getByTestId(`note-${ids[0]}`)).toBeTruthy();

    // No note is selected and no editor is open.
    act(() => {
      window.dispatchEvent(key('Enter'));
    });

    // Nothing happened: still one note, no editor, no new object.
    expect(screen.queryByTestId('sticky-editor')).toBeNull();
    expect(doc.getMap('objects').size).toBe(1);
  });
});

describe('stale note during interaction (TC-37)', () => {
  it('a note deleted during a drag ends the interaction and is not recreated', () => {
    const { doc, ids } = seedDoc([{ id: 'a', centre: { x: 300, y: 300 } }]);
    renderBoard(doc);
    const note = noteEl(ids[0]);

    fireEvent(note, pointer('pointerdown', 300, 300));
    fireEvent(note, pointer('pointermove', 330, 300));
    expect(note.dataset.phase).toBe('dragging');

    // The model deletes the note mid-drag (e.g. another user, or a bug).
    act(() => {
      deleteObject(doc, ids[0]);
    });

    // No exception, and the note is gone (not recreated by the pending drag).
    expect(screen.queryByTestId(`note-${ids[0]}`)).toBeNull();
    expect(doc.getMap('objects').size).toBe(0);
  });

  it('a note deleted while editing ends editing and is not recreated', () => {
    const { doc, ids } = seedDoc([{ id: 'a', centre: { x: 300, y: 300 }, text: 'abc' }]);
    renderBoard(doc);
    const note = noteEl(ids[0]);

    // Enter editing via double-click.
    fireEvent(note, dblclick(300, 300));
    expect(screen.getByTestId('sticky-editor')).toBeTruthy();

    act(() => {
      deleteObject(doc, ids[0]);
    });

    expect(screen.queryByTestId('sticky-editor')).toBeNull();
    expect(doc.getMap('objects').size).toBe(0);
  });
});