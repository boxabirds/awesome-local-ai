/**
 * undo.boundaries (story 8) on the real board: real Y.Doc, real UndoController, story 7's
 * transform gesture and story 2's text editor (TC-14 to TC-17).
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { Board } from '../../src/client/board/Board';
import { resetCamera } from '../../src/client/canvas/camera';
import { newBoardId } from '../../src/shared/board-id';
import { createSticky, type StickySnapshot } from '../../src/shared/board-model';
import { NUDGE_STEP_WORLD, STICKY_SIZE_WORLD, UNDO_CAPTURE_TIMEOUT_MS } from '../../src/shared/config';
import { TEST_VIEWPORT } from './setup';
import { doc, editor, flushFrame, notes } from './stickyHelpers';

const POINTER_ID = 1;
const PRIMARY_BUTTON = 0;
const HALF = 2;
const CAM = resetCamera(TEST_VIEWPORT);
const DRAG_FRAMES = 30;
const FRAME_STEP_PX = 5;
const COLOUR_DELAY_MS = 200;
const KEYSTROKE_GAP_MS = 100;
const SELECTED_NOTES = 5;
const SPACING = 250;
const START_TIME = new Date('2026-09-25T10:00:00Z');

interface Pt {
  x: number;
  y: number;
}

function toScreen(p: Pt): Pt {
  return { x: (p.x - CAM.x) * CAM.zoom, y: (p.y - CAM.y) * CAM.zoom };
}

/** Fake animation frames and a fake clock (the capture timeout reads Date.now). */
function renderRealBoard(): void {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'Date'] });
  vi.setSystemTime(START_TIME);
  render(<Board boardId={newBoardId()} />);
  flushFrame();
}

/** Adds notes the way another person would (not in this person's history). */
function seedNotes(centres: Pt[]): string[] {
  const local = doc();
  const remote = new Y.Doc();
  Y.applyUpdate(remote, Y.encodeStateAsUpdate(local));
  const before = Y.encodeStateVector(remote);
  const ids = centres.map((c) => createSticky(remote, c));
  act(() => {
    Y.applyUpdate(local, Y.encodeStateAsUpdate(remote, before), 'remote');
  });
  return ids;
}

function note(id: string): StickySnapshot {
  const n = notes().find((x) => x.id === id);
  if (!n) throw new Error(`note ${id} missing`);
  return n;
}

function positions(ids: string[]): Pt[] {
  return ids.map((id) => ({ x: note(id).x, y: note(id).y }));
}

function noteEl(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-id="${id}"]`);
  if (!el) throw new Error(`note ${id} not rendered`);
  return el;
}

function centreOnScreen(id: string): Pt {
  const n = note(id);
  return toScreen({ x: n.x + STICKY_SIZE_WORLD / HALF, y: n.y + STICKY_SIZE_WORLD / HALF });
}

function pointer(type: 'pointerDown' | 'pointerMove' | 'pointerUp' | 'pointerCancel', el: Element, p: Pt): void {
  fireEvent[type](el, { pointerId: POINTER_ID, button: PRIMARY_BUTTON, clientX: p.x, clientY: p.y });
}

/** Presses on `id` and moves DRAG_FRAMES frames; returns the last pointer position. */
function dragFrames(id: string, frames = DRAG_FRAMES): { el: HTMLElement; at: Pt } {
  const el = noteEl(id);
  const start = centreOnScreen(id);
  pointer('pointerDown', el, start);
  let at = start;
  for (let i = 1; i <= frames; i += 1) {
    at = { x: start.x + i * FRAME_STEP_PX, y: start.y + i };
    pointer('pointerMove', el, at);
    flushFrame();
  }
  return { el, at };
}

function drag(id: string): void {
  const { el, at } = dragFrames(id);
  pointer('pointerUp', el, at);
  flushFrame();
}

function wait(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function ctrlZ(target: Element = document.body): boolean {
  return !fireEvent.keyDown(target, { key: 'z', ctrlKey: true });
}

function undoButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Undo' });
}

beforeEach(() => {
  vi.useRealTimers();
});

describe('undo.boundaries', () => {
  it('TC-14 a 30-frame drag of 5 selected notes is one step: one undo restores every start position', () => {
    renderRealBoard();
    const ids = seedNotes(Array.from({ length: SELECTED_NOTES }, (_, i) => ({ x: i * SPACING - 400, y: 0 })));
    expect(undoButton().disabled).toBe(true);
    fireEvent.keyDown(document.body, { key: 'a', ctrlKey: true });
    expect(window.__vidi6!.getSelection().sort()).toEqual([...ids].sort());
    const start = positions(ids);

    drag(ids[0]!);
    const moved = positions(ids);
    moved.forEach((p, i) => expect(p.x).toBeGreaterThan(start[i]!.x));

    expect(ctrlZ()).toBe(true);
    expect(positions(ids)).toEqual(start);
    expect(undoButton().disabled).toBe(true);
  });

  it('TC-14 a drag stays one step even when the pointer is held still longer than the typing pause', () => {
    renderRealBoard();
    const [id] = seedNotes([{ x: 0, y: 0 }]);
    const start = positions([id!]);
    const { el, at } = dragFrames(id!, DRAG_FRAMES / HALF);
    wait(UNDO_CAPTURE_TIMEOUT_MS * HALF);
    const later = { x: at.x + FRAME_STEP_PX * DRAG_FRAMES, y: at.y };
    pointer('pointerMove', el, later);
    flushFrame();
    pointer('pointerUp', el, later);
    flushFrame();
    ctrlZ();
    expect(positions([id!])).toEqual(start);
    expect(undoButton().disabled).toBe(true);
  });

  it('TC-15 a drag and a colour change 200 ms later are two separate steps', () => {
    renderRealBoard();
    const [id] = seedNotes([{ x: 0, y: 0 }]);
    const start = note(id!);
    drag(id!);
    const moved = note(id!);
    wait(COLOUR_DELAY_MS);
    fireEvent.click(screen.getByRole('button', { name: 'Blue colour' }));
    expect(note(id!).color).toBe('blue');

    ctrlZ();
    expect(note(id!)).toMatchObject({ color: start.color, x: moved.x, y: moved.y });
    ctrlZ();
    expect(note(id!)).toMatchObject({ color: start.color, x: start.x, y: start.y });
  });

  it('TC-16 Ctrl+Z while typing undoes the typing only; the earlier move is undone after leaving the note', () => {
    renderRealBoard();
    const [id] = seedNotes([{ x: 0, y: 0 }]);
    const start = note(id!);
    drag(id!);
    const moved = note(id!);

    fireEvent.doubleClick(noteEl(id!));
    const textarea = editor()!;
    expect(textarea).not.toBeNull();
    let typed = '';
    for (const ch of 'hello') {
      typed += ch;
      fireEvent.change(textarea, { target: { value: typed } });
      wait(KEYSTROKE_GAP_MS);
    }
    expect(note(id!).text).toBe('hello');

    expect(ctrlZ(textarea)).toBe(true);
    expect(note(id!).text).toBe('');
    expect(textarea.value).toBe('');
    expect(note(id!)).toMatchObject({ x: moved.x, y: moved.y });
    // Undo inside the editor stops at the start of this edit: the move is not undone.
    expect(ctrlZ(textarea)).toBe(true);
    expect(note(id!)).toMatchObject({ x: moved.x, y: moved.y });
    // Redo inside the editor brings the typing back.
    expect(!fireEvent.keyDown(textarea, { key: 'Z', ctrlKey: true, shiftKey: true })).toBe(true);
    expect(note(id!).text).toBe('hello');
    expect(textarea.value).toBe('hello');
    ctrlZ(textarea);
    expect(note(id!).text).toBe('');

    fireEvent.keyDown(textarea, { key: 'Escape' });
    expect(editor()).toBeNull();
    ctrlZ();
    expect(note(id!)).toMatchObject({ x: start.x, y: start.y });
  });

  it('TC-16 typing pauses of UNDO_CAPTURE_TIMEOUT_MS split bursts; edit end closes the last burst', () => {
    renderRealBoard();
    const [id] = seedNotes([{ x: 0, y: 0 }]);
    fireEvent.doubleClick(noteEl(id!));
    const textarea = editor()!;
    fireEvent.change(textarea, { target: { value: 'one' } });
    wait(UNDO_CAPTURE_TIMEOUT_MS);
    fireEvent.change(textarea, { target: { value: 'one two' } });
    fireEvent.keyDown(textarea, { key: 'Escape' });
    // Board-level undo after leaving the note: one burst at a time, then nothing more.
    ctrlZ();
    expect(note(id!).text).toBe('one');
    ctrlZ();
    expect(note(id!).text).toBe('');
    expect(undoButton().disabled).toBe(true);
  });

  it('TC-17 pointercancel mid-drag is still one step restoring the start position', () => {
    renderRealBoard();
    const [id] = seedNotes([{ x: 0, y: 0 }]);
    const start = positions([id!]);
    const { el, at } = dragFrames(id!);
    pointer('pointerCancel', el, at);
    flushFrame();
    expect(positions([id!])).not.toEqual(start);
    ctrlZ();
    expect(positions([id!])).toEqual(start);
    expect(undoButton().disabled).toBe(true);
  });

  it('a created note, then its first typing, are separate steps', () => {
    renderRealBoard();
    fireEvent.click(screen.getByRole('button', { name: 'Sticky note' }));
    const textarea = editor()!;
    fireEvent.change(textarea, { target: { value: 'idea' } });
    fireEvent.keyDown(textarea, { key: 'Escape' });
    expect(notes()).toHaveLength(1);
    ctrlZ();
    expect(notes()).toHaveLength(1);
    expect(notes()[0]!.text).toBe('');
    ctrlZ();
    expect(notes()).toHaveLength(0);
  });

  it('delete of a selection and each nudge are single steps', () => {
    renderRealBoard();
    const ids = seedNotes([
      { x: 0, y: 0 },
      { x: SPACING, y: 0 },
    ]);
    const start = positions(ids);
    fireEvent.keyDown(document.body, { key: 'a', ctrlKey: true });
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    fireEvent.keyDown(document.body, { key: 'Delete' });
    expect(notes()).toHaveLength(0);
    ctrlZ();
    expect(notes()).toHaveLength(ids.length);
    ctrlZ();
    expect(positions(ids)).toEqual(start.map((p) => ({ x: p.x + NUDGE_STEP_WORLD, y: p.y })));
    ctrlZ();
    expect(positions(ids)).toEqual(start);
  });
});
