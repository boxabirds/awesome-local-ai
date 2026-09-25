/**
 * Story 8 component tests (TC-14 to TC-17, undo.boundaries): the real App on a real Y.Doc
 * with the real undo controller and story 7 transform gesture.
 */
import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createSticky, snapshot, type StickySnapshot } from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';
import type { Point } from '../../src/client/canvas/camera';
import { editor, noteEl, POINTER_ID, renderBoard } from './boardHelpers';
import { flushFrame } from './helpers';

const HALF = STICKY_SIZE_WORLD / 2;
const START = { x: 300, y: 200 };

type PointerKind = 'pointerDown' | 'pointerMove' | 'pointerUp' | 'pointerCancel';

function ptr(el: Element, type: PointerKind, p: Point, shiftKey = false): void {
  fireEvent[type](el, { clientX: p.x, clientY: p.y, pointerId: POINTER_ID, button: 0, buttons: 1, shiftKey });
}

function clickAt(el: Element, p: Point = { x: 10, y: 10 }, shiftKey = false): void {
  ptr(el, 'pointerDown', p, shiftKey);
  ptr(el, 'pointerUp', p, shiftKey);
}

function noteAt(doc: Y.Doc, x: number, y: number): string {
  return createSticky(doc, { x: x + HALF, y: y + HALF });
}

function note(doc: Y.Doc, id: string): StickySnapshot {
  const n = snapshot(doc).find((s) => s.id === id);
  if (n === undefined) throw new Error(`note ${id} missing`);
  return n;
}

function undoButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement;
}

function redoButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Redo' }) as HTMLButtonElement;
}

/** Drags `el` by (dx, dy) over `frames` animation frames; ends with pointerup or pointercancel. */
function drag(el: Element, dx: number, dy: number, frames: number, end: 'pointerUp' | 'pointerCancel' = 'pointerUp'): void {
  ptr(el, 'pointerDown', START);
  for (let i = 1; i <= frames; i++) {
    ptr(el, 'pointerMove', { x: START.x + (dx * i) / frames, y: START.y + (dy * i) / frames });
    flushFrame();
  }
  ptr(el, end, { x: START.x + dx, y: START.y + dy });
}

describe('undo step boundaries in the board (undo.boundaries)', () => {
  it('TC-14 a 30-frame drag of a selection is one step that restores every start position', () => {
    const doc = new Y.Doc();
    const ids = [noteAt(doc, 0, 0), noteAt(doc, 300, 0), noteAt(doc, 0, 300)];
    renderBoard(doc);
    const before = ids.map((id) => note(doc, id));
    expect(undoButton()).toBeDisabled();
    clickAt(noteEl(ids[0]!));
    clickAt(noteEl(ids[1]!), undefined, true);
    clickAt(noteEl(ids[2]!), undefined, true);

    drag(noteEl(ids[0]!), 600, 450, 30);
    // The board opens at 100%, so screen and world deltas are equal.
    ids.forEach((id, i) => expect(note(doc, id)).toMatchObject({ x: before[i]!.x + 600, y: before[i]!.y + 450 }));
    expect(undoButton()).toBeEnabled();

    fireEvent.click(undoButton());
    ids.forEach((id, i) => expect(note(doc, id)).toMatchObject({ x: before[i]!.x, y: before[i]!.y, z: before[i]!.z }));
    expect(undoButton()).toBeDisabled(); // the whole drag was a single step
    expect(redoButton()).toBeEnabled();

    fireEvent.click(redoButton());
    ids.forEach((id, i) => expect(note(doc, id)).toMatchObject({ x: before[i]!.x + 600, y: before[i]!.y + 450 }));
  });

  it('TC-15 a drag and a colour change 200 ms later are two separate steps', async () => {
    const doc = new Y.Doc();
    const a = noteAt(doc, 0, 0);
    renderBoard(doc);
    const start = note(doc, a);
    clickAt(noteEl(a));
    drag(noteEl(a), 100, 0, 5);
    await act(() => new Promise((r) => setTimeout(r, 200)));
    fireEvent.click(screen.getByRole('button', { name: 'Pink colour' }));
    expect(note(doc, a)).toMatchObject({ x: start.x + 100, color: 'pink' });

    fireEvent.click(undoButton());
    expect(note(doc, a)).toMatchObject({ x: start.x + 100, color: start.color });
    expect(undoButton()).toBeEnabled();
    fireEvent.click(undoButton());
    expect(note(doc, a)).toMatchObject({ x: start.x, color: start.color });
    expect(undoButton()).toBeDisabled();
  });

  it('TC-16 Ctrl+Z inside the editor undoes the typing but not the earlier move', async () => {
    const doc = new Y.Doc();
    const a = noteAt(doc, 0, 0);
    const { user } = renderBoard(doc);
    const start = note(doc, a);
    clickAt(noteEl(a));
    drag(noteEl(a), 80, 40, 3);
    const moved = note(doc, a);
    expect(moved.x).toBe(start.x + 80);

    fireEvent.doubleClick(noteEl(a));
    expect(editor()).not.toBeNull();
    await user.keyboard('hello');
    expect(note(doc, a).text).toBe('hello');

    await user.keyboard('{Control>}z{/Control}');
    expect(note(doc, a).text).toBe('');
    expect(editor()!.value).toBe('');
    // Undo inside the editor never reaches past the typing.
    await user.keyboard('{Control>}z{/Control}');
    expect(note(doc, a)).toMatchObject({ x: moved.x, y: moved.y, text: '' });
    // Redo inside the editor brings the typing back.
    await user.keyboard('{Control>}{Shift>}z{/Shift}{/Control}');
    expect(note(doc, a).text).toBe('hello');
    expect(editor()!.value).toBe('hello');

    // After leaving the note, undo continues through earlier actions.
    await user.keyboard('{Escape}');
    expect(editor()).toBeNull();
    await user.keyboard('{Control>}z{/Control}');
    expect(note(doc, a).text).toBe('');
    await user.keyboard('{Control>}z{/Control}');
    expect(note(doc, a)).toMatchObject({ x: start.x, y: start.y });
  });

  it('TC-17 a drag interrupted by pointercancel is still one step restoring the start', () => {
    const doc = new Y.Doc();
    const a = noteAt(doc, 0, 0);
    renderBoard(doc);
    const start = note(doc, a);
    clickAt(noteEl(a));
    drag(noteEl(a), 200, 100, 10, 'pointerCancel');
    expect(note(doc, a)).toMatchObject({ x: start.x + 200, y: start.y + 100 });
    fireEvent.click(undoButton());
    expect(note(doc, a)).toMatchObject({ x: start.x, y: start.y });
    expect(undoButton()).toBeDisabled();
  });

  it('a new note and its first typing are separate steps', async () => {
    const doc = new Y.Doc();
    const { user } = renderBoard(doc);
    await user.click(screen.getByRole('button', { name: 'Sticky note' }));
    await user.keyboard('idea');
    await user.keyboard('{Escape}');
    expect(snapshot(doc)).toHaveLength(1);
    expect(snapshot(doc)[0]!.text).toBe('idea');
    fireEvent.click(undoButton());
    expect(snapshot(doc)).toHaveLength(1);
    expect(snapshot(doc)[0]!.text).toBe('');
    fireEvent.click(undoButton());
    expect(snapshot(doc)).toHaveLength(0);
  });
});
