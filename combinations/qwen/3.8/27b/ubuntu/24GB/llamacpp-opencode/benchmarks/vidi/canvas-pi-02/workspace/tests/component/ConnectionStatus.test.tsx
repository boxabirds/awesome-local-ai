import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import { createConnectionStateMachine } from '../../src/client/sync/connectBoard';
import type { ConnectionState } from '../../src/client/sync/connectBoard';
import { CONNECTED_CONFIRMATION_MS } from '../../src/shared/config';

/**
 * sync.client state mapping + badge (task 7, TC-19 to TC-21).
 *
 * The machine is driven by a fake provider event emitter (no sockets) and
 * fake timers, so every transition — including the boundary at
 * CONNECTED_CONFIRMATION_MS — is deterministic.
 */

interface Driver {
  /** Emit a provider status event. */
  status(status: 'connecting' | 'connected' | 'disconnected'): void;
  /** Emit a provider sync event. */
  sync(state: boolean): void;
  /** Browser went offline (drives `markReconnecting`). */
  offline(): void;
  /** Browser is back online (drives `confirmRecovered`). */
  online(): void;
  /** Advance the (fake) clock and re-render (confirmation timers may fire). */
  advance(ms: number): void;
  /** Current mapped phase. */
  phase(): ConnectionState;
}

/** Wire the real state machine to a fake emitter and a live badge. */
function drive(): Driver & ReturnType<typeof render> {
  let phase: ConnectionState = 'connecting';
  const machine = createConnectionStateMachine((next) => {
    phase = next;
  });
  const utils = render(<ConnectionStatus phase={phase} />);
  const refresh = (): void => utils.rerender(<ConnectionStatus phase={phase} />);
  return {
    ...utils,
    status: (status) => {
      machine.getStatus({ status });
      refresh();
    },
    sync: (state) => {
      machine.onSync(state);
      refresh();
    },
    offline: () => {
      machine.markReconnecting();
      refresh();
    },
    online: () => {
      machine.confirmRecovered();
      refresh();
    },
    advance: (ms) => {
      vi.advanceTimersByTime(ms);
      refresh();
    },
    phase: () => phase,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('sync.client badge (task 7)', () => {
  it('TC-19 connecting -> connected: "Connecting…" then hidden', () => {
    const d = drive();
    expect(screen.getByText('Connecting…').getAttribute('role')).toBe('status');
    expect(d.phase()).toBe('connecting');

    d.sync(true);
    expect(d.phase()).toBe('connected');
    expect(screen.queryByText('Connecting…')).toBeNull();
    expect(screen.queryByText('Connected')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('TC-20 reconnect: "Reconnecting…" -> "Connected", hidden exactly at the boundary', () => {
    vi.useFakeTimers();
    const d = drive();
    d.sync(true);
    expect(d.phase()).toBe('connected');

    d.status('disconnected');
    expect(d.phase()).toBe('reconnecting');
    expect(screen.getByText('Reconnecting…').getAttribute('role')).toBe('status');

    d.sync(true);
    expect(d.phase()).toBe('confirmedConnected');
    expect(screen.getByText('Connected').getAttribute('role')).toBe('status');

    // Still visible just before the confirmation window ends…
    d.advance(CONNECTED_CONFIRMATION_MS - 1);
    expect(screen.getByText('Connected')).not.toBeNull();

    // …and hidden exactly at CONNECTED_CONFIRMATION_MS (boundary).
    d.advance(1);
    expect(d.phase()).toBe('connected');
    expect(screen.queryByText('Connected')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('TC-21 disconnect again during the confirmation window: "Reconnecting…" immediately', () => {
    vi.useFakeTimers();
    const d = drive();
    d.sync(true);
    d.status('disconnected');
    d.sync(true);
    expect(d.phase()).toBe('confirmedConnected');

    d.advance(CONNECTED_CONFIRMATION_MS / 2);
    d.status('disconnected');
    expect(d.phase()).toBe('reconnecting');
    expect(screen.getByText('Reconnecting…')).not.toBeNull();
    expect(screen.queryByText('Connected')).toBeNull();
  });

  it('the badge never locks the board out: siblings stay interactive while reconnecting', async () => {
    let clicks = 0;
    render(
      <>
        <ConnectionStatus phase="reconnecting" />
        <button onClick={() => clicks++}>create</button>
      </>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'create' }));
    await userEvent.click(screen.getByRole('button', { name: 'create' }));
    expect(clicks).toBe(2);
  });

  it('initial connection failures stay "connecting" (no spurious reconnecting)', () => {
    const d = drive();
    // A failed open while still connecting: the provider retries with backoff.
    d.status('disconnected');
    expect(d.phase()).toBe('connecting');
    expect(screen.getByText('Connecting…')).not.toBeNull();
  });

  it('TC-27 offline while connected goes "Reconnecting…" at once (no 30 s watchdog wait)', () => {
    const d = drive();
    d.sync(true);
    expect(d.phase()).toBe('connected');
    expect(screen.queryByRole('status')).toBeNull();

    // The browser reports offline before the provider's socket has even
    // started to look dead: the badge must react immediately.
    d.offline();
    expect(d.phase()).toBe('reconnecting');
    expect(screen.getByText('Reconnecting…').getAttribute('role')).toBe('status');
  });

  it('TC-27 online after an offline drop: "Connected" then hidden at the boundary', () => {
    vi.useFakeTimers();
    const d = drive();
    d.sync(true);
    d.offline();
    expect(d.phase()).toBe('reconnecting');

    // Back online and the provider has re-synced.
    d.online();
    expect(d.phase()).toBe('confirmedConnected');
    expect(screen.getByText('Connected')).not.toBeNull();

    d.advance(CONNECTED_CONFIRMATION_MS);
    expect(d.phase()).toBe('connected');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('offline during the initial connect is a no-op (stays "Connecting…")', () => {
    const d = drive();
    d.offline();
    expect(d.phase()).toBe('connecting');
    expect(screen.getByText('Connecting…')).not.toBeNull();
  });

  it('online while still connecting is a no-op (nothing recovered yet)', () => {
    const d = drive();
    d.online();
    expect(d.phase()).toBe('connecting');
  });
});
