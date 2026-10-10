/**
 * TC-19 to TC-21 (story 3, live.status) — the connection badge.
 *
 * The badge is a pure function of one state, and the state comes from
 * `createConnectionTracker`, so these tests feed the provider events the real
 * provider emits (`status`, `sync`) into the real state machine and re-render the
 * real component with whatever it says. Only the confirmation timer is faked —
 * the design's boundary is `CONNECTED_CONFIRMATION_MS - 1` and exactly that.
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CONNECTED_CONFIRMATION_MS } from '../../src/shared/config';
import { createConnectionTracker } from '../../src/client/sync/connectBoard';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';

import type { ConnectionTracker, ConnectionState } from '../../src/client/sync/connectBoard';

/** The badge as the board renders it, plus the events the board would report. */
function renderBadge(): {
  readonly tracker: ConnectionTracker;
  /** The badge's text, or `null` when there is no badge on screen. */
  badge(): string | null;
  /** `data-state`, so a test can tell the green "Connected" from a hidden one. */
  state(): string | null;
} {
  const view = render(<ConnectionStatus state="connecting" />);
  const tracker = createConnectionTracker((state) =>
    act(() => {
      view.rerender(<ConnectionStatus state={state} />);
    }),
  );
  return {
    tracker,
    badge: () => screen.queryByTestId('connection-status')?.textContent ?? null,
    state: () => screen.queryByTestId('connection-status')?.getAttribute('data-state') ?? null,
  };
}

/** Feed one provider event, as the provider does it: inside React's act(). */
function status(tracker: ConnectionTracker, next: 'connecting' | 'connected' | 'disconnected'): void {
  act(() => tracker.status(next));
}
function sync(tracker: ConnectionTracker, synced: boolean): void {
  act(() => tracker.sync(synced));
}
function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

/** A badge whose board has synced once, i.e. `connected` and hidden. */
function syncedOnce(): ReturnType<typeof renderBadge> {
  const view = renderBadge();
  status(view.tracker, 'connecting');
  sync(view.tracker, true);
  return view;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('the badge of a board that is coming and going (TC-19 to TC-21)', () => {
  // TC-19
  it('TC-19 says "Connecting…" while the first connection is up, and says nothing once it is synced', () => {
    const view = renderBadge();
    status(view.tracker, 'connecting');
    expect(view.badge()).toBe('Connecting…');
    expect(view.state()).toBe('connecting');

    // The socket is open but nothing has been exchanged: still not connected.
    status(view.tracker, 'connected');
    expect(view.badge()).toBe('Connecting…');

    sync(view.tracker, true);
    expect(view.badge()).toBeNull();
    expect(view.state()).toBeNull();
    expect(view.tracker.state).toBe('connected');
  });

  // TC-19, the other edge of the diagram: a board whose server is not there.
  it('TC-19 keeps saying "Connecting…" when a first connection never came up', () => {
    const view = renderBadge();
    status(view.tracker, 'connecting');
    status(view.tracker, 'disconnected'); // never synced: not an outage, still trying
    expect(view.badge()).toBe('Connecting…');
    expect(view.tracker.state).toBe('connecting');
    // And it is not the amber "Reconnecting…" of a board that lost a connection.
    expect(screen.getByTestId('connection-status').className).toContain('connection-status--connecting');
    advance(CONNECTED_CONFIRMATION_MS * 10);
    expect(view.badge()).toBe('Connecting…');
  });

  // TC-20
  it('TC-20 shows "Reconnecting…", then "Connected", and hides at exactly the confirmation deadline', () => {
    const view = syncedOnce();
    expect(view.badge()).toBeNull();

    status(view.tracker, 'disconnected');
    expect(view.badge()).toBe('Reconnecting…');
    expect(view.state()).toBe('reconnecting');

    // The socket came back and the documents exchanged again.
    status(view.tracker, 'connecting');
    sync(view.tracker, true);
    expect(view.badge()).toBe('Connected');
    expect(view.state()).toBe('confirmed');

    // Boundary: one millisecond before the deadline it is still there.
    advance(CONNECTED_CONFIRMATION_MS - 1);
    expect(view.badge()).toBe('Connected');
    // …and gone at exactly CONNECTED_CONFIRMATION_MS.
    advance(1);
    expect(view.badge()).toBeNull();
    expect(view.tracker.state).toBe('connected');
  });

  // TC-21
  it('TC-21 goes back to "Reconnecting…" the moment the connection drops again during the confirmation', () => {
    const view = syncedOnce();
    status(view.tracker, 'disconnected');
    sync(view.tracker, true);
    expect(view.badge()).toBe('Connected');

    advance(CONNECTED_CONFIRMATION_MS - 1);
    status(view.tracker, 'disconnected');
    // Immediately, not after a timer: the outage outranks the celebration.
    expect(view.badge()).toBe('Reconnecting…');
    expect(view.state()).toBe('reconnecting');
    // The confirmation timer of the connection that just died must not hide the
    // badge of the outage that replaced it.
    advance(CONNECTED_CONFIRMATION_MS * 2);
    expect(view.badge()).toBe('Reconnecting…');
    expect(view.tracker.state).toBe('reconnecting');
  });

  // The badge announces itself, which is what `role="status"` is for. (It is not
  // the only `status` on the board — the zoom percent is an `<output>` — so the
  // badge is also reachable by its own test id, as the browser tests do.)
  it('announces the badge as a live status region', () => {
    const view = renderBadge();
    status(view.tracker, 'disconnected');
    sync(view.tracker, true); // first sync -> hidden
    expect(screen.queryByRole('status')).toBeNull();
    status(view.tracker, 'disconnected');
    expect(screen.getByRole('status').textContent).toBe('Reconnecting…');
  });
});

/** A state the tracker never reports by itself, to pin the badge's own table. */
describe('one badge per state', () => {
  const shown: readonly (readonly [ConnectionState, string])[] = [
    ['connecting', 'Connecting…'],
    ['reconnecting', 'Reconnecting…'],
    ['confirmed', 'Connected'],
  ] as const;

  for (const [state, text] of shown) {
    it(`renders ${state} as "${text}"`, () => {
      render(<ConnectionStatus state={state} />);
      expect(screen.getByTestId('connection-status').textContent).toBe(text);
      expect(screen.getByTestId('connection-status').getAttribute('data-state')).toBe(state);
    });
  }

  // Silence is a requirement, not an accident: no element at all, so nothing
  // shifts on a board that is working.
  it('renders nothing at all while everything is normal', () => {
    const view = render(<ConnectionStatus state="connected" />);
    expect(screen.queryByTestId('connection-status')).toBeNull();
    expect(view.container.innerHTML).toBe('');
  });
});
