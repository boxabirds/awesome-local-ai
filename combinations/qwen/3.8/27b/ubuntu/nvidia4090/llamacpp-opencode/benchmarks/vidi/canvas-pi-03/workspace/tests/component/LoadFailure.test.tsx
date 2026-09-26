import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import * as Y from 'yjs';

/**
 * Story 4 component tests (TC-22, TC-23) plus the close-code mapping that
 * drives persist.client_status:
 *
 *  - TC-22: `load_failed` renders the red "couldn't be loaded" status badge.
 *  - TC-23: with the board in `load_failed`, every edit path (create via
 *    double-click / Sticky button, delete, drag, colour) performs ZERO
 *    board-model mutations.
 *  - close-code mapping: a fake y-websocket provider emitting
 *    `connection-close` — 4500 -> load_failed (locked); 1011 -> reconnecting
 *    (NOT locked); a later successful sync recovers to connected.
 *
 * The y-websocket provider, the board's useBoardDoc and the mutating board-
 * model functions are all mocked so the tests are pure UI/ state assertions.
 */

// Captures the most recently constructed fake provider so tests can emit
// events, plus spies for the mutating board-model calls (reads stay real).
const { providerHolder, boardSpies } = vi.hoisted(() => ({
  providerHolder: { current: null as unknown },
  boardSpies: {
    createSticky: vi.fn(() => 'created-id'),
    moveObject: vi.fn(() => true),
    bringToFront: vi.fn(() => true),
    setStickyColor: vi.fn(() => true),
    deleteObject: vi.fn(() => true),
  },
}));

// A minimal event-emitter stand-in for y-websocket's WebsocketProvider.
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

// Mutating board-model calls are spied on (reads stay real).
vi.mock('@/shared/board-model', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/shared/board-model')>();
  return { ...real, ...boardSpies };
});

// Drives the App's connection state + notes without a real provider.
vi.mock('@/client/board/useBoardDoc', () => ({ useBoardDoc: vi.fn() }));

// Story 5: the board page checks existence before rendering; pretend the
// board exists so these tests keep exercising the board UI directly.
vi.mock('@/client/api', () => ({
  checkBoard: vi.fn(async () => ({ kind: 'exists' })),
  createBoardRequest: vi.fn(async () => ({ kind: 'failed' })),
}));

import { ConnectionStatus } from '@/client/sync/ConnectionStatus';
import { App } from '@/client/App';
import { canEdit } from '@/client/board/Board';
import { connectBoard, type ConnectionState } from '@/client/sync/connectBoard';
import { useBoardDoc } from '@/client/board/useBoardDoc';
import type { StickySnapshot } from '@/shared/board-model';

const BOARD_ID = 'abcdefghij0123456789ab'; // 22-char base64url
const LOAD_FAILED_TEXT = "This board couldn't be loaded. Retrying…";

/** The surface of the fake provider the tests drive. */
interface FakeProviderHandle {
  _synced: boolean;
  emit(evt: string, ...args: unknown[]): void;
}

function pointerOn(el: Element, type: string, x: number, y: number, pointerId = 1): void {
  const event = new Event(type, { bubbles: true, cancelable: true }) as PointerEvent;
  Object.defineProperty(event, 'clientX', { value: x });
  Object.defineProperty(event, 'clientY', { value: y });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  Object.defineProperty(event, 'button', { value: 0 });
  act(() => {
    el.dispatchEvent(event);
  });
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  // jsdom lacks pointer capture / rAF; stub defensively.
  vi.stubGlobal('setPointerCapture', () => {});
  vi.stubGlobal('releasePointerCapture', () => {});
  vi.stubGlobal(
    'requestAnimationFrame',
    (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 0),
  );
  Object.values(boardSpies).forEach((s) => s.mockClear());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Story 4: load-failure badge and edit lock', () => {
  it('TC-22: load_failed renders the red retry message with role=status', () => {
    render(<ConnectionStatus state="load_failed" />);
    const badge = screen.getByTestId('connection-status');
    expect(badge).toHaveAttribute('role', 'status');
    expect(badge).toHaveAttribute('data-state', 'load_failed');
    expect((badge.textContent ?? '').trim()).toBe(LOAD_FAILED_TEXT);
    // The status dot is the red colour (jsdom normalises hex -> rgb).
    const dot = badge.querySelector('span[aria-hidden]') as HTMLElement;
    expect(dot.style.background).toBe('rgb(229, 115, 115)');
  });

  it('TC-23: App in load_failed performs zero board-model mutations', async () => {
    // A valid board id so App does not redirect.
    window.history.pushState({}, '', '/b/' + BOARD_ID);

    const doc = new Y.Doc();
    const note: StickySnapshot = {
      id: 'note-1',
      type: 'sticky',
      x: 120,
      y: 80,
      color: 'yellow',
      text: 'hello',
      z: 0,
      createdAt: 1,
    };
    vi.mocked(useBoardDoc).mockReturnValue({ doc, objects: [note], notes: [note], connectionState: 'load_failed' });

    render(<App />);
    // Story 5: the board page awaits one existence check before mounting the board.
    await screen.findByTestId('board-viewport', undefined, { timeout: 5000 });

    // The badge reflects the failed load.
    expect((screen.getByTestId('connection-status').textContent ?? '').trim()).toBe(LOAD_FAILED_TEXT);
    // canEdit is the single source of truth for the lock.
    expect(canEdit('load_failed')).toBe(false);

    // 1) Double-click the empty board (create path).
    const viewport = screen.getByTestId('board-viewport');
    act(() => {
      viewport.dispatchEvent(
        new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: 200, clientY: 150 }),
      );
    });

    // 2) The Sticky note button is disabled; clicking it does nothing.
    const stickyButton = screen.getByTestId('sticky-button');
    expect(stickyButton).toBeDisabled();
    act(() => {
      stickyButton.click();
    });

    // 3) Select the note, then press Delete (delete path).
    const noteEl = screen.getByTestId('sticky-note');
    pointerOn(noteEl, 'pointerdown', 130, 90);
    pointerOn(noteEl, 'pointerup', 130, 90);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
    });

    // 4) Attempt to drag the note (move path) well past the drag threshold.
    pointerOn(noteEl, 'pointerdown', 130, 90);
    pointerOn(noteEl, 'pointermove', 230, 190);
    pointerOn(noteEl, 'pointerup', 230, 190);

    // 5) No text editor is reachable while the board is locked.
    expect(screen.queryByTestId('sticky-text-editor')).toBeNull();

    // Zero board-model mutations across every edit path.
    expect(boardSpies.createSticky).not.toHaveBeenCalled();
    expect(boardSpies.deleteObject).not.toHaveBeenCalled();
    expect(boardSpies.moveObject).not.toHaveBeenCalled();
    expect(boardSpies.bringToFront).not.toHaveBeenCalled();
    expect(boardSpies.setStickyColor).not.toHaveBeenCalled();
  });

  describe('close-code mapping (fake provider)', () => {
    it('4500 -> load_failed (editing locked)', () => {
      const seen: ConnectionState[] = [];
      connectBoard(new Y.Doc(), BOARD_ID, (s) => seen.push(s));
      const provider = providerHolder.current as FakeProviderHandle;
      act(() => {
        provider.emit('connection-close', { code: 4500, reason: 'board load failed' });
      });
      expect(seen).toContain('load_failed');
      expect(seen[seen.length - 1]).toBe('load_failed');
      expect(canEdit('load_failed')).toBe(false);
    });

    it('1011 -> reconnecting (NOT locked) after a prior connection', () => {
      const seen: ConnectionState[] = [];
      connectBoard(new Y.Doc(), BOARD_ID, (s) => seen.push(s));
      const provider = providerHolder.current as FakeProviderHandle;
      // Establish a first connection (so everConnected is true).
      provider._synced = true;
      act(() => {
        provider.emit('status', { status: 'connected' });
      });
      act(() => {
        provider.emit('sync', true);
      });
      expect(seen).toContain('connected');
      // A storage-failure drop is a transient reconnection, not a lock.
      act(() => {
        provider.emit('connection-close', { code: 1011, reason: 'storage failure' });
      });
      expect(seen[seen.length - 1]).toBe('reconnecting');
      expect(canEdit('reconnecting')).toBe(true);
    });

    it('load_failed then a successful sync recovers to connected (editing re-enabled)', () => {
      const seen: ConnectionState[] = [];
      connectBoard(new Y.Doc(), BOARD_ID, (s) => seen.push(s));
      const provider = providerHolder.current as FakeProviderHandle;
      act(() => {
        provider.emit('connection-close', { code: 4500, reason: 'board load failed' });
      });
      expect(seen[seen.length - 1]).toBe('load_failed');
      // The room's retry succeeds and the provider syncs: editing returns
      // without a page reload.
      provider._synced = true;
      act(() => {
        provider.emit('sync', true);
      });
      expect(seen[seen.length - 1]).toBe('connected');
      expect(canEdit('connected')).toBe(true);
    });
  });
});
