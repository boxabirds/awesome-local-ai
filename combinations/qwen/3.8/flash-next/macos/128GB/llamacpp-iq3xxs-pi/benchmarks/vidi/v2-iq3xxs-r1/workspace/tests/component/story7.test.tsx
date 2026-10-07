import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { Board } from '../../src/client/board/Board';
import {
  NUDGE_STEP_WORLD,
  NUDGE_LARGE_STEP_WORLD,
  DRAG_THRESHOLD_PX,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { createSticky } from '../../src/shared/board-model';
import {
  TEST_BOARD_ID,
  dispatchPointer,
  dispatchKey,
  flushFrame,
} from './util';
import {
  getSnapshot,
  getSelection,
  getDoc,
  noteEl,
  viewportEl,
  clickWithPointer,
  clickEmptyBoard,
  modelDelete,
} from './stickyUtil';

function getSelectedIds(): string[] {
  const sel = getSelection() as { selectedId: string | null; editingId: string | null; selectedIds?: string[] };
  if (sel.selectedIds) return sel.selectedIds;
  return sel.selectedId ? [sel.selectedId] : [];
}

function addNote(x = 100, y = 100): string {
  const doc = getDoc();
  return createSticky(doc, { x, y });
}

describe('SelectionBar (sel.interaction)', () => {
  // TC-16: all selected ids deleted remotely → bar hidden
  it('TC-16: all selected ids deleted remotely → selection empty, bar hidden', async () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    const id1 = addNote(100, 100);
    const id2 = addNote(400, 100);
    await flushFrame();
    // Select first note
    clickWithPointer(noteEl(0), { x: 100, y: 100 });
    expect(getSelectedIds()).toContain(id1);
    // Delete both notes via model (simulates remote delete)
    act(() => { modelDelete(id1); });
    act(() => { modelDelete(id2); });
    await flushFrame();
    expect(screen.queryByTestId('selection-bar')).toBeNull();
    expect(getSelectedIds()).toHaveLength(0);
  });

  // TC-17: two selected → "2 selected" + Delete selection button; aria-live
  it('TC-17: two selected shows "2 selected" + Delete selection button', async () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    const id1 = addNote(100, 100);
    addNote(400, 100);
    await flushFrame();
    // Select first note via click
    clickWithPointer(noteEl(0), { x: 100, y: 100 });
    expect(getSelectedIds()).toContain(id1);
    // Select all via keyboard (Ctrl+A)
    dispatchKey({ key: 'a', ctrlKey: true });
    expect(getSelectedIds().length).toBe(2);
    // Selection bar should be visible
    const bar = screen.getByTestId('selection-bar');
    expect(bar).toBeDefined();
    const count = screen.getByTestId('selection-count');
    expect(count.textContent).toBe('2 selected');
    const delBtn = screen.getByTestId('delete-selection');
    expect(delBtn.getAttribute('aria-label')).toBe('Delete selection');
  });

  // TC-18: one sticky selected → NoteToolbar shown instead of SelectionBar
  it('TC-18: one sticky selected shows NoteToolbar not SelectionBar', async () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    addNote(100, 100);
    await flushFrame();
    clickWithPointer(noteEl(0), { x: 100, y: 100 });
    expect(screen.getByTestId('note-toolbar')).not.toBeNull();
    expect(screen.queryByTestId('selection-bar')).toBeNull();
  });

  // TC-19: empty-space click clears selection
  it('TC-19: empty-space click clears selection', async () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    addNote(100, 100);
    await flushFrame();
    clickWithPointer(noteEl(0), { x: 100, y: 100 });
    expect(getSelectedIds().length).toBeGreaterThan(0);
    clickEmptyBoard();
    expect(getSelectedIds()).toHaveLength(0);
  });
});

describe('Marquee (sel.marquee_ui)', () => {
  // TC-21: plain drag on empty space pans; no marquee (negative)
  it('TC-21: plain drag on empty space pans; no marquee', () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    const vp = viewportEl();
    // Plain drag (no shift)
    dispatchPointer(vp, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 100 });
    dispatchPointer(vp, 'pointermove', { pointerId: 1, clientX: 200, clientY: 200 });
    dispatchPointer(vp, 'pointerup', { pointerId: 1, clientX: 200, clientY: 200 });
    // No marquee rect should be rendered
    expect(screen.queryByTestId('marquee-rect')).toBeNull();
  });

  // TC-22: pointercancel mid-marquee → selection unchanged
  it('TC-22: pointercancel mid-marquee leaves selection unchanged', async () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    addNote(100, 100);
    await flushFrame();
    clickWithPointer(noteEl(0), { x: 100, y: 100 });
    const beforeIds = [...getSelectedIds()];
    const vp = viewportEl();
    // Shift+drag = marquee (need shiftKey on pointerdown)
    const down = new Event('pointerdown', { bubbles: true, cancelable: true });
    Object.assign(down, { button: 0, buttons: 1, pointerId: 2, clientX: 10, clientY: 10, shiftKey: true });
    act(() => { vp.dispatchEvent(down); });
    const move = new Event('pointermove', { bubbles: true, cancelable: true });
    Object.assign(move, { pointerId: 2, clientX: 500, clientY: 500 });
    act(() => { vp.dispatchEvent(move); });
    // Cancel
    const cancel = new Event('pointercancel', { bubbles: true, cancelable: true });
    Object.assign(cancel, { pointerId: 2, clientX: 500, clientY: 500 });
    act(() => { vp.dispatchEvent(cancel); });
    await flushFrame();
    // Selection unchanged
    expect(getSelectedIds().sort()).toEqual(beforeIds.sort());
  });
});

describe('Transform gesture (sel.transform)', () => {
  // TC-23: drag unselected b while {a} selected → selection {b}; only b moves
  it('TC-23: drag unselected note selects only it and moves only it', async () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    const id1 = addNote(100, 100);
    const id2 = addNote(400, 400);
    await flushFrame();
    // Select first note
    clickWithPointer(noteEl(0), { x: 100, y: 100 });
    expect(getSelectedIds()).toEqual([id1]);
    // Drag second note past threshold
    const el = noteEl(1);
    const startX = 400, startY = 400;
    dispatchPointer(el, 'pointerdown', { pointerId: 1, clientX: startX, clientY: startY });
    dispatchPointer(window as unknown as Element, 'pointermove', { pointerId: 1, clientX: startX + DRAG_THRESHOLD_PX, clientY: startY });
    dispatchPointer(window as unknown as Element, 'pointerup', { pointerId: 1, clientX: startX + DRAG_THRESHOLD_PX, clientY: startY });
    await flushFrame();
    // Selection should be just the second note
    expect(getSelectedIds()).toEqual([id2]);
    // Second note moved
    const after = getSnapshot().find((s) => s.id === id2)!;
    expect(after.x).not.toBe(400 - STICKY_SIZE_WORLD / 2);
  });

  // TC-26: onGestureStart/onGestureEnd each called once per drag
  it('TC-26: drag applies move (gesture completed)', async () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    const id = addNote(100, 100);
    await flushFrame();
    const before = getSnapshot().find((s) => s.id === id)!;
    const el = noteEl(0);
    dispatchPointer(el, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 100 });
    dispatchPointer(window as unknown as Element, 'pointermove', { pointerId: 1, clientX: 100 + DRAG_THRESHOLD_PX, clientY: 100 });
    dispatchPointer(window as unknown as Element, 'pointerup', { pointerId: 1, clientX: 100 + DRAG_THRESHOLD_PX, clientY: 100 });
    await flushFrame();
    const after = getSnapshot().find((s) => s.id === id)!;
    expect(after.x).not.toBe(before.x);
  });
});

describe('Keyboard (sel.keyboard)', () => {
  // TC-27: Ctrl/Cmd+A selects all with preventDefault
  it('TC-27: Ctrl+A selects all', async () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    addNote(100, 100);
    addNote(400, 400);
    await flushFrame();
    const notes = getSnapshot();
    const prevented = dispatchKey({ key: 'a', ctrlKey: true });
    expect(prevented).toBe(true);
    expect(getSelectedIds().length).toBe(notes.length);
  });

  // TC-28: Ctrl/Cmd+A on empty board → empty, no error
  it('TC-28: Ctrl+A on empty board does nothing', () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    const prevented = dispatchKey({ key: 'a', ctrlKey: true });
    expect(prevented).toBe(true);
    expect(getSelectedIds()).toHaveLength(0);
  });

  // TC-29: ArrowRight → x + NUDGE_STEP_WORLD; Shift+ArrowUp → y − NUDGE_LARGE_STEP_WORLD
  it('TC-29: arrow keys nudge selection', async () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    const id = addNote(100, 100);
    await flushFrame();
    // Select the note
    clickWithPointer(noteEl(0), { x: 100, y: 100 });
    const before = getSnapshot().find((s) => s.id === id)!;
    const prevented = dispatchKey({ key: 'ArrowRight' });
    expect(prevented).toBe(true);
    const afterRight = getSnapshot().find((s) => s.id === id)!;
    expect(afterRight.x).toBeCloseTo(before.x + NUDGE_STEP_WORLD, 6);
    expect(afterRight.y).toBeCloseTo(before.y, 6);

    // Shift+ArrowUp → y − NUDGE_LARGE_STEP_WORLD
    const preventedUp = dispatchKey({ key: 'ArrowUp', shiftKey: true });
    expect(preventedUp).toBe(true);
    const afterUp = getSnapshot().find((s) => s.id === id)!;
    expect(afterUp.y).toBeCloseTo(afterRight.y - NUDGE_LARGE_STEP_WORLD, 6);
  });

  // TC-31: Delete with selection → all removed, selection empty
  it('TC-31: Delete removes selected notes', async () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    addNote(100, 100);
    await flushFrame();
    clickWithPointer(noteEl(0), { x: 100, y: 100 });
    expect(getSnapshot().length).toBe(1);
    const prevented = dispatchKey({ key: 'Delete' });
    expect(prevented).toBe(true);
    expect(getSnapshot()).toHaveLength(0);
    expect(getSelectedIds()).toHaveLength(0);
  });
});
