import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { act } from 'react';
import { deleteObject, type StickySnapshot } from '@/shared/board-model';
import { renderFullApp, firePointer, hooks, makeNote, pressKey, setText, typeText } from './story2';

// Story 5: the board page checks existence before rendering the board; keep
// these story-2 tests exercising the board UI directly.
vi.mock('@/client/api', () => ({
  checkBoard: vi.fn(async () => ({ kind: 'exists' })),
  createBoardRequest: vi.fn(async () => ({ kind: 'failed' })),
}));

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Screen position of the centre of a note whose top-left is at world (x, y),
 *  given the initial camera (jsdom window 1024x768, camera -512,-384, zoom 1). */
function noteScreenCentre(note: StickySnapshot): { x: number; y: number } {
  return { x: note.x + 100 + 512, y: note.y + 100 + 384 };
}

function noteElement(id: string): HTMLElement {
  const el = document.querySelector(`[data-id="${id}"]`);
  if (!el) throw new Error(`note ${id} not found`);
  return el as HTMLElement;
}

function selectNote(id: string): void {
  const p = noteScreenCentre(hooks().getNotes().find((n) => n.id === id)!);
  firePointer(noteElement(id), 'pointerdown', p.x, p.y);
  firePointer(noteElement(id), 'pointerup', p.x, p.y);
}

function clickEmptyBoard(x = 60, y = 60): void {
  const viewport = screen.getByTestId('board-viewport');
  firePointer(viewport, 'pointerdown', x, y);
  firePointer(viewport, 'pointerup', x, y);
}

describe('StickyNote interaction (story 2)', () => {
  it('TC-18: pointerdown+up without movement selects; outline and NoteToolbar render', async () => {
    await renderFullApp();
    const id = makeNote(0, 0);
    const p = noteScreenCentre(hooks().getNotes()[0]);
    const note = noteElement(id);
    expect(note.hasAttribute('data-selected')).toBe(false);

    firePointer(note, 'pointerdown', p.x, p.y);
    firePointer(note, 'pointerup', p.x, p.y);

    expect(note.hasAttribute('data-selected')).toBe(true);
    expect(note.style.outline).toMatch(/1a73e8/i);
    expect(screen.getByTestId('note-toolbar')).toBeInTheDocument();
  });

  it('TC-19: a 2px movement is below DRAG_THRESHOLD_PX; no move is applied', async () => {
    await renderFullApp();
    const id = makeNote(0, 0);
    const p = noteScreenCentre(hooks().getNotes()[0]);
    const note = noteElement(id);

    firePointer(note, 'pointerdown', p.x, p.y);
    firePointer(note, 'pointermove', p.x + 2, p.y);
    firePointer(note, 'pointerup', p.x + 2, p.y);

    const note2 = hooks().getNotes()[0];
    expect(note2.x).toBe(-100); // unchanged
    expect(note2.y).toBe(-100); // unchanged
    expect(noteElement(id).hasAttribute('data-selected')).toBe(true);
  });

  it('TC-20: a 3px movement starts a drag; the camera is unchanged (no pan)', async () => {
    await renderFullApp();
    const id = makeNote(0, 0);
    const p = noteScreenCentre(hooks().getNotes()[0]);
    const note = noteElement(id);
    const worldLayer = document.querySelector('[data-testid="world-layer"]') as HTMLElement;
    const transformBefore = worldLayer.style.transform;

    firePointer(note, 'pointerdown', p.x, p.y);
    firePointer(note, 'pointermove', p.x + 3, p.y);

    expect(note.style.cursor).toBe('grabbing'); // Dragging
    expect(worldLayer.style.transform).toBe(transformBefore); // camera unchanged

    // End the drag so no work is left pending.
    firePointer(note, 'pointerup', p.x + 3, p.y);
    expect(noteElement(id).style.cursor).toBe('grab');
    expect(noteElement(id).hasAttribute('data-selected')).toBe(true);
  });

  it('TC-21: pointercancel ends the drag in Selected; the note keeps its last applied position', async () => {
    await renderFullApp();
    const id = makeNote(0, 0);
    const p = noteScreenCentre(hooks().getNotes()[0]);
    const note = noteElement(id);

    firePointer(note, 'pointerdown', p.x, p.y);
    firePointer(note, 'pointermove', p.x + 50, p.y + 50);
    firePointer(note, 'pointercancel', p.x + 50, p.y + 50);

    const note2 = hooks().getNotes()[0];
    expect(note2.x).toBe(-100 + 50); // last applied position
    expect(note2.y).toBe(-100 + 50);
    expect(noteElement(id).hasAttribute('data-selected')).toBe(true);
    expect(noteElement(id).style.cursor).toBe('grab');
  });

  it('TC-22: clicking empty board deselects; the toolbar is removed', async () => {
    await renderFullApp();
    const id = makeNote(0, 0);
    selectNote(id);
    expect(noteElement(id).hasAttribute('data-selected')).toBe(true);
    expect(screen.getByTestId('note-toolbar')).toBeInTheDocument();

    clickEmptyBoard();

    expect(noteElement(id).hasAttribute('data-selected')).toBe(false);
    expect(screen.queryByTestId('note-toolbar')).not.toBeInTheDocument();
  });

  it('TC-23: pressing Enter on a selected note starts editing with the caret at the end', async () => {
    await renderFullApp();
    const id = makeNote(0, 0);
    setText(id, 'abc');
    selectNote(id);

    pressKey(window, 'Enter');

    const textarea = screen.getByTestId('sticky-textarea') as HTMLTextAreaElement;
    expect(document.activeElement).toBe(textarea);
    expect(textarea.selectionStart).toBe(3); // caret at end of 'abc'
    expect(textarea.selectionEnd).toBe(3);
  });

  it('TC-24: pressing Escape ends editing, keeps the selection and the text', async () => {
    await renderFullApp();
    const id = makeNote(0, 0);
    setText(id, 'hello');
    selectNote(id);
    pressKey(window, 'Enter');
    expect(screen.getByTestId('sticky-textarea')).toBeInTheDocument();

    pressKey(screen.getByTestId('sticky-textarea'), 'Escape');

    expect(screen.queryByTestId('sticky-textarea')).not.toBeInTheDocument();
    expect(noteElement(id).hasAttribute('data-selected')).toBe(true);
    expect(hooks().getNotes()[0].text).toBe('hello');
  });

  it('TC-25 (Delete): pressing Delete removes the selected note', async () => {
    await renderFullApp();
    const id = makeNote(0, 0);
    selectNote(id);

    pressKey(window, 'Delete');

    expect(hooks().getNotes()).toHaveLength(0);
  });

  it('TC-25 (Backspace): pressing Backspace removes the selected note', async () => {
    await renderFullApp();
    const id = makeNote(0, 0);
    selectNote(id);

    pressKey(window, 'Backspace');

    expect(hooks().getNotes()).toHaveLength(0);
  });

  it('TC-26: Backspace while editing edits the text, it does not delete the note', async () => {
    await renderFullApp();
    const id = makeNote(0, 0);
    setText(id, 'ab');
    selectNote(id);
    pressKey(window, 'Enter');
    const textarea = screen.getByTestId('sticky-textarea') as HTMLTextAreaElement;

    // The window-level Delete/Backspace handler must ignore editing.
    pressKey(textarea, 'Backspace');
    expect(hooks().getNotes()).toHaveLength(1);

    // The user deleted the last character in the textarea.
    typeText(textarea, 'a');

    expect(hooks().getNotes()).toHaveLength(1);
    expect(hooks().getNotes()[0].text).toBe('a');
  });

  it('TC-35: double-clicking an existing note edits it and does not create a new note', async () => {
    await renderFullApp();
    const id = makeNote(0, 0);
    const p = noteScreenCentre(hooks().getNotes()[0]);

    const dbl = new MouseEvent('dblclick', { bubbles: true, cancelable: true });
    Object.defineProperty(dbl, 'clientX', { value: p.x });
    Object.defineProperty(dbl, 'clientY', { value: p.y });
    act(() => {
      noteElement(id).dispatchEvent(dbl);
    });

    expect(hooks().getNotes()).toHaveLength(1);
    expect(screen.getByTestId('sticky-textarea')).toBeInTheDocument();
  });

  it('TC-36: pressing Enter with nothing selected does nothing', async () => {
    await renderFullApp();

    pressKey(window, 'Enter');

    expect(hooks().getNotes()).toHaveLength(0);
    expect(screen.queryByTestId('sticky-textarea')).not.toBeInTheDocument();
  });

  it('TC-37 (drag): a note deleted while dragging ends the interaction without exceptions or re-creation', async () => {
    await renderFullApp();
    const id = makeNote(0, 0);
    const p = noteScreenCentre(hooks().getNotes()[0]);

    firePointer(noteElement(id), 'pointerdown', p.x, p.y);
    firePointer(noteElement(id), 'pointermove', p.x + 50, p.y + 50); // Dragging

    // Deleted mid-drag via a model call (another client or the bin).
    act(() => {
      expect(deleteObject(hooks().getDoc(), id)).toBe(true);
    });

    // The pointer is released on the (now removed) note: no exception.
    expect(() => {
      firePointer(document.body, 'pointerup', p.x + 50, p.y + 50);
    }).not.toThrow();

    expect(hooks().getNotes()).toHaveLength(0);
    expect(screen.queryByTestId('sticky-textarea')).not.toBeInTheDocument();
  });

  it('TC-37 (edit): a note deleted while editing ends editing without exceptions or re-creation', async () => {
    await renderFullApp();
    const id = makeNote(0, 0);
    setText(id, 'keep');
    selectNote(id);
    pressKey(window, 'Enter');
    expect(screen.getByTestId('sticky-textarea')).toBeInTheDocument();

    expect(() => {
      act(() => {
        expect(deleteObject(hooks().getDoc(), id)).toBe(true);
      });
    }).not.toThrow();

    expect(hooks().getNotes()).toHaveLength(0);
    expect(screen.queryByTestId('sticky-textarea')).not.toBeInTheDocument();
  });
});
