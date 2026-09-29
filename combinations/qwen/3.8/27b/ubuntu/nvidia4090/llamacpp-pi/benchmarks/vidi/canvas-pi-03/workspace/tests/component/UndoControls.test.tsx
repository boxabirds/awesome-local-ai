import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, act, waitFor } from '@testing-library/react';
import * as Y from 'yjs';
import { renderFullApp, hooks, makeNote, firePointer, fireWindowPointer } from './story2';
import { objectBounds, type ObjectSnapshot } from '@/shared/board-model';

// Story 8 component tests TC-18..TC-21: undo shortcuts, buttons and the edit
// lock. The per-user controller is read through the story-2 test hooks
// (canUndo/canRedo/undo/redo); key handling is driven by dispatching real
// keydown events and asserting both the controller effect and preventDefault.

// Captures the most recently constructed fake provider so TC-20 can emit a
// connection-close event (board load failure -> canEdit false).
const providerHolder = vi.hoisted(() => ({ current: null as unknown }));

vi.mock('y-websocket', () => {
  class FakeProvider {
    private ls: Record<string, Array<(...a: unknown[]) => void>> = {};
    _synced = false;
    constructor(
      public url: string,
      public room: string,
      public doc: unknown,
      public opts: unknown,
    ) {
      providerHolder.current = this;
    }
    on(evt: string, cb: (...a: unknown[]) => void): void {
      (this.ls[evt] ??= []).push(cb);
    }
    off(evt: string, cb: (...a: unknown[]) => void): void {
      this.ls[evt] = (this.ls[evt] ?? []).filter((f) => f !== cb);
    }
    emit(evt: string, ...args: unknown[]): void {
      for (const cb of this.ls[evt] ?? []) cb(...args);
    }
    get synced(): boolean {
      return this._synced;
    }
    destroy(): void {}
    disconnect(): void {}
    connect(): void {}
  }
  return { WebsocketProvider: FakeProvider };
});

// Story 5: the board page checks existence before rendering.
vi.mock('@/client/api', () => ({
  checkBoard: vi.fn(async () => ({ kind: 'exists' })),
  createBoardRequest: vi.fn(async () => ({ kind: 'failed' })),
}));

// jsdom window 1024x768, initial camera (-512,-384), zoom 1.
const CAM = { x: -512, y: -384 };

function screenOf(w: { x: number; y: number }): { x: number; y: number } {
  return { x: w.x - CAM.x, y: w.y - CAM.y };
}

function snapOf(id: string): ObjectSnapshot {
  const m = hooks().getDoc().getMap('objects').get(id) as Y.Map<unknown> | undefined;
  if (!m) throw new Error(`object ${id} not found in doc`);
  const snap: ObjectSnapshot = {
    id,
    type: m.get('type') as string,
    x: m.get('x') as number,
    y: m.get('y') as number,
    z: m.get('z') as number,
    createdAt: m.get('createdAt') as number,
  };
  const w = m.get('width');
  const h = m.get('height');
  if (typeof w === 'number') snap.width = w;
  if (typeof h === 'number') snap.height = h;
  return snap;
}

function centreOf(id: string): { x: number; y: number } {
  const b = objectBounds(snapOf(id));
  return screenOf({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
}

function boundsOf(id: string): { x: number; y: number; width: number; height: number } {
  return objectBounds(snapOf(id));
}

function noteExists(id: string): boolean {
  return hooks().getDoc().getMap('objects').get(id) !== undefined;
}

function selectNote(id: string): void {
  const el = document.querySelector(`[data-id="${id}"]`);
  if (!el) throw new Error(`element for ${id} not found`);
  const c = centreOf(id);
  firePointer(el, 'pointerdown', c.x, c.y);
  firePointer(el, 'pointerup', c.x, c.y);
}

function drag(id: string, dx: number, dy: number): void {
  const el = document.querySelector(`[data-id="${id}"]`);
  if (!el) throw new Error(`element for ${id} not found`);
  const c = centreOf(id);
  firePointer(el, 'pointerdown', c.x, c.y);
  fireWindowPointer('pointermove', c.x + dx, c.y + dy);
  fireWindowPointer('pointerup', c.x + dx, c.y + dy);
}

/**
 * Dispatches a keydown on `target` inside act() and returns the event so the
 * test can assert `defaultPrevented`.
 */
function press(target: EventTarget, key: string, init?: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

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

describe('story 8: undo controls (shortcuts, buttons, edit lock)', () => {
  it('TC-18 with empty stacks the Undo and Redo buttons are disabled', async () => {
    await renderFullApp();
    const undoBtn = screen.getByRole('button', { name: 'Undo' });
    const redoBtn = screen.getByRole('button', { name: 'Redo' });
    expect(undoBtn).toBeDisabled();
    expect(redoBtn).toBeDisabled();
    expect(hooks().canUndo()).toBe(false);
    expect(hooks().canRedo()).toBe(false);
  });

  it('TC-19 Ctrl/Cmd+Z undo and Ctrl/Cmd+Shift+Z, Ctrl+Y redo, each with preventDefault', async () => {
    await renderFullApp();
    const id = makeNote(100, 100); // top-left (0,0)
    selectNote(id);
    drag(id, 100, 0); // move step -> note at x=100
    expect(boundsOf(id).x).toBe(100);
    expect(hooks().canUndo()).toBe(true);

    const undoBtn = () => screen.getByRole('button', { name: 'Undo' });
    const redoBtn = () => screen.getByRole('button', { name: 'Redo' });
    // Start: undo stack [create, move], redo [] -> Undo enabled, Redo disabled.
    expect(undoBtn()).toBeEnabled();
    expect(redoBtn()).toBeDisabled();

    // Undo the move (Ctrl+Z): note back to x=0; the create step remains, so
    // Undo stays enabled and Redo becomes enabled.
    let e = press(window, 'z', { ctrlKey: true });
    expect(e.defaultPrevented).toBe(true);
    expect(boundsOf(id).x).toBe(0);
    expect(undoBtn()).toBeEnabled();
    expect(redoBtn()).toBeEnabled();

    // Undo the create (Cmd+Z): note removed; undo stack now empty.
    e = press(window, 'z', { metaKey: true });
    expect(e.defaultPrevented).toBe(true);
    expect(noteExists(id)).toBe(false);
    expect(undoBtn()).toBeDisabled();
    expect(redoBtn()).toBeEnabled();

    // Redo the create (Ctrl+Shift+Z): note reappears at its start position.
    e = press(window, 'z', { ctrlKey: true, shiftKey: true });
    expect(e.defaultPrevented).toBe(true);
    expect(noteExists(id)).toBe(true);
    expect(boundsOf(id).x).toBe(0);

    // Redo the move (Cmd+Shift+Z): note back to x=100; redo stack now empty.
    e = press(window, 'z', { metaKey: true, shiftKey: true });
    expect(e.defaultPrevented).toBe(true);
    expect(boundsOf(id).x).toBe(100);
    expect(redoBtn()).toBeDisabled();

    // Ctrl+Y is also redo: the redo stack is empty, so it is a no-op but still
    // preventDefaults (it is a recognized undo shortcut).
    e = press(window, 'y', { ctrlKey: true });
    expect(e.defaultPrevented).toBe(true);
    expect(boundsOf(id).x).toBe(100);
  });

  it('TC-20 on a load-failed board the shortcuts are ignored and the buttons are disabled', async () => {
    await renderFullApp();
    const id = makeNote(100, 100);
    selectNote(id);
    drag(id, 100, 0); // note at x=100; a step exists but the board is about to lock
    expect(boundsOf(id).x).toBe(100);

    // Drive the provider to a board load failure (close code 4500).
    act(() => {
      (providerHolder.current as { emit: (evt: string, ...a: unknown[]) => void }).emit(
        'connection-close',
        { code: 4500, reason: '' },
      );
    });
    await waitFor(() =>
      expect((window as unknown as { __vidi6?: { connectionState?: string } }).__vidi6?.connectionState).toBe(
        'load_failed',
      ),
    );

    // The buttons are disabled even though a step exists (canEdit false gates
    // the UI state, even though the raw per-user stack still holds the step).
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled();

    // Ctrl+Z is ignored (no undo): the note stays where the drag left it.
    const e = press(window, 'z', { ctrlKey: true });
    expect(e.defaultPrevented).toBe(false);
    expect(boundsOf(id).x).toBe(100);
  });

  it('TC-21 Ctrl+Z with focus in a non-board input does not touch the controller', async () => {
    await renderFullApp();
    const id = makeNote(100, 100);
    selectNote(id);
    drag(id, 100, 0); // note at x=100, a step exists
    expect(hooks().canUndo()).toBe(true);

    // A plain (non-board) input, as in the share-link field.
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    try {
      const e = press(input, 'z', { ctrlKey: true });
      // The board key handler must ignore it (the input owns the keys).
      expect(e.defaultPrevented).toBe(false);
      // The controller was NOT called: nothing was undone.
      expect(hooks().canUndo()).toBe(true);
      expect(boundsOf(id).x).toBe(100);
    } finally {
      input.remove();
    }
  });
});
