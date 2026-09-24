import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, vi } from 'vitest';
import type * as Y from 'yjs';
import { App } from '../../src/client/App';
import type { Camera } from '../../src/client/canvas/camera';
import type { StickySnapshot } from '../../src/shared/board-model';

/** Longer than one animation frame under fake timers. */
const FRAME_MS = 20;
export const POINTER_ID = 1;
const PRIMARY_BUTTON = 0;

export function flushFrame(): void {
  act(() => {
    vi.advanceTimersByTime(FRAME_MS);
  });
}

/**
 * Renders the whole app with fake animation frames (drags and camera commit per frame).
 * setTimeout stays real: Testing Library's async wrapper (used by user-event) waits on a real
 * setTimeout(0) and only auto-advances Jest's fake timers, not Vitest's.
 */
export function renderBoard(): void {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
  render(<App />);
  flushFrame();
}

function hooks() {
  const h = window.__vidi6;
  if (!h) throw new Error('test hooks not installed');
  return h;
}

export function notes(): readonly StickySnapshot[] {
  return hooks().getNotes();
}

export function doc(): Y.Doc {
  return hooks().getDoc();
}

export function camera(): Camera {
  return hooks().getCamera();
}

export function board(): HTMLElement {
  return screen.getByTestId('board-viewport');
}

export function noteEls(): HTMLElement[] {
  return screen.queryAllByRole('group', { name: 'Sticky note' });
}

export function onlyNoteEl(): HTMLElement {
  const els = noteEls();
  expect(els).toHaveLength(1);
  return els[0]!;
}

export function noteToolbar(): HTMLElement | null {
  return screen.queryByRole('toolbar', { name: 'Note' });
}

export function editor(): HTMLTextAreaElement | null {
  return screen.queryByRole('textbox', { name: 'Note text' });
}

export function press(el: Element, x: number, y: number): void {
  fireEvent.pointerDown(el, { pointerId: POINTER_ID, button: PRIMARY_BUTTON, clientX: x, clientY: y });
}

export function move(el: Element, x: number, y: number): void {
  fireEvent.pointerMove(el, { pointerId: POINTER_ID, clientX: x, clientY: y });
}

export function release(el: Element, x: number, y: number): void {
  fireEvent.pointerUp(el, { pointerId: POINTER_ID, button: PRIMARY_BUTTON, clientX: x, clientY: y });
}

/** Press and release without moving. */
export function click(el: Element, x: number, y: number): void {
  press(el, x, y);
  release(el, x, y);
}

/** Double-click on empty board space: two clicks then dblclick, as a browser sends them. */
export function doubleClickBoard(x: number, y: number): void {
  click(board(), x, y);
  click(board(), x, y);
  fireEvent.doubleClick(board(), { clientX: x, clientY: y });
}

/** Creates a note by double-clicking empty board, then presses Escape: note is Selected. */
export function createSelectedNote(x = 400, y = 300): HTMLElement {
  doubleClickBoard(x, y);
  const textarea = editor();
  if (!textarea) throw new Error('new note is not in edit mode');
  const el = textarea.closest<HTMLElement>('[role="group"]');
  if (!el) throw new Error('editor is not inside a note');
  fireEvent.keyDown(textarea, { key: 'Escape' });
  return el;
}

/** Clicks empty board space (clears the selection). */
export function clickEmptyBoard(x = 1000, y = 700): void {
  click(board(), x, y);
}

export function user() {
  return userEvent.setup({ delay: null });
}
