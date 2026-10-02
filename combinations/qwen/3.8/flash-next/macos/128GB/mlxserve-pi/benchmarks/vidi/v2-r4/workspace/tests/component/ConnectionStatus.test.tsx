/**
 * TC-19 to TC-21: the connection state mapping (`trackConnectionState`) and the
 * badge it drives (`ConnectionStatus`), with fake timers and a fake provider, so
 * the confirmation window is tested at its exact boundary instead of waited for.
 */
import { act, render, screen, fireEvent } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import {
  trackConnectionState,
  type ConnectionState,
  type ProviderEvents,
} from '../../src/client/sync/connectBoard';
import { CONNECTED_CONFIRMATION_MS } from '../../src/shared/config';

type StatusValue = 'connecting' | 'connected' | 'disconnected';
type StatusListener = (event: { status: StatusValue }) => void;
type SyncListener = (synced: boolean) => void;

/** Stands in for a `WebsocketProvider`: the two events it emits, on demand. */
class FakeProvider implements ProviderEvents {
  readonly #statusListeners = new Set<StatusListener>();
  readonly #syncListeners = new Set<SyncListener>();

  on(event: 'status', listener: StatusListener): unknown;
  on(event: 'synced', listener: SyncListener): unknown;
  on(event: 'status' | 'synced', listener: StatusListener | SyncListener): unknown {
    const listeners =
      event === 'status'
        ? (this.#statusListeners as Set<StatusListener | SyncListener>)
        : (this.#syncListeners as Set<StatusListener | SyncListener>);
    listeners.add(listener);
    return undefined;
  }

  off(event: 'status', listener: StatusListener): unknown;
  off(event: 'synced', listener: SyncListener): unknown;
  off(event: 'status' | 'synced', listener: StatusListener | SyncListener): unknown {
    const listeners =
      event === 'status'
        ? (this.#statusListeners as Set<StatusListener | SyncListener>)
        : (this.#syncListeners as Set<StatusListener | SyncListener>);
    listeners.delete(listener);
    return undefined;
  }

  /** The provider opened or retried a socket. */
  status(status: StatusValue): void {
    for (const listener of [...this.#statusListeners]) listener({ status });
  }

  /** The document finished (or stopped finishing) its sync with the room. */
  sync(synced: boolean): void {
    for (const listener of [...this.#syncListeners]) listener(synced);
  }
}

/** The badge as `App` shows it: fed by the mapping, not by the test directly. */
function ConnectedBadge({ provider }: { provider: FakeProvider }) {
  const [state, setState] = useState<ConnectionState>('connecting');
  useEffect(() => trackConnectionState(provider, setState), [provider]);
  return <ConnectionStatus state={state} />;
}

const badge = () => screen.queryByRole('status');

/** Everything the provider does while opening the page for the first time. */
function connect(provider: FakeProvider): void {
  act(() => {
    provider.status('connecting');
    provider.status('connected');
    provider.sync(true);
  });
}

function drop(provider: FakeProvider): void {
  act(() => {
    provider.status('disconnected');
  });
}

function bringBack(provider: FakeProvider): void {
  act(() => {
    provider.status('connecting');
    provider.status('connected');
    provider.sync(true);
  });
}

function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe('connection status', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('TC-19: says Connecting… on the first load and goes away once synced', () => {
    const provider = new FakeProvider();
    render(<ConnectedBadge provider={provider} />);

    expect(badge()).not.toBeNull();
    expect(badge()?.textContent).toBe('Connecting…');

    connect(provider);

    expect(badge()).toBeNull();
  });

  it('TC-20: says Reconnecting… while offline and Connected for exactly CONNECTED_CONFIRMATION_MS after', () => {
    const provider = new FakeProvider();
    render(<ConnectedBadge provider={provider} />);
    connect(provider);
    expect(badge()).toBeNull();

    drop(provider);
    expect(badge()?.textContent).toBe('Reconnecting…');

    bringBack(provider);
    expect(badge()?.textContent).toBe('Connected');

    // Boundary: the badge is still up one millisecond before it is due to hide…
    advance(CONNECTED_CONFIRMATION_MS - 1);
    expect(badge()?.textContent).toBe('Connected');

    // …and hidden at exactly the confirmation time.
    advance(1);
    expect(badge()).toBeNull();
  });

  it('TC-21: going offline again during the confirmation shows Reconnecting… immediately', () => {
    const provider = new FakeProvider();
    render(<ConnectedBadge provider={provider} />);
    connect(provider);

    drop(provider);
    bringBack(provider);
    expect(badge()?.textContent).toBe('Connected');

    drop(provider);
    expect(badge()?.textContent).toBe('Reconnecting…');

    // The confirmation of the connection that just died must not fire later.
    advance(CONNECTED_CONFIRMATION_MS + 1);
    expect(badge()?.textContent).toBe('Reconnecting…');
  });

  it('leaves the board editable while the badge is up (negative of TC-20)', () => {
    const provider = new FakeProvider();
    const onEdit = vi.fn();
    render(
      <div>
        <button type="button" onClick={onEdit}>
          Note text
        </button>
        <ConnectedBadge provider={provider} />
      </div>,
    );
    connect(provider);

    act(() => {
      provider.status('disconnected');
    });
    expect(badge()?.textContent).toBe('Reconnecting…');

    const note = screen.getByRole('button', { name: 'Note text' }) as HTMLButtonElement;
    expect(note.disabled).toBe(false);
    fireEvent.click(note);
    expect(onEdit).toHaveBeenCalledTimes(1);
  });
});
