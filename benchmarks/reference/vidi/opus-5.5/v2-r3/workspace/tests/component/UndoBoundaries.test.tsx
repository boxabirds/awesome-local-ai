import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createSticky, getStickyText, snapshot } from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';
import { boardDoc, flushFrame, model, noteEl, press, readCamera, renderApp } from './helpers';

const HALF = STICKY_SIZE_WORLD / 2;

// rAF frames, timers and the clock are all fake so capture timing is exact.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(new Date('2026-09-30T10:00:00Z'));
});
afterEach(() => vi.useRealTimers());

/** Seeds a note as already-loaded board state (non-local origin, so not in my history). */
function noteAt(x: number, y: number): string {
  return model((doc) => {
    const scratch = new Y.Doc();
    Y.applyUpdate(scratch, Y.encodeStateAsUpdate(doc));
    const before = Y.encodeStateVector(scratch);
    const id = createSticky(scratch, { x: x + HALF, y: y + HALF });
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(scratch, before), 'seed');
    return id;
  });
}

function positions(): Record<string, { x: number; y: number }> {
  return Object.fromEntries(snapshot(boardDoc()).map((n) => [n.id, { x: n.x, y: n.y }]));
}

function shiftPress(el: Element) {
  fireEvent.pointerDown(el, { pointerId: 1, button: 0, shiftKey: true, clientX: 100, clientY: 100 });
  fireEvent.pointerUp(el, { pointerId: 1, shiftKey: true, clientX: 100, clientY: 100 });
}

function ctrlZ(target: EventTarget = document.body, init: KeyboardEventInit = {}) {
  const ev = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(ev);
  });
  return ev;
}

function wait(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function undoButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Undo' });
}

/** Drags `el` by (dx, dy) screen px in `frames` animation frames; ends with pointerup or pointercancel. */
function dragInFrames(el: Element, dx: number, dy: number, frames: number, end: 'up' | 'cancel' = 'up') {
  const start = { clientX: 100, clientY: 100 };
  fireEvent.pointerDown(el, { pointerId: 1, button: 0, ...start });
  for (let i = 1; i <= frames; i++) {
    fireEvent.pointerMove(el, {
      pointerId: 1,
      clientX: start.clientX + (dx * i) / frames,
      clientY: start.clientY + (dy * i) / frames,
    });
    flushFrame();
  }
  const last = { clientX: start.clientX + dx, clientY: start.clientY + dy };
  if (end === 'up') fireEvent.pointerUp(el, { pointerId: 1, ...last });
  else fireEvent.pointerCancel(el, { pointerId: 1 });
  flushFrame();
}

describe('undo.boundaries (wiring)', () => {
  it('TC-14 a 30-frame drag of a 5-note selection is one step; one undo restores every start position', () => {
    const { viewport } = renderApp();
    const ids = [0, 1, 2, 3, 4].map((i) => noteAt(i * 250, 0));
    const start = positions();
    press(noteEl(ids[0]));
    for (const id of ids.slice(1)) shiftPress(noteEl(id));

    const zoom = readCamera(viewport).zoom;
    dragInFrames(noteEl(ids[0]), 300, 150, 30);
    for (const id of ids) {
      expect(positions()[id].x).toBeCloseTo(start[id].x + 300 / zoom, 6);
      expect(positions()[id].y).toBeCloseTo(start[id].y + 150 / zoom, 6);
    }
    expect(undoButton()).toBeEnabled();

    const ev = ctrlZ();
    expect(ev.defaultPrevented).toBe(true);
    expect(positions()).toEqual(start);
    // One step only: the history is now empty.
    expect(undoButton()).toBeDisabled();
  });

  it('TC-15 a colour change 200 ms after a drag is a separate step', () => {
    renderApp();
    const id = noteAt(0, 0);
    press(noteEl(id));
    dragInFrames(noteEl(id), 120, 0, 5);
    const moved = positions()[id];
    wait(200);
    fireEvent.click(screen.getByRole('button', { name: 'Pink colour' }));
    expect(snapshot(boardDoc())[0].color).toBe('pink');

    fireEvent.click(undoButton());
    expect(snapshot(boardDoc())[0].color).toBe('yellow');
    expect(positions()[id]).toEqual(moved);

    fireEvent.click(undoButton());
    expect(positions()[id]).toEqual({ x: 0, y: 0 });
    expect(undoButton()).toBeDisabled();
  });

  it('TC-16 Ctrl+Z inside the editor undoes the typing only, not the earlier move', () => {
    renderApp();
    const id = noteAt(0, 0);
    press(noteEl(id));
    dragInFrames(noteEl(id), 80, 40, 3);
    const moved = positions()[id];
    wait(100);

    fireEvent.doubleClick(noteEl(id));
    const textarea = screen.getByRole('textbox', { name: 'Note text' }) as HTMLTextAreaElement;
    for (const partial of ['h', 'he', 'hel', 'hell', 'hello']) {
      fireEvent.input(textarea, { target: { value: partial } });
      wait(100);
    }
    expect(getStickyText(boardDoc(), id)!.toString()).toBe('hello');

    const ev = ctrlZ(textarea);
    expect(ev.defaultPrevented).toBe(true);
    expect(getStickyText(boardDoc(), id)!.toString()).toBe('');
    expect(textarea.value).toBe('');
    expect(positions()[id]).toEqual(moved);

    // Nothing more to undo in this text: the move stays while editing.
    ctrlZ(textarea);
    expect(positions()[id]).toEqual(moved);
    expect(noteEl(id).dataset.editing).toBe('true');

    // Redo inside the editor brings the typing back.
    ctrlZ(textarea, { shiftKey: true, key: 'Z' });
    expect(getStickyText(boardDoc(), id)!.toString()).toBe('hello');
    expect(textarea.value).toBe('hello');

    // After leaving the note, undo continues through earlier actions.
    fireEvent.keyDown(textarea, { key: 'Escape' });
    ctrlZ();
    expect(getStickyText(boardDoc(), id)!.toString()).toBe('');
    ctrlZ();
    expect(positions()[id]).toEqual({ x: 0, y: 0 });
  });

  it('TC-16 typing pauses of UNDO_CAPTURE_TIMEOUT_MS split typing into separate steps', () => {
    renderApp();
    const id = noteAt(0, 0);
    fireEvent.doubleClick(noteEl(id));
    const textarea = screen.getByRole('textbox', { name: 'Note text' }) as HTMLTextAreaElement;
    fireEvent.input(textarea, { target: { value: 'one' } });
    wait(600);
    fireEvent.input(textarea, { target: { value: 'one two' } });
    ctrlZ(textarea);
    expect(textarea.value).toBe('one');
    ctrlZ(textarea);
    expect(textarea.value).toBe('');
  });

  it('TC-17 a drag cancelled mid-way is still one step restoring the start position', () => {
    renderApp();
    const a = noteAt(0, 0);
    const b = noteAt(300, 0);
    press(noteEl(a));
    shiftPress(noteEl(b));
    dragInFrames(noteEl(a), 200, 100, 10, 'cancel');
    expect(positions()[a]).not.toEqual({ x: 0, y: 0 });

    // A later change right after the cancel is its own step.
    press(noteEl(b));
    fireEvent.click(screen.getByRole('button', { name: 'Blue colour' }));
    fireEvent.click(undoButton());
    expect(snapshot(boardDoc()).find((n) => n.id === b)!.color).toBe('yellow');
    expect(positions()[a]).not.toEqual({ x: 0, y: 0 });

    fireEvent.click(undoButton());
    expect(positions()[a]).toEqual({ x: 0, y: 0 });
    expect(positions()[b]).toEqual({ x: 300, y: 0 });
    expect(undoButton()).toBeDisabled();
  });
});
