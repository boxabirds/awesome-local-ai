// undo.boundaries (story 8): TC-14 to TC-17.
//
// Full-app tests that one user action maps to one undo step in the real
// gesture / editor wiring: a 30-frame drag is a single step, a move followed
// immediately by a colour change is two steps (boundary at gesture end),
// Ctrl+Z inside the editor undoes only the typing, and a cancelled drag is
// still one step restoring the start position.

import { act, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  click,
  flushRaf,
  inputValue,
  installResizeObserverMock,
  keyOn,
} from './helpers';
import {
  board,
  dispatchOn,
  keyedPointerEvent,
  liveNotes,
  noteAt,
  noteEls,
  screenX,
  screenY,
} from './story7-helpers';
import type { UndoController } from '../../src/client/board/undo';

beforeEach(() => {
  vi.useFakeTimers();
  installResizeObserverMock();
});

afterEach(() => {
  cleanup();
});

/** This tab's undo controller (via the test hook). */
function undoController(): UndoController {
  const hook = window.__vidi6;
  if (hook === undefined) throw new Error('test hook not installed');
  return hook.getUndoController();
}

/** The live note with the given id (throws if gone). */
function note(id: string) {
  const obj = liveNotes().find((o) => o.id === id);
  if (obj === undefined) throw new Error(`note ${id} not found`);
  return obj;
}

/** Select the note (click its centre), returning the rendered element. */
function select(container: HTMLElement, id: string): HTMLElement {
  const el = noteEls(container).find((n) => n.dataset.id === id);
  if (el === undefined) throw new Error(`note ${id} not rendered`);
  const obj = note(id);
  const cx = screenX(obj.x + (obj.width ?? 200) / 2);
  const cy = screenY(obj.y + (obj.height ?? 200) / 2);
  dispatchOn(el, keyedPointerEvent('pointerdown', cx, cy));
  dispatchOn(el, keyedPointerEvent('pointerup', cx, cy));
  return el;
}

/** Press at the note centre, move `frames` rAF-coalesced frames, release. */
async function dragFrames(el: HTMLElement, frames: number, stepPx = 2): Promise<void> {
  const obj = note(el.dataset.id!);
  const cx = screenX(obj.x + (obj.width ?? 200) / 2);
  const cy = screenY(obj.y + (obj.height ?? 200) / 2);
  dispatchOn(el, keyedPointerEvent('pointerdown', cx, cy));
  for (let i = 1; i <= frames; i += 1) {
    dispatchOn(el, keyedPointerEvent('pointermove', cx + stepPx * i, cy));
    await flushRaf();
  }
  dispatchOn(el, keyedPointerEvent('pointerup', cx + stepPx * frames, cy));
  await flushRaf();
}

/** Press at the note centre, move some frames, then cancel the gesture. */
async function cancelDrag(el: HTMLElement, frames: number, stepPx = 2): Promise<void> {
  const obj = note(el.dataset.id!);
  const cx = screenX(obj.x + (obj.width ?? 200) / 2);
  const cy = screenY(obj.y + (obj.height ?? 200) / 2);
  dispatchOn(el, keyedPointerEvent('pointerdown', cx, cy));
  for (let i = 1; i <= frames; i += 1) {
    dispatchOn(el, keyedPointerEvent('pointermove', cx + stepPx * i, cy));
    await flushRaf();
  }
  dispatchOn(el, keyedPointerEvent('pointercancel', cx + stepPx * frames, cy));
  await flushRaf();
}

describe('undo.boundaries', () => {
  it('TC-14 a 30-frame drag is one step that restores the start position', async () => {
    const { container } = await board();
    let id = '';
    act(() => {
      id = noteAt(0, 0);
    });
    const el = select(container, id);
    const start = { x: note(id).x, y: note(id).y };

    await dragFrames(el, 30);

    const after = note(id);
    expect(after.x).not.toBe(start.x); // the drag moved it

    // One undo fully restores the start: the 30 frames were one step.
    expect(undoController().undo()).toBe(true);
    const restored = note(id);
    expect(restored.x).toBe(start.x);
    expect(restored.y).toBe(start.y);

    // Redo re-applies the whole drag in one step.
    expect(undoController().redo()).toBe(true);
    const redone = note(id);
    expect(redone.x).toBe(after.x);
    expect(redone.y).toBe(after.y);
  });

  it('TC-15 a move then a colour change within 200 ms are two separate steps', async () => {
    const { container } = await board();
    let id = '';
    act(() => {
      id = noteAt(0, 0);
    });
    const el = select(container, id);
    const start = { x: note(id).x, y: note(id).y };

    // Move, then (well under the 500 ms capture window) recolour.
    await dragFrames(el, 10);
    const moved = note(id);
    const swatch = document.querySelector<HTMLButtonElement>('button[aria-label="Green colour"]');
    if (swatch === null) throw new Error('note toolbar not rendered');
    click(swatch);

    expect(note(id).color).toBe('green');
    expect(note(id).x).toBe(moved.x);

    // First undo reverts ONLY the colour (the move survives).
    expect(undoController().undo()).toBe(true);
    expect(note(id).color).toBe('yellow');
    expect(note(id).x).toBe(moved.x);

    // Second undo reverts the move.
    expect(undoController().undo()).toBe(true);
    expect(note(id).x).toBe(start.x);
    expect(note(id).y).toBe(start.y);
  });

  it('TC-16 Ctrl+Z inside the editor undoes the typing, not an earlier move', async () => {
    const { container } = await board();
    let id = '';
    act(() => {
      id = noteAt(0, 0);
    });
    const el = select(container, id);

    // An earlier move step.
    await dragFrames(el, 5);
    const moved = note(id);

    // Begin editing and type.
    keyOn(el, 'Enter');
    const ta = document.querySelector<HTMLTextAreaElement>('[data-testid="sticky-editor"] textarea');
    if (ta === null) throw new Error('editor not rendered');
    inputValue(ta, 'hello');

    // Ctrl+Z routed to the controller inside the textarea.
    const before = moved.x;
    act(() => {
      ta.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }),
      );
    });

    expect(ta.value).toBe(''); // the typing was undone
    expect(note(id).x).toBe(before); // the earlier move is NOT undone
  });

  it('TC-17 a cancelled drag is one step that restores the start position', async () => {
    const { container } = await board();
    let id = '';
    act(() => {
      id = noteAt(0, 0);
    });
    const el = select(container, id);
    const start = { x: note(id).x, y: note(id).y };

    await cancelDrag(el, 12);

    const after = note(id);
    expect(after.x).not.toBe(start.x); // frames were applied before the cancel

    // One undo restores the start: the cancelled drag was one step.
    expect(undoController().undo()).toBe(true);
    const restored = note(id);
    expect(restored.x).toBe(start.x);
    expect(restored.y).toBe(start.y);
  });
});
