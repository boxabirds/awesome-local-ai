// Story 3, `sync.client`: the badge that tells a person whether their changes
// are going anywhere, and the mapping from the provider's events to it.
//
// TC-19 to TC-21 are the design's coverage-table numbers, and each is asked
// twice: once of the badge alone, given the states it will be shown
// (`ConnectionStatus`), and once of the connection that produces those states
// from the provider's `status` and `sync` events (`connectBoard`). The second
// half matters because the two halves agree on nothing except the names: a
// badge that shows the right thing for a state the connection never reports is
// not a status.
//
// The confirmation window is fake-timer time, so its boundary is exact: "still
// up one millisecond before CONNECTED_CONFIRMATION_MS" and "gone at it" are both
// asserted.
import { act, render, screen } from '@testing-library/react';
import { useState, type JSX } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { CONNECTED_CONFIRMATION_MS } from '../../src/shared/config';
import { CLOSE_BOARD_LOAD_FAILED, CLOSE_STORAGE_FAILURE, CLOSE_UNSUPPORTED_DATA } from '../../src/shared/protocol';
import { canEdit } from '../../src/client/App';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import {
  boardSocketUrl,
  connectBoard,
  type ConnectionState,
} from '../../src/client/sync/connectBoard';
import { openedSockets } from './setup';
import type { WebsocketProvider } from 'y-websocket';

const badge = () => screen.queryByTestId('connection-status');

// lib0's `emit(name, args)` spreads `args` into the handlers, so an event is
// given as a one-element array: `emit('status', [{ status: 'connected' }])`.

/** The socket is open and the room has agreed the document. */
function agreeBoard(provider: WebsocketProvider): void {
  feed(provider, 'status', { status: 'connected' });
  feed(provider, 'sync', true);
}

/** One event from the provider, delivered the way React wants to hear about it. */
function feed(
  provider: WebsocketProvider,
  name: 'status' | 'sync',
  arg: { status: 'connected' | 'disconnected' | 'connecting' } | boolean,
): void {
  act(() => {
    provider.emit(name, [arg] as never);
  });
}

/** The socket went away with `code`. lib0 spreads the emit args, so the handler
 * sees the close event first — the same shape y-websocket emits. */
function feedClose(provider: WebsocketProvider, code: number): void {
  act(() => {
    provider.emit('connection-close', [{ code }, provider] as never);
  });
}

describe('TC-19 to TC-21: the badge, given its states', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('TC-19 says "Connecting…" for as long as it takes, then says nothing at all', () => {
    const view = render(<ConnectionStatus state="connecting" />);

    expect(badge()).toHaveTextContent('Connecting…');
    // The same message however long the board takes to arrive: no second
    // message, no giving up, no error.
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(badge()).toHaveTextContent('Connecting…');

    // A link that is up but has not agreed the document yet shows nothing:
    // people are not told every time a socket opens.
    view.rerender(<ConnectionStatus state="connected" />);
    expect(badge()).toBeNull();

    // A board that is agreed is announced once, and then left alone.
    view.rerender(<ConnectionStatus state="confirmed" />);
    expect(badge()).toHaveTextContent('Connected');
  });

  it('TC-20 says "Reconnecting…" through an outage and "Connected" on the boundary of coming back', () => {
    const view = render(<ConnectionStatus state="connected" />);
    expect(view.container.firstChild).toBeNull();

    // The link drops while the board is open. Nothing else changes on screen:
    // the badge is all that is said about it, and it is not an error.
    view.rerender(<ConnectionStatus state="reconnecting" />);
    expect(badge()).toHaveTextContent('Reconnecting…');
    // It goes on saying it for as long as the backoff runs — minutes, if it has
    // to — because a board is not given up on.
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(badge()).toHaveTextContent('Reconnecting…');

    // The link comes back: "Connected", and it is a passing thing.
    view.rerender(<ConnectionStatus state="confirmed" />);
    expect(badge()).toHaveTextContent('Connected');

    // One millisecond before the window ends it is still up.
    act(() => {
      vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS - 1);
    });
    expect(badge()).toHaveTextContent('Connected');

    // At the window it is gone, by itself, without being told anything.
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(badge()).toBeNull();
  });

  it('TC-21 goes back to "Reconnecting…" the moment the link goes again, and drops the timer it had', () => {
    const view = render(<ConnectionStatus state="confirmed" />);
    expect(badge()).toHaveTextContent('Connected');

    act(() => {
      vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS - 500);
    });
    expect(badge()).toHaveTextContent('Connected');

    view.rerender(<ConnectionStatus state="reconnecting" />);
    // Immediately, not when the last window happens to run out.
    expect(badge()).toHaveTextContent('Reconnecting…');
    act(() => {
      vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS);
    });
    expect(badge()).toHaveTextContent('Reconnecting…');

    // Unmounting inside a confirmation window leaves no timer behind either:
    // nothing fires after this, and nothing complains.
    view.rerender(<ConnectionStatus state="confirmed" />);
    expect(badge()).toHaveTextContent('Connected');
    view.unmount();
    act(() => {
      vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS * 2);
    });
    expect(badge()).toBeNull();
  });

  it('TC-22 says the board could not be loaded, in red, and says it quietly', () => {
    const { container } = render(<ConnectionStatus state="load_failed" />);
    const shown = badge();
    expect(shown).toHaveTextContent('This board couldn\'t be loaded. Retrying…');
    // A load failure is not an emergency: it is a status, not an alert, so a
    // screen reader does not interrupt what the person is doing to say it.
    expect(shown).toHaveAttribute('role', 'status');
    // and it is drawn in the failure colour, not the "Reconnecting…" grey
    expect(container.querySelector('.connection-status--load-failed')).not.toBeNull();
  });
});

describe('TC-19 to TC-21: the states the connection reports', () => {
  /**
   * A board, a connection to it, and the badge that shows what the connection
   * says. The socket itself is the component tier's stub (a component test asks
   * which state is reported, not what bytes go out; the bytes are the
   * integration tier's question), so the provider's events are fed by hand —
   * with the names and shapes the provider uses when a socket opens, drops and
   * comes back.
   */
  function boardWithConnection(boardId: string): {
    provider: WebsocketProvider;
    states: ConnectionState[];
    destroy(): void;
  } {
    const doc = new Y.Doc();
    const states: ConnectionState[] = [];
    let show: (state: ConnectionState) => void = () => {};

    function Board(): JSX.Element {
      const [state, setState] = useState<ConnectionState>('connecting');
      show = setState;
      return <ConnectionStatus state={state} />;
    }
    render(<Board />);

    // connectBoard is called outside the component so that its reports can be
    // recorded as they arrive; nothing is reported before the first event.
    const statesSeen = states;
    const connection = connectBoard(doc, boardId, (next) => {
      statesSeen.push(next);
      act(() => {
        show(next);
      });
    });
    return {
      provider: connection.provider,
      states: statesSeen,
      destroy: connection.destroy,
    };
  }

  const drop = (provider: WebsocketProvider) => feed(provider, 'status', { status: 'disconnected' });

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('TC-19 waits for the room to agree the document before it stops saying "Connecting…"', () => {
    const board = boardWithConnection('boardFirstLoad');
    expect(board.states).toEqual([]); // nothing has been reported: it never left "connecting"
    expect(badge()).toHaveTextContent('Connecting…');

    // The socket opens. A socket is not a board: the document has not been
    // agreed yet, so there is nothing to announce.
    feed(board.provider, 'status', { status: 'connected' });
    expect(badge()).toHaveTextContent('Connecting…');
    expect(board.states).toEqual([]);

    // The room has agreed the document. That is the moment the badge stops.
    feed(board.provider, 'sync', true);
    expect(board.states).toEqual(['connected']);
    expect(badge()).toBeNull();

    // It was a first load, so nothing was announced: the badge only ever says
    // "Connected" about a connection that came back.
    board.destroy();
  });

  it('TC-20 reports "reconnecting" for an outage and "confirmed" for the way back', () => {
    const board = boardWithConnection('boardAfterOutage');
    agreeBoard(board.provider);
    expect(board.states).toEqual(['connected']);
    expect(badge()).toBeNull();

    drop(board.provider);
    expect(board.states).toEqual(['connected', 'reconnecting']);
    expect(badge()).toHaveTextContent('Reconnecting…');

    feed(board.provider, 'status', { status: 'connected' });
    expect(board.states).toEqual(['connected', 'reconnecting', 'confirmed']);
    expect(badge()).toHaveTextContent('Connected');

    // And it hides itself when the window is up, without the connection
    // reporting anything further.
    act(() => {
      vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS);
    });
    expect(board.states).toEqual(['connected', 'reconnecting', 'confirmed']);
    expect(badge()).toBeNull();

    board.destroy();
  });

  it('TC-21 reports "reconnecting" again as soon as the link goes, inside the confirmation window', () => {
    const board = boardWithConnection('boardDropsTwice');
    agreeBoard(board.provider);
    drop(board.provider);
    feed(board.provider, 'status', { status: 'connected' });
    expect(badge()).toHaveTextContent('Connected');

    drop(board.provider);
    expect(board.states[board.states.length - 1]).toBe('reconnecting');
    expect(badge()).toHaveTextContent('Reconnecting…');

    // Nothing is left of the confirmation timer: the message that replaced it
    // stays up.
    act(() => {
      vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS * 2);
    });
    expect(badge()).toHaveTextContent('Reconnecting…');

    board.destroy();
  });

  it('repeats "connected" only once, so a board that is fine is not announced over and over', () => {
    const board = boardWithConnection('boardSteady');
    agreeBoard(board.provider);
    agreeBoard(board.provider); // the provider re-emits the state it is already in
    agreeBoard(board.provider);
    expect(board.states).toEqual(['connected']);

    board.destroy();
  });

  it('asks for the room of the board it was given, and no other', () => {
    // The board id is the only thing that separates one board from another, so
    // the address it is put in is worth asserting at every tier.
    const id = 'p1Chvj4mAlXsf8Ue0YUGHw';
    const url = boardSocketUrl(id);
    expect(url).toMatch(/^wss?:\/\//);
    expect(url.endsWith(`/api/rooms/${id}`)).toBe(true);

    // and it is the address the connection actually opened
    const board = boardWithConnection(id);
    const opened = openedSockets[openedSockets.length - 1];
    expect(opened?.url).toBe(url);
    board.destroy();
  });

  it('TC-28 reads a storage failure and a bad frame as "Reconnecting…", not a load failure', () => {
    const board = boardWithConnection('boardStorageFault');
    agreeBoard(board.provider); // the board is open and agreed
    const last = () => board.states[board.states.length - 1];

    // A storage failure closes with 1011. The board is readable and the change
    // is retried on reconnect, so this is "Reconnecting…" and stays editable.
    feedClose(board.provider, CLOSE_STORAGE_FAILURE);
    drop(board.provider);
    expect(last()).toBe('reconnecting');
    expect(canEdit(last()!)).toBe(true);

    // Back up and agreed again.
    agreeBoard(board.provider);

    // A frame the room could not read closes with 1003: same story, a lost link
    // that will be retried, not a board that cannot be loaded.
    feedClose(board.provider, CLOSE_UNSUPPORTED_DATA);
    drop(board.provider);
    expect(last()).toBe('reconnecting');
    expect(canEdit(last()!)).toBe(true);
    board.destroy();
  });

  it('TC-28 recovers to "connected" and editable once a load-failed board reads back', () => {
    const board = boardWithConnection('boardLoadThenRecovers');
    agreeBoard(board.provider);
    const last = () => board.states[board.states.length - 1];

    // The room could not read this board: it closes with the load-failure code.
    feedClose(board.provider, CLOSE_BOARD_LOAD_FAILED);
    drop(board.provider);
    expect(last()).toBe('load_failed');
    expect(canEdit(last()!)).toBe(false);

    // The link is back and, this time, the room reads the board and agrees it.
    feed(board.provider, 'status', { status: 'connected' });
    feed(board.provider, 'sync', true);
    expect(last()).toBe('connected');
    expect(canEdit(last()!)).toBe(true);
    board.destroy();
  });
});
