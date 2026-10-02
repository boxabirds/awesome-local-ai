import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { App } from '../../src/client/App';
import { deleteObject, moveObject, getStickyText } from '../../src/shared/board-model';
import { DRAG_THRESHOLD_PX, STICKY_SIZE_WORLD } from '../../src/shared/config';
import { flushRaf, getDoc, getNotes, getCamera, makeNote, noteEl, noteById, textarea } from './helpers';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function press(el: HTMLElement, x: number, y: number) {
  fireEvent.pointerDown(el, { pointerId: 1, clientX: x, clientY: y, button: 0, pointerType: 'mouse' });
}

function moveTo(el: HTMLElement, x: number, y: number) {
  fireEvent.pointerMove(el, { pointerId: 1, clientX: x, clientY: y, pointerType: 'mouse' });
}

function release(el: HTMLElement, x: number, y: number) {
  fireEvent.pointerUp(el, { pointerId: 1, clientX: x, clientY: y, pointerType: 'mouse' });
}

describe('StickyNote selection', () => {
  // TC-18
  it('TC-18 selects a note on press and release without moving', () => {
    render(<App />);
    flushRaf();
    const id = makeNote();

    const el = noteEl(id);
    expect(el.getAttribute('data-selected')).toBe('false');
    expect(screen.queryByTestId('note-toolbar')).toBeNull();

    press(el, 400, 400);
    release(el, 400, 400);
    flushRaf();

    expect(noteEl(id).getAttribute('data-selected')).toBe('true');
    expect(noteEl(id).style.outline).not.toBe('none');
    expect(screen.getByTestId('note-toolbar')).toBeInTheDocument();
    // Accessible name from role/label, as the design requires
    expect(screen.getAllByRole('group', { name: 'Sticky note' })).toHaveLength(1);
  });

  // TC-22
  it('TC-22 clears the selection when empty board space is clicked', () => {
    render(<App />);
    flushRaf();
    const id = makeNote();

    const el = noteEl(id);
    press(el, 400, 400);
    release(el, 400, 400);
    flushRaf();
    expect(noteEl(id).getAttribute('data-selected')).toBe('true');

    const viewport = screen.getByTestId('board-viewport');
    press(viewport, 900, 700);
    release(viewport, 900, 700);
    flushRaf();

    expect(noteEl(id).getAttribute('data-selected')).toBe('false');
    expect(screen.queryByTestId('note-toolbar')).toBeNull();
  });

  it('is reachable with Tab: focusing a note selects it and Enter edits it', () => {
    render(<App />);
    flushRaf();
    const id = makeNote();

    // Deselect, then reach the note with the keyboard instead of the mouse
    const viewport = screen.getByTestId('board-viewport');
    press(viewport, 900, 700);
    release(viewport, 900, 700);
    flushRaf();
    expect(noteEl(id).getAttribute('data-selected')).toBe('false');

    fireEvent.focus(noteEl(id));
    flushRaf();
    expect(noteEl(id).getAttribute('data-selected')).toBe('true');
    expect(screen.getByTestId('note-toolbar')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Enter' });
    flushRaf();
    expect(textarea()).not.toBeNull();
  });

  // TC-36
  it('TC-36 does nothing on Enter when no note is selected', () => {
    render(<App />);
    flushRaf();

    fireEvent.keyDown(window, { key: 'Enter' });
    flushRaf();
    expect(getNotes()).toHaveLength(0);
    expect(textarea()).toBeNull();

    makeNote();
    fireEvent.keyDown(window, { key: 'Enter' });
    flushRaf();
    expect(getNotes()).toHaveLength(1);
    expect(textarea()).toBeNull();
  });
});

describe('StickyNote dragging', () => {
  // TC-19
  it('TC-19 selects without moving the note when the pointer moved 2px', () => {
    render(<App />);
    flushRaf();
    const id = makeNote({ x: 300, y: 300 });
    const before = { ...noteById(id)! };
    expect(before.x).toBeCloseTo(300 - STICKY_SIZE_WORLD / 2, 6);

    const el = noteEl(id);
    press(el, 400, 400);
    moveTo(el, 402, 400);
    flushRaf();
    release(el, 402, 400);
    flushRaf();

    const after = noteById(id)!;
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(noteEl(id).getAttribute('data-selected')).toBe('true');
    expect(noteEl(id).getAttribute('data-dragging')).toBe('false');
  });

  // TC-20
  it('TC-20 drags the note at the threshold without panning the board', () => {
    render(<App />);
    flushRaf();
    const id = makeNote({ x: 300, y: 300 });
    const before = { ...noteById(id)! };
    const cameraBefore = { ...getCamera() };
    const worldTransform = screen.getByTestId('world-layer').style.transform;

    const el = noteEl(id);
    press(el, 400, 400);
    moveTo(el, 400 + DRAG_THRESHOLD_PX, 400);
    flushRaf();
    release(el, 400 + DRAG_THRESHOLD_PX, 400);
    flushRaf();

    const after = noteById(id)!;
    expect(after.x).toBeCloseTo(before.x + DRAG_THRESHOLD_PX, 3);
    expect(after.y).toBeCloseTo(before.y, 3);
    expect(noteEl(id).getAttribute('data-selected')).toBe('true');

    // sticky.no_pan: the camera and every other layer stayed put
    expect(getCamera()).toEqual(cameraBefore);
    expect(screen.getByTestId('world-layer').style.transform).toBe(worldTransform);
  });

  // TC-21
  it('TC-21 keeps the last applied position when a drag is cancelled', () => {
    render(<App />);
    flushRaf();
    const id = makeNote({ x: 300, y: 300 });

    const el = noteEl(id);
    press(el, 400, 400);
    moveTo(el, 420, 410);
    flushRaf();
    const cancelled = { ...noteById(id)! };
    expect(cancelled.x).toBeCloseTo(200 + 20, 3);

    fireEvent.pointerCancel(el, { pointerId: 1, pointerType: 'mouse' });
    flushRaf();

    // Later movement is ignored entirely
    moveTo(el, 900, 900);
    flushRaf();
    expect(noteById(id)).toMatchObject({ x: cancelled.x, y: cancelled.y });
    expect(noteEl(id).getAttribute('data-selected')).toBe('true');
  });

  // TC-37 (dragging half)
  it('TC-37 ends a drag silently when the note is deleted mid-drag', () => {
    render(<App />);
    flushRaf();
    const id = makeNote();

    const el = noteEl(id);
    press(el, 400, 400);
    moveTo(el, 430, 400);
    flushRaf();

    act(() => {
      deleteObject(getDoc(), id);
    });
    flushRaf();

    expect(() => {
      moveTo(el, 460, 420);
      flushRaf();
      release(el, 460, 420);
      flushRaf();
    }).not.toThrow();

    expect(getNotes()).toHaveLength(0);
    expect(document.querySelector(`[data-note-id="${id}"]`)).toBeNull();
  });
});

describe('StickyNote stacking', () => {
  it('raises a note to the top when a drag starts', () => {
    render(<App />);
    flushRaf();
    const first = makeNote({ x: 200, y: 200 });
    const second = makeNote({ x: 800, y: 200 });
    expect(getNotes().map((note) => note.id)).toEqual([first, second]);

    const el = noteEl(first);
    press(el, 200, 200);
    moveTo(el, 210, 200);
    flushRaf();
    release(el, 210, 200);
    flushRaf();

    // first now has the highest z, so it renders last
    expect(getNotes().map((note) => note.id)).toEqual([second, first]);
    expect(getNotes()[1].z).toBeGreaterThan(getNotes()[0].z);
  });

  it('raises only once per drag', () => {
    render(<App />);
    flushRaf();
    const id = makeNote({ x: 200, y: 200 });
    const other = makeNote({ x: 800, y: 800 });
    expect(noteById(id)!.z).toBe(1);

    const el = noteEl(id);
    press(el, 200, 200);
    moveTo(el, 210, 210);
    flushRaf();
    moveTo(el, 240, 240);
    flushRaf();
    moveTo(el, 260, 200);
    flushRaf();
    release(el, 260, 200);
    flushRaf();

    // z went from 1 to 3 once, and did not keep climbing each frame
    expect(noteById(id)!.z).toBe(3);
    expect(noteById(other)!.z).toBe(2);
  });
});

describe('StickyNote double-click', () => {
  // TC-35
  it('TC-35 edits the note under the cursor instead of creating a new one', () => {
    render(<App />);
    flushRaf();
    const id = makeNote();
    act(() => {
      getStickyText(getDoc(), id)!.insert(0, 'existing');
    });
    flushRaf();

    fireEvent.doubleClick(noteEl(id));
    flushRaf();

    expect(getNotes()).toHaveLength(1);
    expect(textarea()).not.toBeNull();
    expect(textarea()!.value).toBe('existing');
    expect(noteEl(id).getAttribute('data-selected')).toBe('true');
  });
});

describe('StickyNote keyboard delete', () => {
  // TC-25
  it.each(['Delete', 'Backspace'])('TC-25 removes the selected note on %s', (key) => {
    render(<App />);
    flushRaf();
    const id = makeNote();
    const keep = makeNote({ x: 700, y: 300 });

    const el = noteEl(id);
    press(el, 400, 400);
    release(el, 400, 400);
    flushRaf();
    expect(noteEl(id).getAttribute('data-selected')).toBe('true');

    fireEvent.keyDown(window, { key });
    flushRaf();

    expect(getNotes().map((note) => note.id)).toEqual([keep]);
    expect(document.querySelector(`[data-note-id="${id}"]`)).toBeNull();
    // selection was cleared together with the note
    expect(screen.queryByTestId('note-toolbar')).toBeNull();
  });

  it('ignores Delete when no note is selected', () => {
    render(<App />);
    flushRaf();
    const id = makeNote();

    fireEvent.keyDown(window, { key: 'Delete' });
    flushRaf();
    expect(getNotes().map((note) => note.id)).toEqual([id]);
  });

  it('ignores Delete while another input has focus', () => {
    render(<App />);
    flushRaf();
    const id = makeNote();
    press(noteEl(id), 400, 400);
    release(noteEl(id), 400, 400);
    flushRaf();

    const field = document.createElement('input');
    document.body.appendChild(field);
    field.focus();
    fireEvent.keyDown(field, { key: 'Delete', bubbles: true });
    flushRaf();

    expect(getNotes().map((note) => note.id)).toEqual([id]);
  });
});

describe('StickyNote disappearing mid-interaction', () => {
  // TC-37 (editing half)
  it('TC-37 ends editing silently when the note is deleted', () => {
    render(<App />);
    flushRaf();
    const id = makeNote();
    const el = noteEl(id);
    fireEvent.doubleClick(el);
    flushRaf();
    expect(textarea()).not.toBeNull();

    expect(() => {
      act(() => {
        deleteObject(getDoc(), id);
      });
      flushRaf();
    }).not.toThrow();

    expect(textarea()).toBeNull();
    expect(getNotes()).toHaveLength(0);
    // The editor must not resurrect the note when it unmounts
    act(() => {
      getStickyText(getDoc(), id);
    });
    expect(getNotes()).toHaveLength(0);
    expect(screen.queryByTestId('note-toolbar')).toBeNull();
  });

  it('moveObject on a stale id leaves the board untouched', () => {
    render(<App />);
    flushRaf();
    const id = makeNote();
    act(() => {
      deleteObject(getDoc(), id);
    });
    flushRaf();
    expect(moveObject(getDoc(), id, 10, 10)).toBe(false);
    expect(getNotes()).toHaveLength(0);
  });
});
