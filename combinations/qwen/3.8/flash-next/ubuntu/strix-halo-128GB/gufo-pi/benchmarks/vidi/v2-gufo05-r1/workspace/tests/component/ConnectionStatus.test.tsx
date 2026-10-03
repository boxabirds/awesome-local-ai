/**
 * The connection badge and the timing inside it.
 *
 * Two things are tested here, and it is worth being clear about which is which.
 * The badge itself is a pure function of a state, so its cases are direct. The
 * *timing* — "Connected" showing for CONNECTED_CONFIRMATION_MS after a catch-up, and
 * being replaced by "Reconnecting…" the moment the connection fails again — lives in
 * `trackConnection`, which is why the states are fed through that machine rather than
 * set by hand: the sequence, not just the pictures, is what the story promises.
 *
 * Fake timers are used for the confirmation window, so the test runs in
 * milliseconds and asserts the boundary at CONNECTED_CONFIRMATION_MS - 1 and exactly
 * CONNECTED_CONFIRMATION_MS rather than hoping a real two seconds went by.
 */
import { act, render, screen } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CONNECTED_CONFIRMATION_MS } from '../../src/shared/config';
import { ConnectionStatus, CONNECTION_STATUS_TEXT } from '../../src/client/sync/ConnectionStatus';
import {
  trackConnection,
  type ConnectionEvent,
  type ConnectionState,
  type ConnectionSignals,
} from '../../src/client/sync/connectBoard';

/** A connection the test drives by hand. */
class FakeSignals implements ConnectionSignals {
  private readonly listeners = new Set<(event: ConnectionEvent) => void>();
  private inSync = false;

  subscribe(listener: (event: ConnectionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  synced(): boolean {
    return this.inSync;
  }

  status(status: 'connecting' | 'connected' | 'disconnected'): void {
    for (const listener of [...this.listeners]) listener({ type: 'status', status });
  }

  sync(synced: boolean): void {
    this.inSync = synced;
    for (const listener of [...this.listeners]) listener({ type: 'sync', synced });
  }
}

/** The badge, driven by a fake connection the caller holds. */
function Harness({ signals, onState }: { signals: ConnectionSignals; onState?: (state: ConnectionState) => void }) {
  const [state, setState] = useState<ConnectionState>('connecting');
  useEffect(
    () =>
      trackConnection(signals, (next) => {
        setState(next);
        onState?.(next);
      }),
    [signals, onState],
  );
  return <ConnectionStatus state={state} />;
}

function badge(): HTMLElement | null {
  return screen.queryByTestId('connection-status');
}

afterEach(() => {
  vi.useRealTimers();
});

describe('connection badge (TC-19)', () => {
  it('says “Connecting…” and then nothing at all once the boards are in sync', () => {
    const signals = new FakeSignals();
    render(<Harness signals={signals} />);

    const first = badge();
    expect(first).not.toBeNull();
    expect(first).toHaveTextContent(CONNECTION_STATUS_TEXT.connecting);
    expect(first).toHaveAttribute('role', 'status');
    expect(first).toHaveAttribute('data-state', 'connecting');

    act(() => {
      signals.status('connected'); // the socket is open; the boards still have to meet
    });
    expect(badge()).toHaveTextContent(CONNECTION_STATUS_TEXT.connecting);

    act(() => {
      signals.sync(true);
    });
    expect(badge()).toBeNull();
  });

  it('never sits between a person and the note under it', () => {
    // A badge centred at the top of the board is above the world layer, so the one
    // property that keeps the board fully editable in every connection state is
    // `pointer-events: none`. jsdom has no hit testing, so the property itself is
    // what can be asserted here; the e2e outage test (TC-27) types into a board
    // while the badge is up, which is the same promise from the other side.
    for (const state of ['connecting', 'reconnecting', 'confirmed'] as const) {
      const { unmount } = render(<ConnectionStatus state={state} />);
      expect(badge()).toHaveStyle({ pointerEvents: 'none' });
      expect(badge()).not.toHaveAttribute('aria-disabled');
      unmount();
    }
  });

  it('is already silent when the boards were in sync before it mounted', () => {
    const signals = new FakeSignals();
    signals.sync(true);
    render(<Harness signals={signals} />);
    expect(badge()).toBeNull();
  });

  it('draws each state with its own text and class', () => {
    const cases: { state: Exclude<ConnectionState, 'connected'> }[] = [
      { state: 'connecting' },
      { state: 'reconnecting' },
      { state: 'confirmed' },
    ];
    for (const testCase of cases) {
      const { unmount } = render(<ConnectionStatus state={testCase.state} />);
      const element = badge();
      expect(element).not.toBeNull();
      expect(element).toHaveTextContent(CONNECTION_STATUS_TEXT[testCase.state]);
      expect(element).toHaveClass(`connection-status--${testCase.state}`);
      unmount();
    }
    // And the state with nothing to say renders nothing.
    const { container } = render(<ConnectionStatus state="connected" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('badge after an outage (TC-20, TC-21)', () => {
  it('shows “Reconnecting…”, then “Connected”, then hides itself at the second', () => {
    vi.useFakeTimers();
    const signals = new FakeSignals();
    render(<Harness signals={signals} />);

    act(() => {
      signals.sync(true);
    });
    expect(badge()).toBeNull();

    // The Wi-Fi stops answering.
    act(() => {
      signals.status('disconnected');
    });
    const reconnecting = badge();
    expect(reconnecting).not.toBeNull();
    expect(reconnecting).toHaveTextContent(CONNECTION_STATUS_TEXT.reconnecting);
    expect(reconnecting).toHaveAttribute('data-state', 'reconnecting');

    // The boards meet again: the good news is shown, and shown until the last
    // millisecond of its window.
    act(() => {
      signals.status('connected');
      signals.sync(true);
    });
    const confirmed = badge();
    expect(confirmed).not.toBeNull();
    expect(confirmed).toHaveTextContent(CONNECTION_STATUS_TEXT.confirmed);

    act(() => {
      vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS - 1);
    });
    expect(badge()).toHaveTextContent(CONNECTION_STATUS_TEXT.confirmed);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(badge()).toBeNull();
  });

  it('goes straight back to “Reconnecting…” if the connection fails during the confirmation', () => {
    vi.useFakeTimers();
    const signals = new FakeSignals();
    render(<Harness signals={signals} />);
    act(() => {
      signals.sync(true);
    });
    act(() => {
      signals.status('disconnected');
    });
    act(() => {
      signals.status('connected');
      signals.sync(true);
    });
    expect(badge()).toHaveTextContent(CONNECTION_STATUS_TEXT.confirmed);

    // Halfway through the green message the connection drops again. The green one is
    // not allowed to finish: it would be saying something that is no longer true.
    act(() => {
      vi.advanceTimersByTime(Math.floor(CONNECTED_CONFIRMATION_MS / 2));
    });
    act(() => {
      signals.status('disconnected');
    });
    expect(badge()).toHaveTextContent(CONNECTION_STATUS_TEXT.reconnecting);
    expect(badge()).toHaveAttribute('data-state', 'reconnecting');

    // And the cancelled confirmation must not hide the badge later on its own schedule.
    act(() => {
      vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS * 2);
    });
    expect(badge()).toHaveTextContent(CONNECTION_STATUS_TEXT.reconnecting);
  });

  it('says “Connecting…”, not “Reconnecting…”, when a first load is slow', () => {
    const signals = new FakeSignals();
    render(<Harness signals={signals} />);
    act(() => {
      signals.status('connecting');
    });
    expect(badge()).toHaveTextContent(CONNECTION_STATUS_TEXT.connecting);
    act(() => {
      signals.status('disconnected'); // never synced: still the first load failing
    });
    expect(badge()).toHaveTextContent(CONNECTION_STATUS_TEXT.connecting);
  });
});
