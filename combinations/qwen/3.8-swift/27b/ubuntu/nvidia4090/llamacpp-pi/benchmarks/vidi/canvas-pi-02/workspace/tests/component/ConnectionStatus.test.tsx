// Connection status badge (story 3, sync.client) — ui-component tests with
// fake timers: TC-19, TC-20, TC-21. The badge renders from the REAL
// connection state machine (createConnectionTracker), fed with simulated
// provider facts.

import { act, render, screen } from '@testing-library/react';
import { type ReactElement, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createConnectionTracker,
  type ConnectionTracker,
  type ConnectionState,
} from '../../src/client/sync/connectBoard';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import { CONNECTED_CONFIRMATION_MS } from '../../src/shared/config';

/**
 * Harness: a component that owns the REAL tracker (wired to a React state
 * setter) so fed facts re-render the badge exactly as in the app.
 */
function makeHarness(): { tracker: ConnectionTracker; Badge: () => ReactElement } {
  let tracker: ConnectionTracker | undefined;
  const Badge = (): ReactElement => {
    const [state, setState] = useState<ConnectionState>('connecting');
    if (tracker === undefined) tracker = createConnectionTracker(setState);
    return <ConnectionStatus state={state} />;
  };
  return {
    get tracker() {
      if (tracker === undefined) throw new Error('Badge not rendered');
      return tracker;
    },
    Badge,
  };
}

const badge = () => screen.queryByTestId('connection-status');

describe('ConnectionStatus (story 3 sync.client)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("TC-19: first connect — 'Connecting…' until open and synced, then hidden", () => {
    const h = makeHarness();
    render(<h.Badge />);

    expect(badge()).not.toBeNull();
    expect(badge()).toHaveTextContent('Connecting…');

    // Socket opens…
    act(() => h.tracker.feed('connected', false));
    expect(badge()).toHaveTextContent('Connecting…');

    // …and sync completes: badge hidden (state stays available for logic).
    act(() => h.tracker.feed('connected', true));
    expect(badge()).toBeNull();
    expect(h.tracker.state).toBe('connected');
  });

  it("TC-20: outage after connect — 'Reconnecting…' then green 'Connected' for CONNECTED_CONFIRMATION_MS, then hidden", async () => {
    const h = makeHarness();
    render(<h.Badge />);

    act(() => h.tracker.feed('connected', true));
    expect(badge()).toBeNull();

    // Wi-Fi drops.
    act(() => h.tracker.feed('disconnected', false));
    expect(badge()).not.toBeNull();
    expect(badge()).toHaveTextContent('Reconnecting…');

    // Wi-Fi returns: open and synced again.
    act(() => h.tracker.feed('connected', true));
    expect(badge()).not.toBeNull();
    expect(badge()).toHaveTextContent('Connected');

    // Confirmation window not elapsed: still visible.
    await act(async () => {
      vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS - 1);
    });
    expect(badge()).not.toBeNull();
    expect(badge()).toHaveTextContent('Connected');

    // Exactly CONNECTED_CONFIRMATION_MS: hidden.
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(badge()).toBeNull();
    expect(h.tracker.state).toBe('connected');
  });

  it("TC-21: disconnect again during confirmation — 'Reconnecting…' immediately", () => {
    const h = makeHarness();
    render(<h.Badge />);

    act(() => h.tracker.feed('connected', true));
    act(() => h.tracker.feed('disconnected', false));
    act(() => h.tracker.feed('connected', true));
    expect(badge()).toHaveTextContent('Connected');

    // Flaps again part-way through the confirmation window.
    act(() => {
      vi.advanceTimersByTime(500);
      h.tracker.feed('disconnected', false);
    });
    expect(badge()).not.toBeNull();
    expect(badge()).toHaveTextContent('Reconnecting…');
  });
});
