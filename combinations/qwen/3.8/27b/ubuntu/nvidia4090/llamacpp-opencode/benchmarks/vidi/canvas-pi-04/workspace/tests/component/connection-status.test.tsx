// Story 3, task 7: the live badge component tests (TC-19, TC-20, TC-21).
//
// The state machine (observeConnectionStatus) is driven with a FAKE provider
// event emitter — no network — and the badge (ConnectionStatus) is rendered
// with Testing Library. Timers are faked so the CONNECTED_CONFIRMATION_MS
// window is exact.

import { act, render, screen } from '@testing-library/react';
import type { JSX } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import {
  observeConnectionStatus,
  type ConnectionState,
  type ConnectionStatusObserver,
} from '../../src/client/sync/connectBoard';
import { CONNECTED_CONFIRMATION_MS } from '../../src/shared/config';

/**
 * A fake y-websocket provider event emitter: feed the machine the same
 * payloads the real provider would emit, and observe the mapped states.
 */
function fakeProvider(onState: (state: ConnectionState) => void): {
  status(status: 'connecting' | 'connected' | 'disconnected'): void;
  sync(synced: boolean): void;
  destroy(): void;
} {
  const observer: ConnectionStatusObserver = observeConnectionStatus(onState);
  return {
    status: (status) => act(() => observer.onStatus({ status })),
    sync: (synced) => act(() => observer.onSync([synced])),
    destroy: () => observer.destroy(),
  };
}

function BadgeHarness(props: { state: ConnectionState }): JSX.Element {
  return <ConnectionStatus state={props.state} />;
}

/** Render the badge and return a step function: advance the machine + re-render. */
function setupBadge() {
  const onState = vi.fn<(state: ConnectionState) => void>();
  const provider = fakeProvider(onState);
  const view = render(<BadgeHarness state="connecting" />);
  const step = (state: ConnectionState): void => {
    act(() => {
      view.rerender(<BadgeHarness state={state} />);
    });
  };
  return { onState, provider, step, last: () => onState.mock.calls.at(-1)?.[0] };
}

describe('ConnectionStatus (task 7)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('TC-19: initial "Connecting…" hides once the doc first syncs', () => {
    const { onState, provider, step, last } = setupBadge();

    // The machine reports the initial state immediately.
    expect(onState).toHaveBeenLastCalledWith('connecting');
    const badge = screen.getByRole('status');
    expect(badge.textContent).toBe('Connecting…');
    expect(badge.getAttribute('data-state')).toBe('connecting');

    // Socket opens… not live yet (the doc has not synced).
    provider.status('connecting');
    provider.status('connected');
    expect(last()).toBe('connecting');
    expect(screen.getByRole('status').textContent).toBe('Connecting…');

    // First sync: live, badge hidden.
    provider.sync(true);
    expect(last()).toBe('connected');
    step('connected');
    expect(screen.queryByRole('status')).toBeNull();
    provider.destroy();
  });

  it('TC-20: drop after live → "Reconnecting…" → "Connected" → hidden after the window', () => {
    const { provider, step, last } = setupBadge();

    // Reach "connected" first.
    provider.status('connected');
    provider.sync(true);
    expect(last()).toBe('connected');
    step('connected');
    expect(screen.queryByRole('status')).toBeNull();

    // The socket drops: "Reconnecting…".
    provider.status('disconnected');
    expect(last()).toBe('reconnecting');
    step('reconnecting');
    const badge = screen.getByRole('status');
    expect(badge.textContent).toBe('Reconnecting…');
    expect(badge.getAttribute('data-state')).toBe('reconnecting');

    // It re-syncs: the green "Connected" confirmation.
    provider.status('connected');
    provider.sync(true);
    expect(last()).toBe('confirmed');
    step('confirmed');
    expect(screen.getByRole('status').textContent).toBe('Connected');
    expect(screen.getByRole('status').getAttribute('data-state')).toBe('confirmed');

    // One ms short of the window: still visible.
    act(() => {
      vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS - 1);
    });
    expect(screen.getByRole('status').textContent).toBe('Connected');

    // The window elapses: back to "connected", badge hidden.
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(last()).toBe('connected');
    step('connected');
    expect(screen.queryByRole('status')).toBeNull();
    provider.destroy();
  });

  it('TC-21: a second drop inside the window goes straight to "Reconnecting…"', () => {
    const { provider, step, last } = setupBadge();

    provider.status('connected');
    provider.sync(true);
    expect(last()).toBe('connected');

    provider.status('disconnected');
    provider.status('connected');
    provider.sync(true);
    expect(last()).toBe('confirmed');
    step('confirmed');
    expect(screen.getByRole('status').textContent).toBe('Connected');

    // Drop again while still in the confirmation window.
    provider.status('disconnected');
    expect(last()).toBe('reconnecting');
    step('reconnecting');
    const badge = screen.getByRole('status');
    expect(badge.textContent).toBe('Reconnecting…');

    // The board is never locked out: the badge is the only output, it has
    // role=status, and it is pointer-transparent (no interactive elements).
    expect(badge.querySelector('button, input')).toBeNull();
    provider.destroy();
  });
});
