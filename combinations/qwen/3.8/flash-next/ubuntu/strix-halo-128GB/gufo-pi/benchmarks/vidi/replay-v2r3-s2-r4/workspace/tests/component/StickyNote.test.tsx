import { describe, it, expect, beforeEach } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { App } from '../../src/client/App';
import type { Vidi6TestHooks } from '../../src/client/canvas/testHooks';
import type { StickySnapshot } from '../../src/shared/board-model';
import { DRAG_THRESHOLD_PX, STICKY_SIZE_WORLD, STICKY_COLORS } from '../../src/shared/config';

function hooks(): Vidi6TestHooks {
  const h = window.__vidi6;
  if (!h) throw new Error('test hooks are not registered');
  return h;
}

const objects = (): readonly StickySnapshot[] => hooks().getObjects();
const selection = () => hooks().getSelection();

const noteById = (id: string): StickySnapshot => {
  const note = objects().find((n) => n.id === id);
  if (!note) throw new Error(`note ${id} is gone`);
  return note;
};

const HALF = STICKY_SIZE_WORLD / 2;

/** Let scheduled requestAnimationFrame callbacks run inside React's act(). */
async function flushFrame(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
}

function viewportEl(): HTMLElement {
  return screen.getByTestId('board-viewport');
}

function noteEl(id?: string): HTMLElement {
  const els = screen.getAllByTestId('sticky-note');
  if (!id) return els[els.length - 1]!;
  const el = els.find((e) => e.getAttribute('data-note-id') === id);
  if (!el) throw new Error(`note element ${id} is not rendered`);
  return el;
}

function gridEl(): HTMLElement {
  return viewportEl();
}

/** Double-click empty board space: creates a note centred there, editing starts. */
function dblClickBoard(x: number, y: number): string {
  fireEvent.doubleClick(viewportEl(), { clientX: x, clientY: y });
  const all = objects();
  return all[all.length - 1]!.id;
}

/** Press and release on empty board space without moving: clears the selection. */
function emptyClick(x = 20, y = 20): void {
  fireEvent.pointerDown(gridEl(), { clientX: x, clientY: y, pointerId: 9 });
  fireEvent.pointerUp(gridEl(), { clientX: x, clientY: y, pointerId: 9 });
}

function press(el: HTMLElement, x: number, y: number, pointerId = 1): void {
  fireEvent.pointerDown(el, { clientX: x, clientY: y, pointerId });
}

function moveTo(el: HTMLElement, x: number, y: number, pointerId = 1): void {
  fireEvent.pointerMove(el, { clientX: x, clientY: y, pointerId });
}

function release(el: HTMLElement, x: number, y: number, pointerId = 1): void {
  fireEvent.pointerUp(el, { clientX: x, clientY: y, pointerId });
}

/** A note the user has created and left alone: present and unselected. */
function createIdleNote(x = 300, y = 200): string {
  const id = dblClickBoard(x, y);
  emptyClick();
  return id;
}

describe('sticky.interaction: create', () => {
  beforeEach(() => {
    render(<App />);
  });

  it('TC-30 (component part): double-click creates one yellow note centred on the point', () => {
    const id = dblClickBoard(300, 200);

    expect(objects()).toHaveLength(1);
    const note = noteById(id);
    expect(note.x).toBeCloseTo(300 - HALF, 6);
    expect(note.y).toBeCloseTo(200 - HALF, 6);
    expect(note.color).toBe('yellow');
    // Editing starts immediately, so typed characters go straight in.
    expect(screen.getByTestId('sticky-editor')).toBeInTheDocument();
  });

  it('TC-35: double-click on an existing note edits it instead of creating a note', () => {
    const id = createIdleNote(300, 200);

    fireEvent.doubleClick(noteEl(id), { clientX: 300, clientY: 200 });

    expect(objects()).toHaveLength(1);
    expect(selection().editingId).toBe(id);
    expect(screen.getByTestId('sticky-editor')).toBeInTheDocument();
  });

  it('notes created later are on top of earlier ones', () => {
    const first = dblClickBoard(100, 100);
    emptyClick();
    const second = dblClickBoard(400, 400);

    expect(objects().map((n) => n.id)).toEqual([first, second]);
    expect(noteById(second).z).toBeGreaterThan(noteById(first).z);
  });
});

describe('sticky.interaction: select and deselect', () => {
  beforeEach(() => {
    render(<App />);
  });

  it('TC-18: press and release without moving selects the note, showing outline and toolbar', () => {
    const id = createIdleNote();
    const el = noteEl(id);

    expect(el.getAttribute('data-selected')).toBe('false');
    expect(screen.queryByTestId('note-toolbar')).toBeNull();

    press(el, 350, 250);
    release(el, 350, 250);

    expect(selection().selectedId).toBe(id);
    expect(noteEl(id).getAttribute('data-selected')).toBe('true');
    expect(noteEl(id)).toHaveClass('sticky-note--selected');
    expect(screen.getByTestId('note-toolbar')).toBeInTheDocument();
    // Accessible name, not only a colour, identifies the note.
    expect(screen.getByRole('group', { name: 'Sticky note' })).toBeInTheDocument();
  });

  it('TC-19: moving 2px stays below DRAG_THRESHOLD_PX: selected, note not moved', () => {
    expect(DRAG_THRESHOLD_PX).toBe(3);
    const id = createIdleNote();
    const before = noteById(id);
    const el = noteEl(id);

    press(el, 350, 250);
    moveTo(el, 352, 250);
    release(el, 352, 250);

    expect(selection().selectedId).toBe(id);
    expect(noteById(id).x).toBe(before.x);
    expect(noteById(id).y).toBe(before.y);
  });

  it('TC-20: moving exactly DRAG_THRESHOLD_PX drags the note and never pans the board', async () => {
    const id = createIdleNote();
    const before = noteById(id);
    const cameraBefore = hooks().getCamera();
    const el = noteEl(id);

    press(el, 350, 250);
    moveTo(el, 353, 250);
    release(el, 353, 250);
    await flushFrame();

    const after = noteById(id);
    expect(after.x).toBeCloseTo(before.x + DRAG_THRESHOLD_PX, 6);
    expect(after.y).toBeCloseTo(before.y, 6);

    // sticky.no_pan: the camera is untouched.
    const cameraAfter = hooks().getCamera();
    expect(cameraAfter).toEqual(cameraBefore);
  });

  it('TC-21: a cancelled drag leaves the note at the last applied position', async () => {
    const id = createIdleNote();
    const before = noteById(id);
    const el = noteEl(id);

    press(el, 350, 250);
    moveTo(el, 360, 252);
    await flushFrame();

    fireEvent.pointerCancel(el, { clientX: 360, clientY: 252, pointerId: 1 });

    expect(noteById(id).x).toBeCloseTo(before.x + 10, 6);
    expect(noteById(id).y).toBeCloseTo(before.y + 2, 6);
    expect(selection().selectedId).toBe(id);
    expect(selection().editingId).toBeNull();
  });

  it('TC-22: clicking empty board space clears the selection and hides the toolbar', () => {
    const id = createIdleNote();
    const el = noteEl(id);
    press(el, 350, 250);
    release(el, 350, 250);
    expect(selection().selectedId).toBe(id);

    emptyClick();

    expect(selection().selectedId).toBeNull();
    expect(noteEl(id).getAttribute('data-selected')).toBe('false');
    expect(screen.queryByTestId('note-toolbar')).toBeNull();
  });

  it('dragging a note brings it to the front', () => {
    const first = createIdleNote(100, 100);
    const second = createIdleNote(400, 400);
    expect(noteById(first).z).toBeLessThan(noteById(second).z);

    const el = noteEl(first);
    press(el, 150, 150);
    moveTo(el, 170, 150);
    release(el, 170, 150);

    expect(noteById(first).z).toBeGreaterThan(noteById(second).z);
  });
});

describe('sticky.interaction: delete from the keyboard', () => {
  beforeEach(() => {
    render(<App />);
  });

  it('TC-25: Delete removes the selected note', () => {
    const id = createIdleNote();
    const el = noteEl(id);
    press(el, 350, 250);
    release(el, 350, 250);

    fireEvent.keyDown(window, { key: 'Delete' });

    expect(objects()).toHaveLength(0);
    expect(screen.queryByTestId('sticky-note')).toBeNull();
    expect(selection().selectedId).toBeNull();
  });

  it('TC-25b: Backspace removes the selected note', () => {
    const id = createIdleNote();
    const el = noteEl(id);
    press(el, 350, 250);
    release(el, 350, 250);

    fireEvent.keyDown(window, { key: 'Backspace' });

    expect(objects()).toHaveLength(0);
    expect(selection().selectedId).toBeNull();
  });

  it('TC-25c: Delete does nothing when no note is selected', () => {
    const id = createIdleNote();
    emptyClick();

    fireEvent.keyDown(window, { key: 'Delete' });

    expect(objects().map((n) => n.id)).toEqual([id]);
  });

  it('TC-36: Enter with nothing selected creates and edits nothing', () => {
    fireEvent.keyDown(window, { key: 'Enter' });

    expect(objects()).toHaveLength(0);
    expect(selection()).toEqual({ selectedId: null, editingId: null });
    expect(screen.queryByTestId('sticky-editor')).toBeNull();
  });
});

describe('sticky.interaction: note disappears mid-interaction', () => {
  beforeEach(() => {
    render(<App />);
  });

  it('TC-37: a note deleted while dragging ends the interaction without an exception', async () => {
    const id = createIdleNote();
    const el = noteEl(id);

    press(el, 350, 250);
    moveTo(el, 370, 250);

    expect(() => {
      act(() => {
        hooks().deleteObject(id);
      });
    }).not.toThrow();

    // Pointer events keep arriving on the detached element afterwards.
    expect(() => {
      moveTo(el, 390, 260);
      release(el, 390, 260);
    }).not.toThrow();
    await flushFrame();

    expect(objects()).toHaveLength(0);
    expect(screen.queryByTestId('sticky-note')).toBeNull();
    expect(selection().selectedId).toBeNull();
  });

  it('TC-37b: a note deleted while editing ends editing without re-creating it', () => {
    const id = dblClickBoard(300, 200);
    const editor = screen.getByTestId('sticky-editor') as HTMLTextAreaElement;
    fireEvent.input(editor, { target: { value: 'keep me' } });

    expect(() => {
      act(() => {
        hooks().deleteObject(id);
      });
    }).not.toThrow();

    expect(objects()).toHaveLength(0);
    expect(screen.queryByTestId('sticky-editor')).toBeNull();
    expect(selection()).toEqual({ selectedId: null, editingId: null });
  });
});

describe('sticky.interaction: colours and text are kept by other operations', () => {
  beforeEach(() => {
    render(<App />);
  });

  it('TC-27 (component part): dragging keeps the text and colour of the note', async () => {
    const id = createIdleNote();
    const el = noteEl(id);
    press(el, 350, 250);
    release(el, 350, 250);
    fireEvent.doubleClick(noteEl(id), { clientX: 300, clientY: 200 });
    const editor = screen.getByTestId('sticky-editor') as HTMLTextAreaElement;
    fireEvent.input(editor, { target: { value: 'Faster onboarding' } });
    fireEvent.keyDown(editor, { key: 'Escape' });

    press(noteEl(id), 350, 250);
    moveTo(noteEl(id), 400, 300);
    release(noteEl(id), 400, 300);
    await flushFrame();

    const note = noteById(id);
    expect(note.text).toBe('Faster onboarding');
    expect(note.color).toBe('yellow');
    // Dragged 50 screen px at zoom 1.
    expect(note.x).toBeCloseTo(200 + 50, 6);
    expect(note.y).toBeCloseTo(100 + 50, 6);
  });
});
