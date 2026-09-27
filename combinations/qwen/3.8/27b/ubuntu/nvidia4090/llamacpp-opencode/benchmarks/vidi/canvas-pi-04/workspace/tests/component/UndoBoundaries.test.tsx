// Story 8, component tests (TC-14 .. TC-17): undo step boundaries through
// the full App (design: "Test Strategy", ui-component scope; anchors
// undo.steps, undo.typing, undo.safe).
//
// The App is rendered against a mocked connector that seeds fixed notes.
// Crucially the seed arrives under a NON-LOCAL origin (like the real
// y-websocket provider), so the initial state never enters the client's
// undo history — exactly like the remote updates of story 3.

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { makeEvent } from './helpers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/client/App';
import { newBoardId } from '../../src/shared/board-id';
import { objectSnapshot } from '../../src/shared/board-model';
import { resetBoardForTests, setBoardCamera } from '../../src/client/canvas/useCamera';
import type { StickyColor } from '../../src/shared/config';
import type { ConnectionState } from '../../src/client/sync/connectBoard';

// Module-scope seed config, read by the hoisted connectBoard mock.
const SEED = vi.hoisted(() => ({
  notes: [] as Array<{ x: number; y: number; color: StickyColor }>,
  state: 'connected' as ConnectionState,
}));

vi.mock('../../src/client/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/api')>();
  return { ...actual, checkBoard: vi.fn().mockResolvedValue({ kind: 'exists' }) };
});

// The seed mimics the real initial state: it arrives under the provider's
// (non-local) origin, so it is never captured by the UndoController.
const TEST_REMOTE_ORIGIN = Symbol('vidi6.test-remote-seed');

vi.mock('../../src/client/sync/connectBoard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/sync/connectBoard')>();
  const boardModel = await import('../../src/shared/board-model');
  return {
    ...actual,
    connectBoard: (doc: Y.Doc, _boardId: string, onState: (s: ConnectionState) => void) => {
      onState(SEED.state);
      queueMicrotask(() => {
        if (boardModel.objectSnapshot(doc).length !== 0) return;
        let z = 1;
        for (const n of SEED.notes) {
          const id = crypto.randomUUID();
          doc.transact(
            () => {
              const obj = new Y.Map();
              obj.set('id', id);
              obj.set('type', 'sticky');
              obj.set('x', n.x);
              obj.set('y', n.y);
              obj.set('color', n.color);
              obj.set('text', new Y.Text());
              obj.set('z', z++);
              doc.getMap('objects').set(id, obj);
            },
            TEST_REMOTE_ORIGIN,
          );
        }
      });
      return { destroy: (): void => undefined };
    },
  };
});

// --- helpers (mirroring multi-select.test.tsx) -----------------------------

const CAM = { x: -512, y: -384, zoom: 1 };

function setCam(): void {
  act(() => {
    setBoardCamera(CAM);
  });
}

function noteEls(): HTMLElement[] {
  return screen.queryAllByRole('group', { name: 'Sticky note' });
}

function noteState(): Array<{ id: string; x: number; y: number; color: string }> {
  return noteEls().map((el) => ({
    id: el.getAttribute('data-note-id') ?? '',
    x: Number(el.style.left.replace('px', '')),
    y: Number(el.style.top.replace('px', '')),
    color: el.getAttribute('data-color') ?? '',
  }));
}

function dis(target: EventTarget, type: string, props: Record<string, unknown>): void {
  act(() => {
    target.dispatchEvent(makeEvent(type, props));
  });
}

function clickNote(el: HTMLElement, shift = false): void {
  dis(el, 'pointerdown', {
    button: 0,
    pointerType: 'mouse',
    pointerId: 1,
    clientX: 0,
    clientY: 0,
    shiftKey: shift,
  });
  dis(window, 'pointerup', { pointerId: 1 });
}

/** Drag an object by a screen delta over a single rAF frame (zoom 1). */
function drag(el: HTMLElement, dx: number, dy: number): void {
  dis(el, 'pointerdown', {
    button: 0,
    pointerType: 'mouse',
    pointerId: 1,
    clientX: 0,
    clientY: 0,
  });
  dis(window, 'pointermove', { pointerId: 1, clientX: dx, clientY: dy });
  dis(window, 'pointerup', { pointerId: 1 });
}

function pressKey(target: EventTarget, key: string, init: Record<string, unknown> = {}): void {
  dis(target, 'keydown', { key, ...init });
}

function undoButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement;
}

function redoButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Redo' }) as HTMLButtonElement;
}

async function openBoard(): Promise<void> {
  window.history.pushState({}, '', `/b/${newBoardId()}`);
  render(<App />);
  await act(async () => undefined);
  setCam();
}

// --- tests ------------------------------------------------------------------

describe('story 8 component: step boundaries (TC-14..TC-17)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetBoardForTests();
    SEED.notes = [];
    SEED.state = 'connected';
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    window.history.pushState({}, '', '/');
  });

  it('TC-14: a 30-frame drag of a selection is one undo step (undo.steps)', async () => {
    SEED.notes = [
      { x: 100, y: 100, color: 'yellow' },
      { x: 300, y: 100, color: 'green' },
    ];
    await openBoard();
    expect(noteEls()).toHaveLength(2);
    // The (remotely seeded) initial state is not undoable.
    expect(undoButton().disabled).toBe(true);

    const els = noteEls();
    clickNote(els[0]);
    clickNote(els[1], true);

    // A 30-frame drag: each frame applies through the rAF coalescing.
    dis(els[0], 'pointerdown', {
      button: 0,
      pointerType: 'mouse',
      pointerId: 1,
      clientX: 0,
      clientY: 0,
    });
    const frames = 30;
    for (let i = 1; i <= frames; i++) {
      dis(window, 'pointermove', {
        pointerId: 1,
        clientX: (120 * i) / frames,
        clientY: (60 * i) / frames,
      });
      act(() => {
        vi.advanceTimersByTime(16);
      });
    }
    dis(window, 'pointerup', { pointerId: 1 });

    const moved = noteState();
    expect(moved[0]).toMatchObject({ x: 100 + 120, y: 100 + 60 });
    expect(moved[1]).toMatchObject({ x: 300 + 120, y: 100 + 60 });

    // One undo restores every object to its start position...
    pressKey(window, 'z', { ctrlKey: true });
    const undone = noteState();
    expect(undone[0]).toMatchObject({ x: 100, y: 100 });
    expect(undone[1]).toMatchObject({ x: 300, y: 100 });
    // ...and the whole drag was exactly one step (history now empty).
    expect(undoButton().disabled).toBe(true);
    expect(redoButton().disabled).toBe(false);
  });

  it('TC-15: a colour change 200 ms after a drag is a separate step (undo.steps)', async () => {
    SEED.notes = [{ x: 100, y: 100, color: 'yellow' }];
    await openBoard();

    drag(noteEls()[0], 100, 0);
    expect(noteState()[0]).toMatchObject({ x: 200, y: 100, color: 'yellow' });

    // 200 ms later (outside any realistic merge concern; the app also puts
    // explicit boundaries around each action).
    act(() => {
      vi.advanceTimersByTime(200);
    });

    // The dragged note is selected: the single-sticky NoteToolbar is shown.
    const green = screen.getByRole('button', { name: 'Green colour' });
    dis(green, 'click', {});
    expect(noteState()[0]).toMatchObject({ color: 'green' });

    // Undo #1: the colour reverts, the move stays.
    pressKey(window, 'z', { ctrlKey: true });
    expect(noteState()[0]).toMatchObject({ x: 200, y: 100, color: 'yellow' });
    // Undo #2: the move reverts too (two separate steps).
    pressKey(window, 'z', { ctrlKey: true });
    expect(noteState()[0]).toMatchObject({ x: 100, y: 100, color: 'yellow' });
    expect(undoButton().disabled).toBe(true);
  });

  it('TC-16: Ctrl+Z inside the editor undoes typing, not an earlier move (undo.typing)', async () => {
    SEED.notes = [{ x: 100, y: 100, color: 'yellow' }];
    await openBoard();

    // An earlier move step.
    drag(noteEls()[0], 100, 0);
    expect(noteState()[0]).toMatchObject({ x: 200, y: 100 });

    // Open the editor and type a burst.
    const note = noteEls()[0];
    dis(note, 'dblclick', { detail: 2 });
    const ta = screen.getByRole('textbox', { name: 'Sticky note text' }) as HTMLTextAreaElement;
    fireEvent.input(ta, { target: { value: 'hello' } });
    expect(ta.value).toBe('hello');

    // Ctrl+Z inside the textarea undoes the typing burst...
    pressKey(ta, 'z', { ctrlKey: true });
    act(() => {
      vi.advanceTimersByTime(16); // caret-remap frame of the remote merge
    });
    expect(ta.value).toBe('');
    // ...while the earlier move is NOT undone.
    expect(noteState()[0]).toMatchObject({ x: 200, y: 100 });
    // The move step is still in the history (button enabled)...
    expect(undoButton().disabled).toBe(false);
    // ...and a board-level Ctrl+Z after the editor closes undoes it.
    pressKey(ta, 'Escape', {});
    pressKey(window, 'z', { ctrlKey: true });
    expect(noteState()[0]).toMatchObject({ x: 100, y: 100 });
    expect(undoButton().disabled).toBe(true);
  });

  it('TC-17: a cancelled drag is one step restoring the start position (undo.safe)', async () => {
    SEED.notes = [{ x: 100, y: 100, color: 'yellow' }];
    await openBoard();

    const el = noteEls()[0];
    dis(el, 'pointerdown', {
      button: 0,
      pointerType: 'mouse',
      pointerId: 1,
      clientX: 0,
      clientY: 0,
    });
    for (let i = 1; i <= 10; i++) {
      dis(window, 'pointermove', { pointerId: 1, clientX: (50 * i) / 10, clientY: 0 });
      act(() => {
        vi.advanceTimersByTime(16);
      });
    }
    // The drag is cancelled (pointercancel): the applied moves stand.
    dis(window, 'pointercancel', { pointerId: 1 });
    expect(noteState()[0]).toMatchObject({ x: 150, y: 100 });

    // One undo restores the start position; nothing else is in the history.
    pressKey(window, 'z', { ctrlKey: true });
    expect(noteState()[0]).toMatchObject({ x: 100, y: 100 });
    expect(undoButton().disabled).toBe(true);
  });
});
