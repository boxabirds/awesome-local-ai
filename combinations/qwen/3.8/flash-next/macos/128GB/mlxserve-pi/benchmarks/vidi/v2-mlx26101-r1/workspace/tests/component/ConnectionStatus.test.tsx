// sync.client — connection badge and the provider-event → state mapping
// (TC-19, TC-20, TC-21). Fake timers make the "Connected" confirmation window
// exact, and a fake provider emitter (the same `status` / `sync` events
// y-websocket emits) drives it. The socket itself is stubbed for this project
// only; the transport is covered in workerd and in the browser e2e runs.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import { Toolbar } from '../../src/client/board/Toolbar';
import {
  createConnectionTracker,
  type ConnectionState,
} from '../../src/client/sync/connectBoard';
import { CONNECTED_CONFIRMATION_MS, RECONNECT_MAX_BACKOFF_MS } from '../../src/shared/config';
import App from '../../src/client/App';
import {
  lastProvider,
  resetProviderStub,
  type StubStatus,
} from './y-websocket-stub';

/**
 * The production wiring, minus the socket: `connectBoard` feeds exactly these two
 * provider events into a tracker, so driving a tracker drives the badge. Each
 * call goes through `act`, because any of them can re-render the badge.
 */
function useFakeConnection() {
  const [state, setState] = useState<ConnectionState>('connecting');
  const [tracker] = useState(() => createConnectionTracker(setState));
  return {
    state,
    status: (status: StubStatus) => act(() => void tracker.status(status)),
    sync: (synced: boolean) => act(() => void tracker.sync(synced)),
  };
}

function BadgeHarness() {
  const conn = useFakeConnection();
  (window as unknown as { __badge?: typeof conn }).__badge = conn;
  return <ConnectionStatus state={conn.state} />;
}

/** Drive the badge and read what it renders. */
function harness() {
  render(<BadgeHarness />);
  const conn = (window as unknown as { __badge?: ReturnType<typeof useFakeConnection> })
    .__badge;
  if (!conn) throw new Error('harness did not install itself');
  return conn;
}

const badge = () => screen.queryByRole('status');

/** Advance fake time and let the badge react to whatever fired. */
function advance(ms: number): void {
  act(() => void vi.advanceTimersByTime(ms));
}

describe('connection status badge', () => {
  beforeEach(() => {
    cleanup();
    vi.useFakeTimers();
    resetProviderStub();
    return () => {
      vi.useRealTimers();
    };
  });

  it('TC-19 shows "Connecting…" on first load and hides it once in sync', () => {
    const conn = harness();

    conn.status('connecting');
    expect(badge()).not.toBeNull();
    expect(badge()?.textContent).toBe('Connecting…');

    // The socket is open but nothing has synced yet: still first load.
    conn.status('connected');
    expect(badge()?.textContent).toBe('Connecting…');

    conn.sync(true);
    expect(badge()).toBeNull();
  });

  it('TC-20 shows "Reconnecting…", then "Connected" for exactly CONNECTED_CONFIRMATION_MS', () => {
    const conn = harness();
    conn.status('connecting');
    conn.sync(true);
    expect(badge()).toBeNull();

    // Connection lost with the page open: amber badge, board still editable.
    conn.status('disconnected');
    conn.sync(false);
    expect(badge()?.textContent).toBe('Reconnecting…');
    expect(badge()?.getAttribute('data-state')).toBe('reconnecting');

    // Back up: the green confirmation replaces it and stays for its whole window.
    conn.status('connecting');
    expect(badge()?.textContent).toBe('Reconnecting…');
    conn.status('connected');
    expect(badge()?.textContent).toBe('Connected');
    expect(badge()?.getAttribute('data-state')).toBe('confirmed');

    advance(CONNECTED_CONFIRMATION_MS - 1);
    expect(badge()?.textContent).toBe('Connected');

    // Boundary: exactly CONNECTED_CONFIRMATION_MS after it appeared, it is gone.
    advance(1);
    expect(badge()).toBeNull();
  });

  it('TC-20 hides the badge at the deadline even when the sync event lands first', () => {
    const conn = harness();
    conn.status('connecting');
    conn.sync(true);

    conn.status('disconnected');
    conn.sync(false);
    conn.status('connected');
    // The initial sync arrives during the confirmation window: it must not cut
    // the green badge short, or a reconnect would flash by.
    conn.sync(true);
    expect(badge()?.textContent).toBe('Connected');

    advance(CONNECTED_CONFIRMATION_MS - 1);
    expect(badge()?.textContent).toBe('Connected');
    advance(1);
    expect(badge()).toBeNull();
  });

  it('TC-21 goes straight back to "Reconnecting…" when the link drops again mid-confirmation', () => {
    const conn = harness();
    conn.status('connecting');
    conn.sync(true);

    conn.status('disconnected');
    conn.sync(false);
    conn.status('connected');
    expect(badge()?.textContent).toBe('Connected');

    advance(500);
    conn.status('disconnected');
    expect(badge()?.textContent).toBe('Reconnecting…');

    // The abandoned confirmation must not hide the badge later on.
    advance(CONNECTED_CONFIRMATION_MS * 2);
    expect(badge()?.textContent).toBe('Reconnecting…');
  });

  it('reports each state once, and nothing at all once destroyed', () => {
    const seen: ConnectionState[] = [];
    const tracker = createConnectionTracker((s) => seen.push(s));

    // First load: the badge already says "Connecting…", so neither the socket
    // opening nor a retry repeats it.
    tracker.status('connecting');
    tracker.status('connected');
    expect(seen).toEqual([]);

    tracker.sync(true);
    tracker.status('disconnected');
    tracker.sync(false);
    tracker.status('connected');
    tracker.sync(true); // lands inside the confirmation window: not a new state
    expect(seen).toEqual(['connected', 'reconnecting', 'confirmed']);

    // The green confirmation closes itself after exactly its window.
    vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS);
    expect(seen).toEqual([
      'connected',
      'reconnecting',
      'confirmed',
      'connected',
    ]);

    tracker.destroy();
    vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS * 2);
    expect(seen).toHaveLength(4);
  });

  it('connects the board doc to this origin and backs off no further than the setting', () => {
    render(<App />);
    const provider = lastProvider();
    expect(provider).not.toBeNull();
    const providerObj = provider as unknown as {
      serverUrl: string;
      roomname: string;
      options: { disableBc?: boolean; maxBackoffTime?: number };
    };
    // Same origin as the page, under /api/rooms — the Worker's room route.
    expect(providerObj.serverUrl).toBe('ws://localhost:3000/api/rooms');
    // Two tabs of the same browser must not sync around the room.
    expect(providerObj.options.disableBc).toBe(true);
    expect(providerObj.options.maxBackoffTime).toBe(RECONNECT_MAX_BACKOFF_MS);
    // The room name is the board id from the URL.
    expect(window.location.pathname).toBe(`/b/${providerObj.roomname}`);
    expect(providerObj.roomname).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it('keeps the board editable in every connection state (no lockout)', () => {
    let created = 0;
    for (const state of [
      'connected',
      'connecting',
      'reconnecting',
      'confirmed',
    ] as ConnectionState[]) {
      const { getByTestId, queryByRole, unmount } = render(
        <>
          <ConnectionStatus state={state} />
          <Toolbar onCreateSticky={() => created++} />
        </>,
      );
      // The badge says what is happening, and nothing more than that.
      const status = queryByRole('status');
      if (state === 'connected') expect(status).toBeNull();
      else expect(status?.getAttribute('data-state')).toBe(state);
      const create = getByTestId('create-sticky') as HTMLButtonElement;
      expect(create.disabled).toBe(false);
      const before = created;
      fireEvent.click(create);
      expect(created).toBe(before + 1);
      unmount();
    }
    expect(created).toBe(4);
  });
});
