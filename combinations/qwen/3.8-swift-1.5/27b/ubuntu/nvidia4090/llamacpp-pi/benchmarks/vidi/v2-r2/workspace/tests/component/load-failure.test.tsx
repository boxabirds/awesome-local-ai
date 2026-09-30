import { describe, it, expect, vi } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import * as Y from 'yjs';
import { Board } from '../../src/client/board/Board';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import { connectBoard, canEdit, type ConnectionState } from '../../src/client/sync/connectBoard';
import * as boardModel from '../../src/shared/board-model';
import { CONNECTED_CONFIRMATION_MS } from '../../src/shared/config';
import { createPointerEvent } from './helpers';

/* ------------------------------------------------------------------ */
/* Fake y-websocket provider (shared by TC-23 and TC-28)               */
/* ------------------------------------------------------------------ */

interface FakeProvider {
  handlers: Record<string, Array<(...args: unknown[]) => void>>;
  destroyed: boolean;
  emit(event: string, ...args: unknown[]): void;
}

// `mock` prefix: vitest allows the mock factory to reference these at runtime.
let mockFakeProvider: FakeProvider | null = null;

vi.mock('y-websocket', () => ({
  WebsocketProvider: class {
    handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
    destroyed = false;
    constructor(_url: string, _room: string, _doc: Y.Doc, _opts?: unknown) {
      mockFakeProvider = this as unknown as FakeProvider;
    }
    on(event: string, h: (...args: unknown[]) => void) {
      (this.handlers[event] ??= []).push(h);
    }
    off(event: string, h: (...args: unknown[]) => void) {
      this.handlers[event] = (this.handlers[event] ?? []).filter((x) => x !== h);
    }
    destroy() {
      this.destroyed = true;
    }
    emit(event: string, ...args: unknown[]) {
      for (const h of this.handlers[event] ?? []) h(...args);
    }
  },
}));

function getProvider(): FakeProvider {
  if (!mockFakeProvider) throw new Error('WebsocketProvider was never constructed');
  return mockFakeProvider;
}

function last<T>(arr: T[]): T {
  return arr[arr.length - 1];
}

/** Emits a socket close with the given code, followed by the status flip. */
function emitClose(p: FakeProvider, code: number) {
  act(() => {
    p.emit('connection-close', { code });
    p.emit('status', { status: 'disconnected' });
  });
}

/* ------------------------------------------------------------------ */
/* TC-22: load-failure badge                                           */
/* ------------------------------------------------------------------ */

describe('Story 4: load-failure client state (TC-22, TC-23, TC-28)', () => {
  it('TC-22: load_failed → red "This board couldn\'t be loaded. Retrying…" with role=status', () => {
    render(<ConnectionStatus state="load_failed" />);
    const badge = screen.getByRole('status');
    expect(badge).toHaveTextContent("This board couldn't be loaded. Retrying…");
    expect(badge).toHaveStyle({ backgroundColor: 'rgb(220, 38, 38)' });
  });

  /* ---------------------------------------------------------------- */
  /* TC-23: App in load_failed — zero board-model mutation calls       */
  /* ---------------------------------------------------------------- */

  it('TC-23: load_failed — dblclick, button, Delete, drag and typing make zero mutations', async () => {
    // Seed the board before installing the spies.
    const { unmount } = render(<Board boardId="test-board" />);
    const p = getProvider();
    act(() => {
      p.emit('status', { status: 'connected' });
    });
    const doc = (window as any).__vidi6.doc as Y.Doc;
    const id = boardModel.createSticky(doc, { x: 100, y: 100 });
    expect(id).not.toBe(false);
    act(() => {
      p.emit('sync', true);
    });

    // The room fails to load the board → close 4500.
    emitClose(p, 4500);
    await screen.findByText("This board couldn't be loaded. Retrying…");

    // Now spy on every board-model mutation.
    const spies = [
      vi.spyOn(boardModel, 'createSticky').mockImplementation(() => false),
      vi.spyOn(boardModel, 'deleteObject').mockImplementation(() => false),
      vi.spyOn(boardModel, 'moveObject').mockImplementation(() => false),
      vi.spyOn(boardModel, 'setStickyColor').mockImplementation(() => false),
      vi.spyOn(boardModel, 'bringToFront').mockImplementation(() => false),
    ];

    const noteEl = screen.getByTestId('sticky-note');
    const before = boardModel.snapshot(doc);

    // 1) Dblclick on the board → no create.
    act(() => {
      screen.getByTestId('board-viewport').dispatchEvent(
        createPointerEvent('dblclick', { clientX: 500, clientY: 400 })
      );
    });
    expect(boardModel.createSticky).not.toHaveBeenCalled();

    // 2) Sticky note button is disabled.
    const button = screen.getByRole('button', { name: 'Sticky note (N)' });
    expect(button).toBeDisabled();
    fireEvent.click(button);

    // 3) Press Delete with the note selected → no delete.
    act(() => {
      noteEl.dispatchEvent(createPointerEvent('pointerdown', { clientX: 20, clientY: 20, pointerId: 1 }));
      noteEl.dispatchEvent(createPointerEvent('pointerup', { clientX: 20, clientY: 20, pointerId: 1 }));
    });
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(boardModel.deleteObject).not.toHaveBeenCalled();

    // 4) Drag the note → no move (drag never starts).
    act(() => {
      noteEl.dispatchEvent(createPointerEvent('pointerdown', { clientX: 20, clientY: 20, pointerId: 2 }));
      noteEl.dispatchEvent(createPointerEvent('pointermove', { clientX: 120, clientY: 90, pointerId: 2 }));
      noteEl.dispatchEvent(createPointerEvent('pointerup', { clientX: 120, clientY: 90, pointerId: 2 }));
    });
    expect(boardModel.moveObject).not.toHaveBeenCalled();

    // 5) Type in the note → no editor appears, text unchanged.
    act(() => {
      noteEl.dispatchEvent(createPointerEvent('dblclick', { clientX: 20, clientY: 20 }));
    });
    expect(screen.queryByTestId('sticky-editor')).toBeNull();
    fireEvent.keyDown(screen.getByTestId('sticky-note'), { key: 'a' });

    // Zero mutations: the board is byte-identical.
    expect(boardModel.snapshot(doc)).toEqual(before);
    for (const s of spies) s.mockRestore();
    unmount();
  });

  /* ---------------------------------------------------------------- */
  /* TC-28: close-code mapping and recovery                            */
  /* ---------------------------------------------------------------- */

  it('TC-28: 4500 → load_failed; 1011/1003 → reconnecting (editable); sync after load_failed → connected', () => {
    vi.useFakeTimers();
    const doc = new Y.Doc();
    boardModel.initDoc(doc);
    const states: ConnectionState[] = [];
    const conn = connectBoard(doc, 'testboard', (s) => states.push(s));
    const p = getProvider();

    // Initial connection.
    act(() => {
      p.emit('status', { status: 'connected' });
    });
    expect(last(states)).toBe('connected');
    expect(canEdit(last(states)!)).toBe(true);

    // 1011 (storage failure) → reconnecting, editing still enabled.
    act(() => {
      p.emit('connection-close', { code: 1011 });
      p.emit('status', { status: 'disconnected' });
    });
    expect(last(states)).toBe('reconnecting');
    expect(canEdit(last(states)!)).toBe(true);

    // Reconnect → confirmed → connected.
    act(() => {
      p.emit('status', { status: 'connected' });
    });
    expect(last(states)).toBe('confirmed');
    act(() => {
      vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS);
    });
    expect(last(states)).toBe('connected');

    // 1003 (protocol error) → reconnecting.
    act(() => {
      p.emit('connection-close', { code: 1003 });
      p.emit('status', { status: 'disconnected' });
    });
    expect(last(states)).toBe('reconnecting');
    act(() => {
      p.emit('status', { status: 'connected' });
    });
    expect(last(states)).toBe('confirmed');
    act(() => {
      vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS);
    });
    expect(last(states)).toBe('connected');

    // 4500 → load_failed, editing disabled. The provider keeps retrying…
    act(() => {
      p.emit('connection-close', { code: 4500 });
      p.emit('status', { status: 'disconnected' });
    });
    expect(last(states)).toBe('load_failed');
    expect(canEdit(last(states)!)).toBe(false);

    // …and a failed retry stays load_failed (socket opens, no sync).
    act(() => {
      p.emit('status', { status: 'connected' });
    });
    expect(last(states)).toBe('load_failed');

    // The board is repaired: the next successful sync recovers without reload.
    act(() => {
      p.emit('sync', true);
    });
    expect(last(states)).toBe('connected');
    expect(canEdit(last(states)!)).toBe(true);

    conn.destroy();
    vi.useRealTimers();
  });
});
