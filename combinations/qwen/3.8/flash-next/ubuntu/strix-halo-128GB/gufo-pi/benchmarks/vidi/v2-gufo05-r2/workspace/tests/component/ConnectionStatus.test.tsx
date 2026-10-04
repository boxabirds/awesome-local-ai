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
 * Story 4 adds the message that is not about the connection:
 * TC-22 the room saying it could not load this board, in red, and not softened
 *        into "Reconnecting…" by the retries that follow it,
 * TC-28 the close code read off the socket: 4500 locks the board, 1011 and 1003
 *        do not, and the board's content arriving unlocks it again by itself.
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
import { canEdit } from '../../src/client/App';
import { CONNECTED_CONFIRMATION_MS } from '../../src/shared/config';
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
} from '../../src/shared/protocol';
import { standInRoom } from './standInRoom';
import { renderBoard } from './boardHarness';

type StatusHandler = (event: { status: ProviderStatus }) => void;
type SyncHandler = (synced: boolean) => void;
type CloseHandler = (event: { code: number } | null) => void;

/** The provider events the mapping listens to, driven by hand. */
class FakeProvider implements ProviderEvents {
  private readonly statusHandlers = new Set<StatusHandler>();
  private readonly syncHandlers = new Set<SyncHandler>();
  private readonly closeHandlers = new Set<CloseHandler>();

  on(event: 'status', handler: StatusHandler): void;
  on(event: 'sync', handler: SyncHandler): void;
  on(event: 'connection-close', handler: CloseHandler): void;
  on(event: 'status' | 'sync' | 'connection-close', handler: (...args: never[]) => void): void {
    if (event === 'status') this.statusHandlers.add(handler as StatusHandler);
    else if (event === 'sync') this.syncHandlers.add(handler as SyncHandler);
    else this.closeHandlers.add(handler as CloseHandler);
  }

  off(event: 'status', handler: StatusHandler): void;
  off(event: 'sync', handler: SyncHandler): void;
  off(event: 'connection-close', handler: CloseHandler): void;
  off(event: 'status' | 'sync' | 'connection-close', handler: (...args: never[]) => void): void {
    if (event === 'status') this.statusHandlers.delete(handler as StatusHandler);
    else if (event === 'sync') this.syncHandlers.delete(handler as SyncHandler);
    else this.closeHandlers.delete(handler as CloseHandler);
  }

  status(status: ProviderStatus): void {
    for (const handler of [...this.statusHandlers]) handler({ status });
  }

  sync(synced: boolean): void {
    for (const handler of [...this.syncHandlers]) handler(synced);
  }

  /** The room closed a socket that had been open, with the code it chose. */
  close(code: number | null): void {
    for (const handler of [...this.closeHandlers]) handler(code === null ? null : { code });
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

  it('TC-22: the room could not load this board, and the retries do not soften that', () => {
    const provider = new FakeProvider();
    render(<Badge provider={provider} />);
    act(() => {
      provider.status('connected');
      provider.sync(true);
    });
    expect(badge()).toBeNull();

    act(() => provider.close(CLOSE_BOARD_LOAD_FAILED));
    const status = badge();
    expect(status?.textContent).toBe("This board couldn't be loaded. Retrying…");
    // The colour lives in CSS, so this is the hook it hangs on: a different state
    // name, and a class of its own next to the amber and green ones.
    expect(status?.getAttribute('data-state')).toBe('load_failed');
    expect(status?.className).toContain('connection-status--load_failed');

    // The provider retries underneath, and each retry would say something else. The
    // board is not on its way, so nothing else gets said.
    act(() => {
      provider.status('connecting');
      provider.status('disconnected');
      provider.status('connecting');
    });
    expect(badge()?.textContent).toBe("This board couldn't be loaded. Retrying…");

    // Until the board itself arrives. Then the badge goes, and with it the lock.
    act(() => {
      provider.status('connected');
      provider.sync(true);
    });
    expect(badge()).toBeNull();
  });

  it('TC-28: the close code decides whether the board is locked', () => {
    const states: ConnectionState[] = [];
    const provider = new FakeProvider();
    observeConnectionStatus(provider, (state) => states.push(state));

    act(() => {
      provider.status('connected');
      provider.sync(true);
    });
    states.length = 0;

    // The room's storage failed while it was working: the board is probably fine,
    // this page's edits are safe in its document, and it must not be locked.
    act(() => provider.close(CLOSE_STORAGE_FAILURE));
    expect(states).toEqual(['reconnecting']);
    expect(canEdit('reconnecting')).toBe(true);

    // Traffic the room cannot read, a socket dropped by anything at all: the same.
    act(() => provider.close(CLOSE_UNSUPPORTED_DATA));
    expect(states.at(-1)).toBe('reconnecting');
    act(() => provider.close(null));
    expect(states.at(-1)).toBe('reconnecting');

    // And the one code that means the board is not there to edit.
    act(() => provider.close(CLOSE_BOARD_LOAD_FAILED));
    expect(states.at(-1)).toBe('load_failed');
    expect(canEdit(states.at(-1)!)).toBe(false);

    // Content arriving is the whole recovery: no reload, no second chance asked of
    // the person in front of the screen.
    act(() => provider.sync(true));
    expect(states.at(-1)).toBe('connected');
    expect(canEdit(states.at(-1)!)).toBe(true);

    // A board that loads is not locked, whichever state came before it.
    expect(canEdit('connecting')).toBe(true);
    expect(canEdit('confirmed')).toBe(true);
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
    act(() => screen.getByRole('button', { name: 'Sticky note (N)' }).click());
    const notes = window.__vidi6?.getNotes?.() ?? [];
    expect(notes).toHaveLength(1);
    expect(badge()?.textContent).toBe('Reconnecting…');
  });
});
