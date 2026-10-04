import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import * as Y from 'yjs';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import { CLOSE_BOARD_LOAD_FAILED } from '../../src/shared/protocol';

/**
 * Component tests for the client load-failure state (story 4, persist.client_status).
 * - TC-22: the load_failed badge renders the red message with role=status.
 * - TC-23: a load_failed board is not editable (no model mutations).
 * - TC-28: storage (1011) and unsupported-data (1003) closes map to `reconnecting`,
 *   never `load_failed`; only the 4500 close does.
 */

// --- Shared mocks (hoisted so they apply to the imports below) -------------

// App-level state + model mocks for TC-23.
const {
  appState,
  createStickyMock,
  deleteObjectMock,
} = vi.hoisted(() => ({
  appState: {
    connectionState: 'load_failed' as string,
    doc: null as unknown as Y.Doc,
    notes: [] as unknown[],
  },
  createStickyMock: vi.fn(() => null as string | null),
  deleteObjectMock: vi.fn(),
}));

// Provider mock for TC-28 (drives connectBoard's close-code mapping).
const { mockProviderRef } = vi.hoisted(() => ({
  mockProviderRef: { current: null as unknown },
}));

vi.mock('../../src/shared/board-model', () => ({
  createSticky: createStickyMock,
  deleteObject: deleteObjectMock,
}));

vi.mock('../../src/client/board/useBoardDoc', () => ({
  useBoardDoc: () => ({
    doc: appState.doc,
    notes: appState.notes,
    connectionState: appState.connectionState,
  }),
}));

vi.mock('y-websocket', () => ({
  WebsocketProvider: vi.fn(() => mockProviderRef.current),
}));

import App from '../../src/client/App';
import { canEdit } from '../../src/client/App';
import { connectBoard } from '../../src/client/sync/connectBoard';

// --- TC-22: load-failed badge ---------------------------------------------

describe('TC-22: load-failed badge', () => {
  it('shows the red "couldn\'t be loaded" message with role=status', () => {
    render(<ConnectionStatus state="load_failed" />);
    const badge = screen.getByRole('status');
    expect(badge.textContent).toBe("This board couldn't be loaded. Retrying…");
    expect(badge.className).toContain('connection-status--load-failed');
    expect(badge.getAttribute('aria-label')).toBe('Load failed');
  });

  it('is distinct from the transient "Reconnecting…" badge', () => {
    const { rerender } = render(<ConnectionStatus state="reconnecting" />);
    expect(screen.getByRole('status').textContent).toBe('Reconnecting…');
    rerender(<ConnectionStatus state="load_failed" />);
    expect(screen.getByRole('status').textContent).toBe(
      "This board couldn't be loaded. Retrying…",
    );
  });
});

// --- TC-23: edit lock in load_failed ---------------------------------------

describe('TC-23: a load_failed board is not editable', () => {
  it('canEdit is false only for load_failed', () => {
    expect(canEdit('load_failed')).toBe(false);
    expect(canEdit('connected')).toBe(true);
    expect(canEdit('connecting')).toBe(true);
    expect(canEdit('reconnecting')).toBe(true);
    expect(canEdit('confirmed')).toBe(true);
  });

  beforeEach(() => {
    appState.connectionState = 'load_failed';
    appState.doc = new Y.Doc();
    appState.notes = [];
    createStickyMock.mockClear();
    deleteObjectMock.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('the Sticky note button is disabled', () => {
    render(<App />);
    const btn = screen.getByRole('button', { name: /sticky note/i });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it('double-clicking the board creates no note', () => {
    render(<App />);
    const viewport = document.querySelector('[data-vidi6="board-viewport"]');
    expect(viewport).not.toBeNull();
    fireEvent.doubleClick(viewport!, { clientX: 300, clientY: 200 });
    expect(createStickyMock).not.toHaveBeenCalled();
  });

  it('clicking the (disabled) Sticky note button creates no note', () => {
    render(<App />);
    const btn = screen.getByRole('button', { name: /sticky note/i });
    fireEvent.click(btn);
    expect(createStickyMock).not.toHaveBeenCalled();
  });

  it('pressing Delete removes nothing (no deleteObject call)', () => {
    render(<App />);
    // No note is selected (board is empty), but the key handler must be gated
    // by canEdit regardless. Dispatch a Delete keydown on the window.
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(deleteObjectMock).not.toHaveBeenCalled();
  });

  it('the same actions DO mutate when the board is connected', () => {
    appState.connectionState = 'connected';
    createStickyMock.mockReturnValue('note-1');
    render(<App />);
    const btn = screen.getByRole('button', { name: /sticky note/i });
    expect((btn as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(btn);
    expect(createStickyMock).toHaveBeenCalledTimes(1);
  });
});

// --- TC-28: close-code mapping --------------------------------------------

/** A controllable stand-in for the y-websocket provider. */
function makeMockProvider() {
  const state = { wsconnected: false, synced: false };
  const eventHandlers: Record<string, Set<(...args: unknown[]) => void>> = {};
  return {
    get wsconnected() {
      return state.wsconnected;
    },
    set wsconnected(v: boolean) {
      state.wsconnected = v;
    },
    get synced() {
      return state.synced;
    },
    set synced(v: boolean) {
      state.synced = v;
    },
    ws: null,
    on: (event: string, handler: (...args: unknown[]) => void) => {
      (eventHandlers[event] ??= new Set()).add(handler);
    },
    off: (event: string, handler: (...args: unknown[]) => void) => {
      eventHandlers[event]?.delete(handler);
    },
    destroy: () => {},
    _connect: () => {
      state.wsconnected = true;
      state.synced = true;
      // One sync event drives one handleSync call (the real provider emits
      // status and sync separately; a single call is enough to reach the
      // connected branch).
      eventHandlers['sync']?.forEach((h) => h());
    },
    _close: (code: number) => {
      state.wsconnected = false;
      state.synced = false;
      // The provider emits `connection-close` with the CloseEvent.
      eventHandlers['connection-close']?.forEach((h) => h({ code }));
    },
  };
}

describe('TC-28: close-code → connection state', () => {
  it('storage failure (1011) maps to reconnecting, not load_failed', () => {
    const provider = makeMockProvider();
    mockProviderRef.current = provider;
    const states: string[] = [];
    connectBoard(new Y.Doc(), 'abcdefghijklmnopqrstuvwxyz01', (s) => states.push(s));

    provider._connect();
    expect(states).toEqual(['connected']);

    provider._close(1011);
    expect(states).toEqual(['connected', 'reconnecting']);
    expect(states).not.toContain('load_failed');
  });

  it('unsupported data (1003) maps to reconnecting, not load_failed', () => {
    const provider = makeMockProvider();
    mockProviderRef.current = provider;
    const states: string[] = [];
    connectBoard(new Y.Doc(), 'abcdefghijklmnopqrstuvwxyz01', (s) => states.push(s));

    provider._connect();
    provider._close(1003);
    expect(states).toEqual(['connected', 'reconnecting']);
    expect(states).not.toContain('load_failed');
  });

  it('load failure (4500) maps to load_failed', () => {
    const provider = makeMockProvider();
    mockProviderRef.current = provider;
    const states: string[] = [];
    connectBoard(new Y.Doc(), 'abcdefghijklmnopqrstuvwxyz01', (s) => states.push(s));

    provider._connect();
    provider._close(CLOSE_BOARD_LOAD_FAILED);
    expect(states).toEqual(['connected', 'load_failed']);
  });

  it('a successful reconnection clears a prior load-failed close', () => {
    const provider = makeMockProvider();
    mockProviderRef.current = provider;
    const states: string[] = [];
    connectBoard(new Y.Doc(), 'abcdefghijklmnopqrstuvwxyz01', (s) => states.push(s));

    provider._connect();
    provider._close(CLOSE_BOARD_LOAD_FAILED);
    expect(states).toEqual(['connected', 'load_failed']);

    // The room recovers and the provider syncs again.
    provider._connect();
    // Recovery switches load_failed → connected (no 'confirmed', it was never
    // healthy-then-lost).
    expect(states[states.length - 1]).toBe('connected');
  });
});
