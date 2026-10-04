/**
 * sync.client status: what the badge says, and for how long.
 *
 * TC-19 first load: "Connecting…" until the board has arrived, then nothing.
 * TC-20 an outage and its end: "Reconnecting…" → green "Connected", which is
 * gone at exactly CONNECTED_CONFIRMATION_MS (boundary checked on both sides).
 * TC-21 a second drop during that confirmation: back to "Reconnecting…", and the
 * pending "Connected" timeout must not hide it afterwards.
 * Plus the negative: a page that is not connected is still a working board.
 *
 * The provider is a test double emitter (as the design specifies): the states
 * under test come from the mapping in `observeConnectionStatus`, and the socket
 * protocol behind a real provider has its own integration tests.
 */

import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useEffect, useState } from 'react';

import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import {
  observeConnectionStatus,
  type ConnectionState,
  type ProviderEvents,
  type ProviderStatus,
} from '../../src/client/sync/connectBoard';
import { CONNECTED_CONFIRMATION_MS } from '../../src/shared/config';
import { standInRoom } from './standInRoom';
import { renderBoard } from './boardHarness';

type StatusHandler = (event: { status: ProviderStatus }) => void;
type SyncHandler = (synced: boolean) => void;

/** The provider events the mapping listens to, driven by hand. */
class FakeProvider implements ProviderEvents {
  private readonly statusHandlers = new Set<StatusHandler>();
  private readonly syncHandlers = new Set<SyncHandler>();

  on(event: 'status', handler: StatusHandler): void;
  on(event: 'sync', handler: SyncHandler): void;
  on(event: 'status' | 'sync', handler: StatusHandler | SyncHandler): void {
    if (event === 'status') this.statusHandlers.add(handler as StatusHandler);
    else this.syncHandlers.add(handler as SyncHandler);
  }

  off(event: 'status', handler: StatusHandler): void;
  off(event: 'sync', handler: SyncHandler): void;
  off(event: 'status' | 'sync', handler: StatusHandler | SyncHandler): void {
    if (event === 'status') this.statusHandlers.delete(handler as StatusHandler);
    else this.syncHandlers.delete(handler as SyncHandler);
  }

  status(status: ProviderStatus): void {
    for (const handler of [...this.statusHandlers]) handler({ status });
  }

  sync(synced: boolean): void {
    for (const handler of [...this.syncHandlers]) handler(synced);
  }
}

function Badge({ provider }: { provider: FakeProvider }) {
  const [state, setState] = useState<ConnectionState>('connecting');
  useEffect(() => observeConnectionStatus(provider, setState), [provider]);
  return <ConnectionStatus state={state} />;
}

function badge(): HTMLElement | null {
  return screen.queryByTestId('connection-status');
}

describe('ConnectionStatus', () => {
  it('TC-19: says "Connecting…" during the first load and nothing once in sync', () => {
    const provider = new FakeProvider();
    render(<Badge provider={provider} />);
    expect(badge()?.getAttribute('role')).toBe('status');
    expect(badge()?.textContent).toBe('Connecting…');

    // A real provider reports the socket as connected a moment before the board
    // itself has arrived; only the sync ends the initial load.
    act(() => provider.status('connecting'));
    expect(badge()?.textContent).toBe('Connecting…');
    act(() => provider.status('connected'));
    expect(badge()?.textContent).toBe('Connecting…');

    act(() => provider.sync(true));
    expect(badge()).toBeNull();
  });

  it('TC-20: "Reconnecting…" during an outage, "Connected" for exactly the confirmation time after it', () => {
    const provider = new FakeProvider();
    render(<Badge provider={provider} />);
    act(() => {
      provider.status('connected');
      provider.sync(true);
    });
    expect(badge()).toBeNull();

    act(() => provider.status('disconnected'));
    expect(badge()?.textContent).toBe('Reconnecting…');

    act(() => {
      provider.status('connecting');
      provider.status('connected');
      provider.sync(true);
    });
    expect(badge()?.textContent).toBe('Connected');

    // The boundary: still up one millisecond before, gone at the deadline.
    act(() => vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS - 1));
    expect(badge()?.textContent).toBe('Connected');
    act(() => vi.advanceTimersByTime(1));
    expect(badge()).toBeNull();
  });

  it('TC-21: dropping again during the confirmation goes straight back to "Reconnecting…"', () => {
    const provider = new FakeProvider();
    render(<Badge provider={provider} />);
    act(() => {
      provider.status('connected');
      provider.sync(true);
    });
    act(() => {
      provider.status('disconnected');
      provider.status('connecting');
      provider.status('connected');
      provider.sync(true);
    });
    expect(badge()?.textContent).toBe('Connected');

    act(() => provider.status('disconnected'));
    expect(badge()?.textContent).toBe('Reconnecting…');

    // The confirmation that was still pending must not dismiss the badge.
    act(() => vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS));
    expect(badge()?.textContent).toBe('Reconnecting…');
  });

  it('TC-22 (negative): the board is fully editable while it says "Reconnecting…"', async () => {
    renderBoard();
    // The stand-in room's handshake completes on a microtask; once it has, the
    // badge is gone because the board is in sync.
    await act(async () => {});
    expect(badge()).toBeNull();

    act(() => standInRoom.cutConnections());
    const status = badge();
    expect(status?.getAttribute('role')).toBe('status');
    expect(status?.textContent).toBe('Reconnecting…');

    // Nothing is locked: a new note is created exactly as it would be online.
    act(() => screen.getByRole('button', { name: 'Sticky note' }).click());
    const notes = window.__vidi6?.getNotes?.() ?? [];
    expect(notes).toHaveLength(1);
    expect(badge()?.textContent).toBe('Reconnecting…');
  });
});
