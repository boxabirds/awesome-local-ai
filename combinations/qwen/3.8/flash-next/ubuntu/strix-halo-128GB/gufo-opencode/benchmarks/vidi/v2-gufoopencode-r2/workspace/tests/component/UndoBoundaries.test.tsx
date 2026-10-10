// TC-14 to TC-17: undo.boundaries wiring in jsdom — a whole drag is one
// undo step, the gesture-end boundary separates it from a later colour
// change, typing inside the editor is its own step, and a pointercancel
// still closes the step (error path).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import {
  App,
  board,
  createNote,
  flush,
  noteEl,
  notes,
} from './stickyHelpers';
import { dragPath } from './selectionHelpers';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
});

afterEach(() => {
  vi.useRealTimers();
});

function undoCtl() {
  const undo = board().undo;
  if (!undo) throw new Error('undo controller not installed');
  return undo;
}

// Controller calls apply Yjs transactions whose observers setState in React.
function doUndo(): boolean {
  let applied = false;
  act(() => {
    applied = undoCtl().undo();
  });
  return applied;
}

function noteById(id: string) {
  const n = notes().find((s) => s.id === id);
  if (!n) throw new Error(`note ${id} missing`);
  return n;
}

function dragPath30(): Array<readonly [number, number]> {
  const path: Array<readonly [number, number]> = [[20, 20]];
  for (let i = 1; i <= 30; i += 1) path.push([20 + i * 10, 20]);
  return path;
}

describe('undo boundaries in components', () => {
  it('TC-14: a 30-frame drag of a selection is one step restoring every start position', () => {
    render(<App />);
    flush();
    const a = createNote(0, 0);
    const b = createNote(400, 0);
    // Select both: plain click on a, shift-click on b.
    fireEvent.pointerDown(noteEl(a), { pointerId: 1, clientX: 50, clientY: 50 });
    fireEvent.pointerUp(noteEl(a), { pointerId: 1, clientX: 50, clientY: 50 });
    fireEvent.pointerDown(noteEl(b), { pointerId: 1, clientX: 10, clientY: 10, shiftKey: true });
    fireEvent.pointerUp(noteEl(b), { pointerId: 1, clientX: 10, clientY: 10, shiftKey: true });
    flush();

    dragPath(noteEl(a), dragPath30()); // +300 world on x over 30 frames
    flush();
    expect(noteById(a).x).toBe(300);
    expect(noteById(b).x).toBe(700);

    expect(undoCtl().canUndo()).toBe(true);
    // One undo restores BOTH objects fully: per-frame writes merged into one
    // step. If frames had captured individually, one undo would land at 290.
    expect(doUndo()).toBe(true);
    expect(noteById(a).x).toBe(0);
    expect(noteById(b).x).toBe(400);
    // The creation steps remain: the drag contributed exactly one step.
    expect(undoCtl().canUndo()).toBe(true);
  });

  it('TC-15: a colour change shortly after a drag is a separate second step', () => {
    render(<App />);
    flush();
    const a = createNote(0, 0);
    dragPath(noteEl(a), [
      [50, 50],
      [150, 50],
    ]); // +100 on x
    flush();
    expect(noteById(a).x).toBe(100);

    // Selection bar is back after release; pink swatch shortly after the drag.
    fireEvent.click(screen.getByTestId('swatch-pink'));
    flush();
    expect(noteById(a).color).toBe('pink');

    expect(doUndo()).toBe(true); // colour only — boundary at gesture end
    expect(noteById(a).color).toBe('yellow');
    expect(noteById(a).x).toBe(100);
    expect(doUndo()).toBe(true); // then the move
    expect(noteById(a).x).toBe(0);
  });

  it('TC-16: Ctrl+Z in the editor undoes the typing, not the earlier move', () => {
    render(<App />);
    flush();
    const a = createNote(0, 0);
    dragPath(noteEl(a), [
      [50, 50],
      [150, 50],
    ]); // move step
    flush();
    fireEvent.dblClick(noteEl(a)); // start editing
    flush();

    const area = screen.getByTestId('sticky-textarea');
    fireEvent.input(area, { target: { value: 'hello' } });
    flush();
    expect(noteById(a).text).toBe('hello');

    const ev = new KeyboardEvent('keydown', {
      key: 'z',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      area.dispatchEvent(ev);
    });
    flush();
    expect(ev.defaultPrevented).toBe(true); // native textarea undo suppressed
    expect(noteById(a).text).toBe(''); // typing step reverted
    expect((area as HTMLTextAreaElement).value).toBe(''); // mirrored back
    expect(noteById(a).x).toBe(100); // negative: the move is untouched
  });

  it('TC-17: pointercancel mid-drag still forms one step back to the start', () => {
    render(<App />);
    flush();
    const a = createNote(0, 0);
    fireEvent.pointerDown(noteEl(a), { pointerId: 1, clientX: 50, clientY: 50, button: 0 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 150, clientY: 50 });
    flush();
    fireEvent.pointerCancel(window, { pointerId: 1 });
    flush();
    expect(noteById(a).x).toBe(100); // the cancelled drag kept its last frame

    expect(doUndo()).toBe(true); // one step
    expect(noteById(a).x).toBe(0);
  });
});
