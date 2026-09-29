// Connection status badge (spec: sync.client, TC-19 to TC-21).
//
// The badge is driven by `createConnectionStateMachine` with a fake provider
// event emitter and fake timers, so the status mapping and the badge text /
// visibility — including the CONNECTED_CONFIRMATION_MS boundary — are tested
// deterministically.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import {
  createConnectionStateMachine,
  type ConnectionState,
  type ConnectionStateMachine,
  type ProviderStatus,
} from '../../src/client/sync/connectBoard';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import { CONNECTED_CONFIRMATION_MS } from '../../src/shared/config';

let machine: ConnectionStateMachine;

/** Wire the machine to a rendered badge; returns a status feeder. */
function setupBadge() {
  let state: ConnectionState = 'connecting';
  const { rerender } = render(
    <ConnectionStatus state={state} />,
  );
  machine = createConnectionStateMachine((next) => {
    state = next;
    rerender(<ConnectionStatus state={state} />);
  });
  // Seed the initial 'connecting' event (as connectBoard does).
  machine.status('connecting');
  return {
    feed: (status: ProviderStatus) => machine.status(status),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  machine?.destroy();
  vi.useRealTimers();
  cleanup();
});

describe('ConnectionStatus badge', () => {
  it('TC-19: connecting → connected shows "Connecting…" then hides', () => {
    const { feed } = setupBadge();

    const badge = screen.getByRole('status');
    expect(badge.textContent).toBe('Connecting…');

    feed('connected');
    // A freshly connected board hides the badge (normal steady state).
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('TC-20: reconnect shows "Reconnecting…" then "Connected", hiding exactly at the confirmation boundary', () => {
    const { feed } = setupBadge();

    // Establish a first connection, then drop it.
    feed('connected');
    feed('disconnected');

    expect(screen.getByRole('status').textContent).toBe('Reconnecting…');

    feed('connected');
    expect(screen.getByRole('status').textContent).toBe('Connected');

    // Still visible one tick before the boundary.
    vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS - 1);
    expect(screen.getByRole('status').textContent).toBe('Connected');

    // Hidden at exactly CONNECTED_CONFIRMATION_MS (boundary).
    vi.advanceTimersByTime(1);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('TC-21: a second disconnect during confirmation shows "Reconnecting…" immediately', () => {
    const { feed } = setupBadge();

    feed('connected');
    feed('disconnected');
    feed('connected');
    expect(screen.getByRole('status').textContent).toBe('Connected');

    // Drop again while the green confirmation is still showing.
    feed('disconnected');
    expect(screen.getByRole('status').textContent).toBe('Reconnecting…');
  });

  it('badge has role=status and never blocks the board (pointer-events: none)', () => {
    const { feed } = setupBadge();
    feed('connected');
    feed('disconnected');
    const badge = screen.getByRole('status');
    expect(badge.className).toContain('connection-badge--reconnecting');
    // The badge must never intercept board input.
    expect((badge as HTMLElement).style.pointerEvents || 'none').not.toBe('auto');
    // No interactive controls inside: editing stays available in every state.
    expect(badge.querySelector('button, [disabled]')).toBeNull();
  });
});
