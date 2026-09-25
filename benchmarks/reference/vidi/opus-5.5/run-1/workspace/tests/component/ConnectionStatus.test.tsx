import { act, render, screen } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import {
  connectBoard,
  type BoardProvider,
  type ConnectionState,
} from '../../src/client/sync/connectBoard';
import { CONNECTED_CONFIRMATION_MS } from '../../src/shared/config';
import { CLOSE_BOARD_LOAD_FAILED, CLOSE_STORAGE_FAILURE } from '../../src/shared/protocol';

const LOAD_FAILED_TEXT = "This board couldn't be loaded. Retrying…";

type Status = 'connecting' | 'connected' | 'disconnected';

/** Stands in for WebsocketProvider: tests emit its `status` and `sync` events by hand. */
class FakeProvider implements BoardProvider {
  private statusHandlers: ((e: { status: Status }) => void)[] = [];
  private syncHandlers: ((synced: boolean) => void)[] = [];
  private closeHandlers: ((e: { code: number } | null) => void)[] = [];
  destroyed = false;
  wsconnected = false;
  restarts = 0;

  on(event: 'status' | 'sync' | 'connection-close', handler: never): void {
    if (event === 'status') this.statusHandlers.push(handler);
    else if (event === 'sync') this.syncHandlers.push(handler);
    else this.closeHandlers.push(handler);
  }

  /** What y-websocket emits when the server accepts and then closes with `code`. */
  serverClose(code: number): void {
    const wasConnected = this.wsconnected;
    this.wsconnected = true;
    this.status('connected');
    act(() => this.closeHandlers.forEach((h) => h({ code })));
    this.wsconnected = false;
    if (wasConnected) this.synced(false);
    this.status('disconnected');
    this.status('connecting');
  }

  destroy(): void {
    this.destroyed = true;
  }

  disconnect(): void {
    if (this.wsconnected) {
      this.wsconnected = false;
      this.status('disconnected');
    }
  }

  connect(): void {
    this.restarts += 1;
    this.status('connecting');
  }

  status(status: Status): void {
    act(() => this.statusHandlers.forEach((h) => h({ status })));
  }

  synced(value: boolean): void {
    act(() => this.syncHandlers.forEach((h) => h(value)));
  }

  /** What y-websocket emits for a successful (re)connection. */
  connectAndSync(): void {
    this.wsconnected = true;
    this.status('connected');
    this.synced(true);
  }

  /** What y-websocket emits when an open connection drops and it starts retrying. */
  drop(): void {
    this.wsconnected = false;
    this.synced(false);
    this.status('disconnected');
    this.status('connecting');
  }
}

let provider: FakeProvider;
let states: ConnectionState[];

function Harness() {
  const [state, setState] = useState<ConnectionState>('connecting');
  const [doc] = useState(() => new Y.Doc());
  useEffect(() => {
    const link = connectBoard(
      doc,
      'AbCdEfGhIjKlMnOpQr_-09',
      (s) => {
        states.push(s);
        setState(s);
      },
      () => provider,
    );
    return () => link.destroy();
  }, [doc]);
  return <ConnectionStatus state={state} />;
}

function badge(): HTMLElement | null {
  return screen.queryByRole('status', { name: 'Connection status' });
}

beforeEach(() => {
  vi.useFakeTimers();
  provider = new FakeProvider();
  states = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe('sync.client connection status badge', () => {
  it('TC-19 connecting → connected: "Connecting…" then hidden', () => {
    render(<Harness />);
    expect(badge()?.textContent).toBe('Connecting…');
    // The socket opening is not enough: the badge waits for the first sync.
    provider.status('connecting');
    provider.status('connected');
    expect(badge()?.textContent).toBe('Connecting…');
    provider.synced(true);
    expect(badge()).toBeNull();
    expect(states).toEqual(['connecting', 'connected']);
  });

  it('a failed first connection keeps showing "Connecting…" (never "Reconnecting…")', () => {
    render(<Harness />);
    provider.status('connecting');
    provider.status('disconnected');
    provider.status('connecting');
    expect(badge()?.textContent).toBe('Connecting…');
    vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS * 10);
    expect(badge()?.textContent).toBe('Connecting…');
  });

  it('TC-20 outage: "Reconnecting…" → "Connected" for exactly CONNECTED_CONFIRMATION_MS → hidden', () => {
    render(<Harness />);
    provider.connectAndSync();
    expect(badge()).toBeNull();

    provider.drop();
    const reconnecting = badge();
    expect(reconnecting?.textContent).toBe('Reconnecting…');
    expect(reconnecting?.getAttribute('data-state')).toBe('reconnecting');
    // Retries keep it amber.
    provider.status('disconnected');
    provider.status('connecting');
    expect(badge()?.textContent).toBe('Reconnecting…');

    provider.connectAndSync();
    expect(badge()?.textContent).toBe('Connected');
    expect(badge()?.getAttribute('data-state')).toBe('confirmed');
    act(() => {
      vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS - 1);
    });
    expect(badge()?.textContent).toBe('Connected');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(badge()).toBeNull();
    expect(states).toEqual(['connecting', 'connected', 'reconnecting', 'confirmed', 'connected']);
  });

  it('TC-21 dropping again during the confirmation shows "Reconnecting…" immediately', () => {
    render(<Harness />);
    provider.connectAndSync();
    provider.drop();
    provider.connectAndSync();
    expect(badge()?.textContent).toBe('Connected');
    act(() => {
      vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS / 2);
    });
    provider.drop();
    expect(badge()?.textContent).toBe('Reconnecting…');
    // The old confirmation timer must not hide the badge while still disconnected.
    act(() => {
      vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS);
    });
    expect(badge()?.textContent).toBe('Reconnecting…');
  });

  it('the browser going offline shows "Reconnecting…" at once; coming online retries at once', () => {
    render(<Harness />);
    provider.connectAndSync();
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(badge()?.textContent).toBe('Reconnecting…');
    expect(provider.restarts).toBe(1);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(provider.restarts).toBe(2);
    provider.connectAndSync();
    expect(badge()?.textContent).toBe('Connected');
    // Online while already connected does not drop the connection.
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(provider.restarts).toBe(2);
  });

  it('unmount destroys the provider and emits nothing afterwards', () => {
    const { unmount } = render(<Harness />);
    provider.connectAndSync();
    unmount();
    expect(provider.destroyed).toBe(true);
    const before = states.length;
    provider.drop();
    expect(states).toHaveLength(before);
  });
});

describe('sync.client: no lockout while not connected', () => {
  it('the whole app shows "Connecting…" while the room is unreachable and notes can still be made', async () => {
    vi.useRealTimers();
    const { renderBoard, doubleClickBoard, editor, notes } = await import('./stickyHelpers');
    renderBoard();
    expect(badge()?.textContent).toBe('Connecting…');
    doubleClickBoard(400, 300);
    expect(editor()).not.toBeNull();
    expect(notes()).toHaveLength(1);
    expect(badge()?.textContent).toBe('Connecting…');
  });
});

describe('persist.client_status: load failure', () => {
  it('TC-22 load_failed renders the red message with role status', () => {
    render(<ConnectionStatus state="load_failed" />);
    const el = badge();
    expect(el?.textContent).toBe(LOAD_FAILED_TEXT);
    expect(el?.getAttribute('data-state')).toBe('load_failed');
    expect(el?.className).toContain('connection-status--load_failed');
  });

  it('close 4500 → load_failed; retries keep it; a later sync → connected (no reload)', () => {
    render(<Harness />);
    provider.serverClose(CLOSE_BOARD_LOAD_FAILED);
    expect(badge()?.textContent).toBe(LOAD_FAILED_TEXT);
    // Retrying (backoff) and failing again keeps the message.
    provider.serverClose(CLOSE_BOARD_LOAD_FAILED);
    provider.status('disconnected');
    provider.status('connecting');
    expect(badge()?.textContent).toBe(LOAD_FAILED_TEXT);
    provider.connectAndSync();
    expect(badge()).toBeNull();
    expect(states).toEqual(['connecting', 'load_failed', 'connected']);
  });

  it('close 4500 after having been connected → load_failed', () => {
    render(<Harness />);
    provider.connectAndSync();
    provider.serverClose(CLOSE_BOARD_LOAD_FAILED);
    expect(badge()?.textContent).toBe(LOAD_FAILED_TEXT);
  });

  it('close 1011 (storage failure) → reconnecting, not load_failed', () => {
    render(<Harness />);
    provider.connectAndSync();
    provider.serverClose(CLOSE_STORAGE_FAILURE);
    expect(badge()?.textContent).toBe('Reconnecting…');
    expect(states).not.toContain('load_failed');
    provider.connectAndSync();
    expect(badge()?.textContent).toBe('Connected');
  });
});
