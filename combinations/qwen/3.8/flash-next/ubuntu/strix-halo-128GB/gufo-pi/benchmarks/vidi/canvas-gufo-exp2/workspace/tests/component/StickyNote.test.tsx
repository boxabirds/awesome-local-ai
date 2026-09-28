import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../../src/client/App';
import { cameraFromDom, viewportEl } from './helpers/board';
import {
  cancelOn,
  deleteButton,
  deleteNoteViaModel,
  doubleClickBoard,
  dragOn,
  moveOn,
  noteEl,
  noteEls,
  notes,
  pressKey,
  textareas,
  pressOn,
  releaseOn,
  settle,
  swatch,
} from './helpers/sticky';

/**
 * Story 2 — sticky note interaction: creating, selecting, dragging, deleting,
 * and the edge cases where a note disappears under an in-flight interaction.
 */

beforeEach(() => {
  document.documentElement.style.width = '1024px';
  document.documentElement.style.height = '768px';
});

/** Double-click the middle of the board; returns the new note's id. */
function createNoteAtCentre(): string {
  doubleClickBoard(512, 384);
  const [note] = notes();
  if (!note) throw new Error('double-click on the board created no note');
  return note.id;
}

/** Leave edit mode; the note is then selected, which is where the stories start. */
function stopEditing(): void {
  pressKey('Escape');
}

describe('creating a note (TC-28 support)', () => {
  it('creates a note centred on the double-clicked point and opens it for typing', () => {
    render(<App />);
    createNoteAtCentre();

    expect(notes()).toHaveLength(1);
    const [note] = notes();
    // At the initial camera the viewport centre is the world origin, and the
    // clicked point becomes the note's centre, not its top-left corner.
    expect(note.x).toBeCloseTo(-100, 6);
    expect(note.y).toBeCloseTo(-100, 6);
    expect(textareas()).toHaveLength(1);
  });

  it('stacks new notes on top of existing ones', () => {
    render(<App />);
    doubleClickBoard(400, 300);
    const firstId = notes()[0].id;
    doubleClickBoard(600, 500);
    expect(notes()).toHaveLength(2);
    const secondId = notes().find((n) => n.id !== firstId)!.id;
    const ordered = [...notes()].sort((a, b) => a.z - b.z);
    expect(ordered[0].id).toBe(firstId);
    expect(ordered[1].id).toBe(secondId);
    // Stacking is done with `zIndex`, not by moving elements in the DOM, so a
    // note coming to the front cannot disturb an interaction in progress.
    const firstEl = noteEl(firstId);
    const secondEl = noteEl(secondId);
    expect(Number(secondEl.style.zIndex)).toBeGreaterThan(Number(firstEl.style.zIndex));
    // The elements stay in a z-independent order in the DOM: moving an element
    // is a removal, and removing the pointer-captured element would end a drag.
    const domOrder = noteEls().map((el) => el.dataset.stickyId);
    expect([...domOrder].sort()).toEqual(domOrder);
  });
});

describe('selecting a note (TC-18, TC-22)', () => {
  it('selects a note on click and shows its floating toolbar', async () => {
    const user = userEvent.setup();
    render(<App />);
    const id = createNoteAtCentre();
    stopEditing();
    // Clicking the empty board first: the note starts unselected.
    await user.click(viewportEl());
    expect(noteEl().dataset.selected).toBe('false');
    expect(screen.queryByRole('button', { name: 'Delete note' })).toBeNull();

    await user.click(noteEl());
    expect(noteEl(id).dataset.selected).toBe('true');
    // Floating toolbar: six colour swatches and the bin.
    expect(swatch(noteEl(id), 'Yellow')).toBeTruthy();
    expect(swatch(noteEl(id), 'Violet')).toBeTruthy();
    expect(deleteButton(noteEl(id))).toBeTruthy();
  });

  it('deselects when the empty board is clicked', async () => {
    const user = userEvent.setup();
    render(<App />);
    createNoteAtCentre();
    stopEditing();
    expect(noteEl().dataset.selected).toBe('true');

    await user.click(viewportEl());
    expect(noteEl().dataset.selected).toBe('false');
    expect(screen.queryByRole('button', { name: 'Delete note' })).toBeNull();
  });

  it('gives the note keyboard focus when it is selected', async () => {
    const user = userEvent.setup();
    render(<App />);
    const id = createNoteAtCentre();
    stopEditing();
    await user.click(viewportEl());
    expect(document.activeElement).not.toBe(noteEl(id));

    await user.click(noteEl(id));
    expect(document.activeElement).toBe(noteEl(id));
  });
});

describe('the drag threshold (TC-19)', () => {
  it('treats a 2 px press as a selection and leaves the note exactly where it was', async () => {
    render(<App />);
    createNoteAtCentre();
    stopEditing();
    const before = notes()[0];

    pressOn(noteEl());
    moveOn(noteEl(), 2, 1);
    await settle();
    expect(noteEl().dataset.press).toBe('pressed');
    expect(notes()[0].x).toBeCloseTo(before.x, 6);
    expect(notes()[0].y).toBeCloseTo(before.y, 6);

    releaseOn(noteEl(), 2, 1);
    await settle();
    expect(noteEl().dataset.selected).toBe('true');
    expect(notes()[0].x).toBeCloseTo(before.x, 6);
    expect(notes()[0].y).toBeCloseTo(before.y, 6);
  });
});

describe('dragging (TC-20, TC-21)', () => {
  it('drags with a 3 px threshold and never changes the camera', async () => {
    render(<App />);
    createNoteAtCentre();
    stopEditing();
    const before = notes()[0];
    const camera = cameraFromDom();

    pressOn(noteEl());
    moveOn(noteEl(), 3, 0);
    await settle();
    expect(noteEl().dataset.press).toBe('dragging');
    // 3 screen px at zoom 1 is 3 world units.
    expect(notes()[0].x).toBeCloseTo(before.x + 3, 6);

    moveOn(noteEl(), 40, 25);
    await settle();
    expect(notes()[0].x).toBeCloseTo(before.x + 40, 6);
    expect(notes()[0].y).toBeCloseTo(before.y + 25, 6);

    releaseOn(noteEl(), 40, 25);
    await settle();
    expect(cameraFromDom()).toEqual(camera);
    expect(noteEl().dataset.selected).toBe('true');
    expect(noteEl().dataset.press).toBe('idle');
  });

  it('raises the dragged note above the others when the drag starts', async () => {
    render(<App />);
    doubleClickBoard(400, 300);
    const firstId = notes()[0].id;
    stopEditing();
    doubleClickBoard(600, 500);
    expect(notes()).toHaveLength(2);
    const secondId = notes().find((n) => n.id !== firstId)!.id;
    stopEditing();

    // The first note is underneath; dragging it brings it to the front.
    const first = noteEl(firstId);
    pressOn(first);
    moveOn(first, 10, 10);
    await settle();
    const after = notes();
    expect(after[after.length - 1].id).toBe(firstId);
    expect(after.map((n) => n.id).sort()).toEqual([firstId, secondId].sort());
    releaseOn(first, 10, 10);
    await settle();
  });

  it('keeps the last position after pointercancel and ends selected', async () => {
    render(<App />);
    createNoteAtCentre();
    stopEditing();
    const before = notes()[0];

    pressOn(noteEl());
    moveOn(noteEl(), 12, 8);
    await settle();
    const moved = notes()[0];
    cancelOn(noteEl());
    await settle();

    expect(notes()[0].x).toBeCloseTo(moved.x, 6);
    expect(notes()[0].y).toBeCloseTo(moved.y, 6);
    expect(noteEl().dataset.selected).toBe('true');
    expect(noteEl().dataset.press).toBe('idle');
    // Nothing snaps back to where the note started.
    expect(notes()[0].x).not.toBeCloseTo(before.x, 6);
  });

  it('moves by the zoom-scaled distance of the pointer', async () => {
    render(<App />);
    createNoteAtCentre();
    stopEditing();
    // Zoom out to 0.5 so one screen pixel covers two world units.
    const camera = cameraFromDom();
    act(() => {
      window.__vidi6?.setCamera?.(camera.x, camera.y, 0.5);
    });
    await settle();
    const before = notes()[0];

    pressOn(noteEl());
    moveOn(noteEl(), 10, 0);
    await settle();
    expect(notes()[0].x - before.x).toBeCloseTo(20, 1);
    releaseOn(noteEl(), 10, 0);
    await settle();
  });

  it('does not pan the board when a drag starts on a note', async () => {
    render(<App />);
    createNoteAtCentre();
    stopEditing();
    const camera = cameraFromDom();

    await dragOn(noteEl(), [
      { dx: 5, dy: 5 },
      { dx: 60, dy: -30 },
    ]);
    expect(cameraFromDom()).toEqual(camera);
    expect(notes()[0].x).not.toBeCloseTo(0, 0);
  });
});

describe('deleting with the keyboard (TC-25, TC-36)', () => {
  for (const key of ['Delete', 'Backspace']) {
    it(`removes the selected note on ${key} and clears the selection`, () => {
      render(<App />);
      const id = createNoteAtCentre();
      stopEditing();
      expect(noteEl(id).dataset.selected).toBe('true');

      pressKey(key);
      expect(noteEls()).toHaveLength(0);
      expect(notes()).toHaveLength(0);
      // Focus returns to the board, so the shortcut works again straight away.
      expect(document.activeElement).toBe(document.body);
    });
  }

  it('does nothing on Enter when no note exists', () => {
    render(<App />);
    pressKey('Enter');
    expect(notes()).toHaveLength(0);
    expect(noteEls()).toHaveLength(0);
  });

  it('opens the editor when Enter is pressed with a note selected', () => {
    render(<App />);
    createNoteAtCentre();
    stopEditing();
    expect(textareas()).toHaveLength(0);
    pressKey('Enter');
    expect(textareas()).toHaveLength(1);
  });

  it('never deletes a note while its text is being edited', () => {
    render(<App />);
    createNoteAtCentre();
    const input = screen.getByTestId('sticky-textarea');

    // Backspace inside the textarea belongs to the text, not to the note.
    pressKey('Backspace', input);
    expect(noteEls()).toHaveLength(1);
    expect(notes()).toHaveLength(1);
  });
});

describe('double-click on an existing note (TC-35)', () => {
  it('enters edit mode without creating a second note', () => {
    render(<App />);
    createNoteAtCentre();
    stopEditing();
    expect(notes()).toHaveLength(1);

    fireEvent.doubleClick(noteEl());
    expect(notes()).toHaveLength(1);
    expect(textareas()).toHaveLength(1);
  });
});

describe('a note that disappears mid-interaction (TC-37)', () => {
  it('survives a deletion while dragging and does not resurrect the note', async () => {
    render(<App />);
    const id = createNoteAtCentre();
    stopEditing();

    // The element reference is kept on purpose: React has unmounted the note,
    // but the browser would keep sending events to the captured pointer.
    const el = noteEl(id);
    pressOn(el);
    moveOn(el, 20, 20);
    await settle();
    expect(deleteNoteViaModel(id)).toBe(true);

    // The drag is still open: further moves and the release must not throw.
    moveOn(el, 40, 40);
    releaseOn(el, 40, 40);
    await settle();

    expect(notes()).toHaveLength(0);
    expect(noteEls()).toHaveLength(0);
  });

  it('survives a deletion while editing', () => {
    render(<App />);
    const id = createNoteAtCentre();
    expect(textareas()).toHaveLength(1);

    expect(deleteNoteViaModel(id)).toBe(true);
    expect(textareas()).toHaveLength(0);
    expect(notes()).toHaveLength(0);
    // The Escape that would have committed the text is now harmless.
    pressKey('Escape');
    expect(notes()).toHaveLength(0);
  });

  it('clears the selection when the selected note is deleted', () => {
    render(<App />);
    const id = createNoteAtCentre();
    stopEditing();
    expect(noteEl(id).dataset.selected).toBe('true');

    expect(deleteNoteViaModel(id)).toBe(true);
    expect(noteEls()).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Delete note' })).toBeNull();
  });
});
