/**
 * Connection status component tests (TC-19 to TC-21).
 *
 * The badge is a pure view of the state `connectBoard` maps out of what the provider reports,
 * so these tests drive the real mapping: the real `WebsocketProvider`, a real y-protocols
 * handshake and a real `Y.Doc`, with only the wire replaced by a scripted socket (there is no
 * server in jsdom). Fake timers make `CONNECTED_CONFIRMATION_MS` exact, including its boundary.
 */
import { act, render, screen } from '@testing-library/react';
import { useEffect, useState } from 'react';
import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import { connectBoard, type ConnectionState } from '../../src/client/sync/connectBoard';
import { createSticky, initDoc } from '../../src/shared/board-model';
import { CONNECTED_CONFIRMATION_MS, RECONNECT_MAX_BACKOFF_MS } from '../../src/shared/config';
import { FakeSocket, fakeWebSocket } from './fakeSocket';

/** A room with one note, so a "synced" client really receives something. */
function roomDoc(): Y.Doc {
  const room = new Y.Doc();
  initDoc(room);
  createSticky(room, { x: 40, y: 40 });
  return room;
}

/** The badge as the app renders it: `connectBoard` feeds the state, the badge shows it. */
function BadgeUnderTest({
  webSocket = fakeWebSocket,
  idleTimeoutMs,
}: {
  /** A scripted socket stands in for the wire; everything above it is the real thing. */
  webSocket?: typeof WebSocket;
  /** Passed straight to `connectBoard`; only the idle-watch test shortens it. */
  idleTimeoutMs?: number;
} = {}) {
  const [state, setState] = useState<ConnectionState>('connecting');
  useEffect(() => {
    const doc = new Y.Doc();
    initDoc(doc);
    const live = connectBoard(doc, 'board-under-test', setState, { webSocket, idleTimeoutMs });
    return () => live.destroy();
  }, []);
  return <ConnectionStatus state={state} />;
}

const badge = () => screen.getByRole('status');
const badgeOrNull = () => screen.queryByRole('status');
const badgeText = () => badgeOrNull()?.textContent ?? null;

/**
 * Opens the socket the provider is currently trying to use and completes the sync. If the
 * last one died, the provider's backoff is waited out first, because that is what creates the
 * next attempt.
 */
function openAndSync(room: Y.Doc): void {
  if (FakeSocket.latest.readyState === FakeSocket.CLOSED) nextAttempt();
  act(() => {
    FakeSocket.latest.open();
    FakeSocket.latest.syncWith(room);
  });
}

/** Waits out the provider's backoff until it starts the next connection attempt. */
function nextAttempt(): FakeSocket {
  const before = FakeSocket.attempts;
  act(() => {
    vi.advanceTimersByTime(RECONNECT_MAX_BACKOFF_MS);
  });
  expect(FakeSocket.attempts).toBeGreaterThan(before);
  return FakeSocket.latest;
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.reset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the badge says what the connection is doing (TC-19 to TC-21)', () => {
  test('TC-19: "Connecting…" during the first load, then nothing at all', () => {
    const room = roomDoc();
    render(<BadgeUnderTest />);
    // the connection has been created but has not synced yet
    expect(badgeText()).toBe('Connecting…');

    openAndSync(room);
    // a board that is live needs no badge
    expect(badgeOrNull()).toBeNull();
    // and the first load is not "confirmed": that word is for coming back
    expect(badgeText()).toBeNull();
  });

  test('TC-20: "Reconnecting…" while the link is down, "Connected" for exactly CONNECTED_CONFIRMATION_MS after it returns', () => {
    const room = roomDoc();
    render(<BadgeUnderTest />);
    openAndSync(room);
    expect(badgeOrNull()).toBeNull();

    // the link drops
    act(() => {
      FakeSocket.latest.close(1001, 'the wifi went out');
    });
    expect(badgeText()).toBe('Reconnecting…');

    // the provider retries on its own; the second connection syncs
    openAndSync(room);
    expect(badgeText()).toBe('Connected');

    // one millisecond short of the budget it is still up
    act(() => {
      vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS - 1);
    });
    expect(badgeText()).toBe('Connected');

    // and it goes away exactly at the budget
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(badgeOrNull()).toBeNull();
  });

  test('TC-21: dropping again during the confirmation shows "Reconnecting…" immediately', () => {
    const room = roomDoc();
    render(<BadgeUnderTest />);
    openAndSync(room);

    act(() => {
      FakeSocket.latest.close(1001, 'first outage');
    });
    openAndSync(room);
    expect(badgeText()).toBe('Connected');

    // gone again before the green badge expired
    act(() => {
      FakeSocket.latest.close(1001, 'second outage');
    });
    expect(badgeText()).toBe('Reconnecting…');

    // the abandoned confirmation must not resurrect "Connected" later on
    act(() => {
      vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS + 1000);
    });
    expect(badgeText()).toBe('Reconnecting…');
  });

  test('a retry after a long outage also confirms, and an attempt that fails stays "Reconnecting…"', () => {
    const room = roomDoc();
    render(<BadgeUnderTest />);
    openAndSync(room);

    act(() => {
      FakeSocket.latest.close(1001, 'outage');
    });
    // the first attempt never gets anywhere
    const failed = nextAttempt();
    expect(badgeText()).toBe('Reconnecting…');
    act(() => {
      failed.close(1006, 'no answer');
    });
    expect(badgeText()).toBe('Reconnecting…');

    // a later attempt that syncs is the return
    nextAttempt();
    openAndSync(room);
    expect(badgeText()).toBe('Connected');
  });

  test('the browser noticing the network is gone is enough: no waiting for the socket', () => {
    // y-websocket only gives up after 30 s of silence, so the badge would lag a real outage
    // by half a minute without the `offline` event (which is what Playwright's offline mode
    // fires too, see the e2e outage tests)
    const room = roomDoc();
    render(<BadgeUnderTest />);
    openAndSync(room);
    expect(badgeOrNull()).toBeNull();

    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(badgeText()).toBe('Reconnecting…');

    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    // back online the provider starts a new attempt, which the room syncs
    openAndSync(room);
    expect(badgeText()).toBe('Connected');
  });

  test('a connection that carries nothing is called lost, because the browser would not', () => {
    // connectBoard wraps the socket in an idle watch; with a scripted room that sends nothing
    // after the handshake, the tab has to close the socket and start over on its own
    const room = roomDoc();
    render(<BadgeUnderTest idleTimeoutMs={2000} />);
    openAndSync(room);
    expect(badgeOrNull()).toBeNull();

    // 2 s of silence is not yet a lost connection... (negative boundary)
    act(() => {
      vi.advanceTimersByTime(1900);
    });
    expect(badgeOrNull()).toBeNull();

    // ...and once the watch next looks - it polls every quarter of the timeout - and finds
    // nothing on the wire, the connection is called lost and a new attempt starts, all on its
    // own: nothing external ever closed that socket
    const attempts = FakeSocket.attempts;
    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(badgeText()).toBe('Reconnecting…');
    expect(FakeSocket.instances[attempts - 1]?.readyState).toBe(FakeSocket.CLOSED);
    expect(FakeSocket.attempts).toBeGreaterThan(attempts);

    // and the way back is the ordinary one: the room syncs the new attempt, the badge confirms
    openAndSync(room);
    expect(badgeText()).toBe('Connected');
  });

  test('a socket the room closes as unsupported only costs this tab its connection', () => {
    const room = roomDoc();
    render(<BadgeUnderTest />);
    openAndSync(room);
    expect(badgeOrNull()).toBeNull();

    // what a bad frame costs this tab: the room closes this one socket with 1003 (see
    // integration TC-15), and the provider treats that as any other lost connection
    act(() => {
      FakeSocket.latest.close(1003, 'frame could not be decoded');
    });
    expect(badgeText()).toBe('Reconnecting…');

    // coming back on a connection the room accepts, the tab is live again
    openAndSync(room);
    expect(badgeText()).toBe('Connected');
  });

  test('leaving the board closes the connection, and nothing dials out again afterwards', () => {
    // the nightly soak checks that no reconnect is attempted after a participant closes their
    // tab; this is that contract, asserted where the backoff can actually be waited out
    const room = roomDoc();
    const { unmount } = render(<BadgeUnderTest />);
    openAndSync(room);
    const socket = FakeSocket.latest;
    expect(socket.readyState).toBe(FakeSocket.OPEN);

    unmount();
    expect(socket.readyState).toBe(FakeSocket.CLOSED);

    const attempts = FakeSocket.attempts;
    act(() => {
      vi.advanceTimersByTime(RECONNECT_MAX_BACKOFF_MS * 3);
    });
    expect(FakeSocket.attempts).toBe(attempts);
  });

  test('every state maps to the designed text, and the badge never blocks the board', () => {
    const states: [ConnectionState, string | null][] = [
      ['connecting', 'Connecting…'],
      ['connected', null],
      ['reconnecting', 'Reconnecting…'],
      ['confirmed', 'Connected'],
    ];
    for (const [state, text] of states) {
      const { unmount } = render(<ConnectionStatus state={state} />);
      expect(badgeText()).toBe(text);
      if (badgeOrNull()) {
        // `data-state` is what the end-to-end tests read, and the badge is never a modal
        expect(badge().dataset.state).toBe(state);
        expect(badge().getAttribute('aria-modal')).toBeNull();
      }
      unmount();
    }

    // negative: a badge never disables the board it is drawn over
    let edited = 0;
    render(
      <>
        <button type="button" onClick={() => (edited += 1)}>
          Edit note
        </button>
        <ConnectionStatus state="reconnecting" />
      </>,
    );
    act(() => {
      screen.getByRole('button').click();
    });
    expect(edited).toBe(1);
    expect(screen.getByRole('status')).toHaveAttribute('data-state', 'reconnecting');
  });
});
