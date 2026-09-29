/**
 * Story 3: connection status badge (sync.client).
 *
 * Deterministic tests of the status mapping + badge using a fake provider
 * event emitter (the extracted state machine) and fake timers for the
 * CONNECTED_CONFIRMATION_MS boundary.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConnectionStatus } from 'src/client/sync/ConnectionStatus';
import {
  createConnectionStateMachine,
  type ConnectionState,
} from 'src/client/sync/connectBoard';
import { CONNECTED_CONFIRMATION_MS } from 'src/shared/config';

interface Harness {
  machine: ReturnType<typeof createConnectionStateMachine>;
  state: () => ConnectionState;
  rerender: () => void;
}

/** Wire the state machine to a live badge and return a re-render helper. */
function setup(): Harness {
  let state: ConnectionState = 'connecting';
  const machine = createConnectionStateMachine((s) => {
    state = s;
  });
  const view = render(<ConnectionStatus state={state} />);
  return {
    machine,
    state: () => state,
    rerender: () => view.rerender(<ConnectionStatus state={state} />),
  };
}

describe('sync.client connection status badge', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('TC-19: connecting → connected shows "Connecting…" then hides', () => {
    const { machine, rerender } = setup();

    // First load: badge visible with "Connecting…", role=status.
    expect(screen.getByRole('status')).toHaveTextContent('Connecting…');

    // First sync → connected → badge hidden.
    machine.onSync(true);
    rerender();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('TC-20: outage → "Reconnecting…" → "Connected"; visible at MS-1, hidden at MS', () => {
    const { machine, rerender } = setup();

    // Reach a steady connected state first.
    machine.onSync(true);
    rerender();
    expect(screen.queryByRole('status')).toBeNull();

    // Outage: socket dropped after having synced → reconnecting.
    machine.onStatus('disconnected');
    rerender();
    expect(screen.getByRole('status')).toHaveTextContent('Reconnecting…');

    // Socket back + re-synced → confirmed ("Connected", shown briefly).
    machine.onStatus('connected');
    machine.onSync(true);
    rerender();
    expect(screen.getByRole('status')).toHaveTextContent('Connected');

    // Boundary: still visible 1ms before the confirmation window closes.
    vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS - 1);
    rerender();
    expect(screen.getByRole('status')).toHaveTextContent('Connected');

    // Exactly at the boundary the badge hides.
    vi.advanceTimersByTime(1);
    rerender();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('TC-21: disconnect again during confirmation → "Reconnecting…" immediately', () => {
    const { machine, rerender } = setup();

    // Steady connected.
    machine.onSync(true);
    rerender();

    // Outage + re-sync → confirmed.
    machine.onStatus('disconnected');
    machine.onStatus('connected');
    machine.onSync(true);
    rerender();
    expect(screen.getByRole('status')).toHaveTextContent('Connected');

    // Drop again before the confirmation window elapses → reconnecting now.
    machine.onStatus('disconnected');
    rerender();
    expect(screen.getByRole('status')).toHaveTextContent('Reconnecting…');
  });

  it('badge is informational only: role=status + pointer-events none in every visible state', () => {
    const { machine, rerender } = setup();

    const assertVisible = (text: string) => {
      const badge = screen.getByRole('status');
      expect(badge).toHaveTextContent(text);
      // Informational overlay: never intercepts pointer input (no lockout).
      expect(badge).toHaveStyle({ pointerEvents: 'none' });
    };

    // connecting (initial).
    assertVisible('Connecting…');

    // connected → outage → reconnecting.
    machine.onSync(true);
    rerender();
    expect(screen.queryByRole('status')).toBeNull();
    machine.onStatus('disconnected');
    rerender();
    assertVisible('Reconnecting…');

    // re-synced → confirmed.
    machine.onStatus('connected');
    machine.onSync(true);
    rerender();
    assertVisible('Connected');
  });
});
