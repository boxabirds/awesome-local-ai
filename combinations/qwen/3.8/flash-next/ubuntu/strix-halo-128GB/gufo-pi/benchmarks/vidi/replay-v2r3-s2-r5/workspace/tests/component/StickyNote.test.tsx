import { describe, it, expect, vi, afterEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import {
  addNote,
  addNotes,
  act,
  cancel,
  clickEmptyBoard,
  fireEvent,
  flushFrames,
  gridLayer,
  noteById,
  noteElements,
  notesOf,
  press,
  release,
  renderBoard,
  moveTo,
  screen,
  worldLayerTransform,
} from './stickyHarness';
import { DRAG_THRESHOLD_PX } from '../../src/shared/config';
import { deleteObject } from '../../src/shared/board-model';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('sticky.interaction select', () => {
  // TC-18
  it('TC-18: press and release without moving selects the note, showing outline and toolbar', () => {
    const { doc } = renderBoard();
    const id = addNote(doc, { x: 300, y: 300 });
    const el = noteById(id);

    expect(el.dataset.selected).toBe('false');
    expect(screen.queryByTestId('note-toolbar')).not.toBeInTheDocument();

    press(el, 350, 350);
    release(el, 350, 350);

    const selected = noteById(id);
    expect(selected.dataset.selected).toBe('true');
    expect(selected.style.outline || selected.getAttribute('style')).toContain('1976d2');
    const toolbar = screen.getByTestId('note-toolbar');
    expect(toolbar).toBeInTheDocument();
    expect(selected.contains(toolbar)).toBe(true);

    // Accessible names: six colour swatches plus the delete button.
    expect(screen.getAllByRole('group', { name: 'Sticky note' })).toHaveLength(1);
    const swatches = screen.getAllByRole('button', { name: /colour$/ });
    expect(swatches).toHaveLength(6);
    for (const name of ['Yellow', 'Orange', 'Green', 'Blue', 'Pink', 'Violet']) {
      expect(screen.getByRole('button', { name: `${name} colour` })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Delete note' })).toBeInTheDocument();
  });

  // TC-22
  it('TC-22: clicking empty board space clears the selection and hides the toolbar', () => {
    const { doc } = renderBoard();
    const id = addNote(doc, { x: 300, y: 300 });
    press(noteById(id), 350, 350);
    release(noteById(id), 350, 350);
    expect(screen.getByTestId('note-toolbar')).toBeInTheDocument();

    clickEmptyBoard(20, 20);

    expect(noteById(id).dataset.selected).toBe('false');
    expect(screen.queryByTestId('note-toolbar')).not.toBeInTheDocument();
  });

  // TC-36 (negative)
  it('TC-36: Enter with nothing selected does nothing', () => {
    renderBoard();

    fireEvent.keyDown(document.body, { key: 'Enter' });

    expect(noteElements()).toHaveLength(0);
    expect(screen.queryByTestId('sticky-textarea')).not.toBeInTheDocument();
  });
});

describe('sticky.interaction drag to move', () => {
  // TC-19 (boundary: below threshold)
  it('TC-19: moving 2px stays a click — the note is selected but never moved', async () => {
    const { doc } = renderBoard();
    const id = addNote(doc, { x: 300, y: 300 });
    const el = noteById(id);
    const x0 = Number(el.dataset.x);
    const y0 = Number(el.dataset.y);
    expect(x0).toBe(300 - 100);

    press(el, 350, 350);
    moveTo(el, 351, 351);
    moveTo(el, 352, 351); // 2px total, below DRAG_THRESHOLD_PX
    expect(el.dataset.dragging).toBe('false');
    release(el, 352, 351);
    await flushFrames();

    const after = noteById(id);
    expect(after.dataset.selected).toBe('true');
    expect(Number(after.dataset.x)).toBe(x0);
    expect(Number(after.dataset.y)).toBe(y0);
    expect(DRAG_THRESHOLD_PX).toBe(3);
  });

  // TC-20 (boundary: at threshold; negative: the board must not pan)
  it('TC-20: moving 3px starts a drag and the board camera does not move', async () => {
    const { doc } = renderBoard();
    const id = addNote(doc, { x: 300, y: 300 });
    const el = noteById(id);
    const cameraBefore = worldLayerTransform();
    const x0 = Number(el.dataset.x);
    const y0 = Number(el.dataset.y);

    press(el, 350, 350);
    moveTo(el, 353, 350); // exactly the threshold
    expect(noteById(id).dataset.dragging).toBe('true');
    // The dragged note is raised above everything it can overlap.
    const zWhileDragging = Number(noteById(id).dataset.z);

    moveTo(el, 363, 350);
    release(el, 363, 350);
    await flushFrames();

    const after = noteById(id);
    expect(Number(after.dataset.x)).toBeCloseTo(x0 + 13, 6);
    expect(Number(after.dataset.y)).toBeCloseTo(y0, 6);
    expect(Number(after.dataset.z)).toBe(zWhileDragging);
    expect(after.dataset.selected).toBe('true');
    expect(after.dataset.dragging).toBe('false');
    // sticky.no_pan: the world layer (grid and other notes) never moved.
    expect(worldLayerTransform()).toBe(cameraBefore);
  });

  it('TC-20: brings a lower note above the topmost note when the drag starts', async () => {
    const { doc } = renderBoard();
    const [bottom, top] = addNotes(doc, 2, { x: 0, y: 0 });
    expect(Number(noteById(bottom).dataset.z)).toBe(1);
    expect(Number(noteById(top).dataset.z)).toBe(2);

    press(noteById(bottom), 50, 50);
    moveTo(noteById(bottom), 60, 50);
    await flushFrames();

    expect(Number(noteById(bottom).dataset.z)).toBe(3);
    release(noteById(bottom), 60, 50);
    await flushFrames();
    expect(notesOf(doc).map((n) => n.id)).toEqual([top, bottom]);
  });

  // TC-21
  it('TC-21: pointercancel during a drag keeps the last shown position and selects the note', async () => {
    const { doc } = renderBoard();
    const id = addNote(doc, { x: 300, y: 300 });
    const el = noteById(id);

    press(el, 350, 350);
    moveTo(el, 400, 350);
    await flushFrames();
    const shown = noteById(id);
    const shownX = Number(shown.dataset.x);
    expect(shownX).toBeCloseTo(200 + 50, 6);

    cancel(shown, 400, 350);
    await flushFrames();

    const after = noteById(id);
    expect(after.dataset.dragging).toBe('false');
    expect(after.dataset.selected).toBe('true');
    expect(Number(after.dataset.x)).toBe(shownX);
  });

  it('leaves the position alone when the pointer is released outside the window', async () => {
    const { doc } = renderBoard();
    const id = addNote(doc, { x: 300, y: 300 });
    const el = noteById(id);

    press(el, 350, 350);
    moveTo(el, 420, 380);
    await flushFrames();
    const shownX = Number(noteById(id).dataset.x);
    // The pointer is released outside the note (and outside the window).
    fireEvent.pointerUp(gridLayer(), { pointerId: 1, buttons: 0, clientX: 900, clientY: 900 });
    await flushFrames();

    expect(Number(noteById(id).dataset.x)).toBe(shownX);
    expect(noteById(id).dataset.selected).toBe('true');
  });
});

describe('sticky.interaction create by double-click', () => {
  it('creates a yellow note centred on the double-clicked point and starts editing', () => {
    const { doc } = renderBoard();

    fireEvent.doubleClick(gridLayer(), { clientX: 400, clientY: 300 });

    const notes = notesOf(doc);
    expect(notes).toHaveLength(1);
    expect(notes[0].x).toBe(400 - 100);
    expect(notes[0].y).toBe(300 - 100);
    expect(notes[0].color).toBe('yellow');
    const el = noteById(notes[0].id);
    expect(el.dataset.editing).toBe('true');
    expect(screen.getByTestId('sticky-textarea')).toBeInTheDocument();
  });

  // TC-35 (negative)
  it('TC-35: double-click on an existing note edits it instead of creating a new one', () => {
    const { doc } = renderBoard();
    const id = addNote(doc, { x: 300, y: 300 });

    fireEvent.doubleClick(noteById(id), { clientX: 350, clientY: 350 });

    expect(notesOf(doc)).toHaveLength(1);
    expect(noteElements()).toHaveLength(1);
    expect(noteById(id).dataset.editing).toBe('true');
    expect(screen.getByTestId('sticky-textarea')).toBeInTheDocument();
  });
});

describe('sticky.interaction keyboard delete', () => {
  // PRD accessibility: notes are reachable with Tab and editable with Enter.
  it('reaches an unselected note with Tab and starts editing on Enter', async () => {
    const user = userEvent.setup();
    const { doc } = renderBoard();
    const id = addNote(doc, { x: 300, y: 300 });

    await user.tab();

    expect(document.activeElement).toBe(noteById(id));
    await user.keyboard('{Enter}');
    expect(noteById(id).dataset.editing).toBe('true');
    expect(screen.getByTestId('sticky-textarea')).toBeInTheDocument();
  });

  // TC-25
  it.each(['Delete', 'Backspace'])('TC-25: %s removes the selected note', (key) => {
    const { doc } = renderBoard();
    const id = addNote(doc, { x: 300, y: 300 });
    press(noteById(id), 350, 350);
    release(noteById(id), 350, 350);

    fireEvent.keyDown(document.body, { key });

    expect(notesOf(doc)).toHaveLength(0);
    expect(noteElements()).toHaveLength(0);
  });

  it('leaves notes alone when nothing is selected', () => {
    const { doc } = renderBoard();
    const id = addNote(doc, { x: 300, y: 300 });

    fireEvent.keyDown(document.body, { key: 'Delete' });

    expect(notesOf(doc)).toHaveLength(1);
    expect(noteById(id)).toBeInTheDocument();
  });
});

describe('sticky.interaction note disappears mid-interaction', () => {
  // TC-37
  it('TC-37: a note deleted while dragging ends the drag without an exception', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { doc } = renderBoard();
    const id = addNote(doc, { x: 300, y: 300 });
    const el = noteById(id);

    press(el, 350, 350);
    moveTo(el, 400, 350);
    act(() => {
      deleteObject(doc, id);
    });

    moveTo(el, 450, 350);
    await flushFrames();
    release(el, 450, 350);
    await flushFrames();

    expect(noteElements()).toHaveLength(0);
    expect(notesOf(doc)).toHaveLength(0);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('TC-37: a note deleted while editing closes the editor without an exception', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { doc } = renderBoard();
    const id = addNote(doc, { x: 300, y: 300 });
    fireEvent.doubleClick(noteById(id));
    expect(screen.getByTestId('sticky-textarea')).toBeInTheDocument();

    act(() => {
      deleteObject(doc, id);
    });
    await flushFrames();

    expect(screen.queryByTestId('sticky-textarea')).not.toBeInTheDocument();
    expect(noteElements()).toHaveLength(0);
    expect(notesOf(doc)).toHaveLength(0);

    // Further interaction with the board does not resurrect the note.
    fireEvent.keyDown(document.body, { key: 'Delete' });
    await flushFrames();
    expect(notesOf(doc)).toHaveLength(0);
    expect(consoleError).not.toHaveBeenCalled();
  });
});
