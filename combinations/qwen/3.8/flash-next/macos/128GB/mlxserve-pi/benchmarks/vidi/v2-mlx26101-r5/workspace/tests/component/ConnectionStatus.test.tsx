/**
 * TC-19, TC-20, TC-21, TC-22 and TC-28: the connection badge and the state machine behind it.
 *
 * The provider is a fake that emits the events a network would, when the test says so.
 * That is the whole point of these cases: a connection that comes back for half a
 * second has to be *noticed* as half a second, and the only way to test a window of two
 * seconds is to own the clock. Story 4 adds the close codes to what the fake can say, which
 * is the only way to have a room that says "I could not read this board" on a schedule.
 */

import { act, render, screen } from '@testing-library/react';
import { useState } from 'react';
import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectionStatus } from '../../src/client/board/ConnectionStatus';
import { useBoardConnection } from '../../src/client/board/useBoardConnection';
import type { BoardProvider, BoardStatus, ConnectionState } from '../../src/client/board/connection';
import { FakeProvider } from './helpers/fake-provider';
import { CONNECTED_CONFIRMATION_MS } from '../../src/shared/config';
import { CLOSE_BOARD_LOAD_FAILED, CLOSE_STORAGE_FAILURE } from '../../src/shared/protocol';
import { canEdit } from '../../src/client/board/connection';
import { initDoc } from '../../src/shared/board-model';
import { IDENTITY_COLORS } from '../../src/client/board/identity';

/** The board under test. A real id, so nothing special has to be excused. */
const BOARD_ID = 'boardboardboardboard01';

/** What the board shows: the badge, plus the state the badge is built from. */
function Harness({
  provider,
  boardId = BOARD_ID,
  onState,
}: {
  provider: BoardProvider;
  boardId?: string;
  onState?: (state: ConnectionState) => void;
}) {
  const [doc] = useState(() => {
    const created = new Y.Doc();
    initDoc(created);
    return created;
  });
  const { status } = useBoardConnection(doc, boardId, {
    provider,
    // A stable identity, so the awareness assertion does not depend on a random draw.
    identity: { name: 'Test Person', color: IDENTITY_COLORS[0] as string },
  });
  onState?.(status);
  return <ConnectionStatus state={status} />;
}

// The confirmation window is two seconds of wall clock; here it is two seconds of fake
// clock, which is the only kind a test can step through one millisecond at a time.
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function badge(): HTMLElement {
  return screen.getByTestId('connection-status');
}

function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

/**
 * Consecutive repeats are one state, not two. `Harness` reports the state as it renders it,
 * and a re-render for any other reason says the same thing again; what a test asks about is
 * the sequence the badge was shown in. (The confirmation test above does the same by hand.)
 */
function distinct(states: readonly ConnectionState[]): ConnectionState[] {
  return states.filter((state, index) => index === 0 || states[index - 1] !== state);
}

describe('TC-19 — the badge while a board is coming up', () => {
  it('shows Connecting… on the first frame', () => {
    render(<Harness provider={new FakeProvider()} />);
    expect(badge().textContent).toBe('Connecting…');
    expect(badge().getAttribute('role')).toBe('status');
  });

  it('shows Connecting… before the socket is even reported as connecting', () => {
    // The order the provider reports in is not the point: the board is waiting from the
    // first frame, so the first frame already says so.
    const provider = new FakeProvider();
    render(<Harness provider={provider} />);
    expect(badge().getAttribute('data-state')).toBe('connecting');
    provider.emitStatus('connecting');
    expect(badge().textContent).toBe('Connecting…');
  });

  it('disappears once the room is reached', () => {
    const provider = new FakeProvider();
    render(<Harness provider={provider} />);
    act(() => provider.emitStatus('connected'));
    expect(screen.queryByTestId('connection-status')).toBeNull();
  });

  it('disappears when the board is in sync even if status never said connected', () => {
    const provider = new FakeProvider();
    render(<Harness provider={provider} />);
    act(() => provider.emitSync(true));
    expect(screen.queryByTestId('connection-status')).toBeNull();
  });

  it('says Reconnecting… when a connection that was up starts trying again', () => {
    // 'connecting' after 'connected' means a retry is under way, which is exactly what
    // the amber badge is for. It goes away when the retry gets somewhere.
    const provider = new FakeProvider();
    render(<Harness provider={provider} />);
    act(() => provider.emitStatus('connected'));
    act(() => provider.emitStatus('connecting'));
    expect(badge().textContent).toBe('Reconnecting…');
    // Coming back from a retry is still a comeback: it has to hold before it is believed.
    act(() => provider.emitStatus('connected'));
    expect(badge().textContent).toBe('Reconnecting…');
    advance(CONNECTED_CONFIRMATION_MS);
    expect(screen.queryByTestId('connection-status')).toBeNull();
  });
});

describe('TC-20 — a connection that comes back has to hold', () => {
  it('shows Reconnecting… the moment a live connection drops', () => {
    const provider = new FakeProvider();
    render(<Harness provider={provider} />);
    act(() => provider.emitStatus('connected'));
    act(() => provider.emitStatus('disconnected'));
    expect(badge().textContent).toBe('Reconnecting…');
    expect(badge().getAttribute('data-state')).toBe('reconnecting');
  });

  it('still says Reconnecting… one millisecond before the confirmation window ends', () => {
    const provider = new FakeProvider();
    render(<Harness provider={provider} />);
    act(() => provider.emitStatus('connected'));
    act(() => provider.emitStatus('disconnected'));
    act(() => provider.emitStatus('connected'));
    advance(CONNECTED_CONFIRMATION_MS - 1);
    expect(badge().textContent).toBe('Reconnecting…');
  });

  it('calls it connected one millisecond after the window ends', () => {
    const provider = new FakeProvider();
    render(<Harness provider={provider} />);
    act(() => provider.emitStatus('connected'));
    act(() => provider.emitStatus('disconnected'));
    act(() => provider.emitStatus('connected'));
    advance(CONNECTED_CONFIRMATION_MS - 1);
    advance(1);
    expect(screen.queryByTestId('connection-status')).toBeNull();
  });

  it('does not flash Connected for a connection that was up for a moment only', () => {
    // The case the confirmation window exists for: back at 200 ms, gone at 400 ms, back
    // for good after that. The badge says Reconnecting… throughout, and never lies.
    const provider = new FakeProvider();
    const seen: BoardStatus[] = [];
    render(<Harness provider={provider} onState={(state) => seen.push(state)} />);
    act(() => provider.emitStatus('connected'));
    act(() => provider.emitStatus('disconnected'));
    act(() => provider.emitStatus('connected'));
    advance(200);
    act(() => provider.emitStatus('disconnected'));
    advance(200);
    act(() => provider.emitStatus('connected'));
    advance(CONNECTED_CONFIRMATION_MS);
    expect(screen.queryByTestId('connection-status')).toBeNull();
    // What the user sees is the badge changing, not React re-rendering: consecutive
    // frames that say the same thing are one state, not two.
    const transitions = seen.filter((state, index) => index === 0 || seen[index - 1] !== state);
    expect(transitions).toEqual(['connecting', 'connected', 'reconnecting', 'connected']);
  });

  it('is amber, not the same colour as Connecting…', () => {
    const provider = new FakeProvider();
    const { unmount } = render(<Harness provider={provider} />);
    expect(badge().className).toContain('connection-status--connecting');
    unmount();

    const dropped = new FakeProvider();
    render(<Harness provider={dropped} />);
    act(() => dropped.emitStatus('connected'));
    act(() => dropped.emitStatus('disconnected'));
    expect(badge().className).toContain('connection-status--reconnecting');
    expect(badge().className).not.toContain('connection-status--connecting');
  });
});

describe('TC-21 — a connection that drops again during the confirmation window', () => {
  it('goes back to Reconnecting… at once, not when the window would have ended', () => {
    const provider = new FakeProvider();
    render(<Harness provider={provider} />);
    act(() => provider.emitStatus('connected'));
    act(() => provider.emitStatus('disconnected'));
    act(() => provider.emitStatus('connected'));
    advance(CONNECTED_CONFIRMATION_MS / 2);
    act(() => provider.emitStatus('disconnected'));
    expect(badge().textContent).toBe('Reconnecting…');
    expect(badge().getAttribute('data-state')).toBe('reconnecting');
  });

  it('stays on Reconnecting… when the cancelled window runs out', () => {
    // The timer from the connection that already died must not come back and announce a
    // connection that is not there.
    const provider = new FakeProvider();
    render(<Harness provider={provider} />);
    act(() => provider.emitStatus('connected'));
    act(() => provider.emitStatus('disconnected'));
    act(() => provider.emitStatus('connected'));
    advance(CONNECTED_CONFIRMATION_MS / 2);
    act(() => provider.emitStatus('disconnected'));
    advance(CONNECTED_CONFIRMATION_MS * 3);
    expect(badge().textContent).toBe('Reconnecting…');
  });

  it('connects for good when a later attempt holds', () => {
    const provider = new FakeProvider();
    render(<Harness provider={provider} />);
    act(() => provider.emitStatus('connected'));
    act(() => provider.emitStatus('disconnected'));
    act(() => provider.emitStatus('connected'));
    advance(10);
    act(() => provider.emitStatus('disconnected'));
    act(() => provider.emitStatus('connected'));
    advance(CONNECTED_CONFIRMATION_MS);
    expect(screen.queryByTestId('connection-status')).toBeNull();
  });

  it('treats a sync that goes away like a dropped connection', () => {
    const provider = new FakeProvider();
    render(<Harness provider={provider} />);
    act(() => provider.emitSync(true));
    act(() => provider.emitSync(false));
    expect(badge().textContent).toBe('Reconnecting…');
  });
});

describe('the connection behind the badge', () => {
  beforeEach(() => {
    // The identity is drawn once per session; a test must not see another's draw.
    window.sessionStorage.clear();
  });

  it('publishes who we are once, and never rewrites it', () => {
    const provider = new FakeProvider();
    render(<Harness provider={provider} />);
    expect(provider.published).toHaveLength(1);
    expect(provider.published[0]).toMatchObject({
      field: 'user',
      value: { name: 'Test Person', color: IDENTITY_COLORS[0] },
    });
    act(() => provider.emitStatus('connected'));
    act(() => provider.emitStatus('disconnected'));
    act(() => provider.emitStatus('connected'));
    expect(provider.published).toHaveLength(1);
  });

  it('gives itself a Guest name when the board does not say who it is', () => {
    const provider = new FakeProvider();
    render(<Connectionless provider={provider} />);
    expect(provider.published).toHaveLength(1);
    const value = provider.published[0]?.value as { name: string; color: string };
    expect(value.name).toMatch(/^Guest [0-9A-F]{4}$/);
    expect(IDENTITY_COLORS).toContain(value.color);
  });

  it('keeps the same identity next time the same session opens a board', () => {
    const first = new FakeProvider();
    const { unmount } = render(<Connectionless provider={first} />);
    const name = (first.published[0]?.value as { name: string }).name;
    unmount();
    const second = new FakeProvider();
    render(<Connectionless provider={second} />);
    expect((second.published[0]?.value as { name: string }).name).toBe(name);
  });

  it('is made once per board, and a re-render does not make another', () => {
    const provider = new FakeProvider();
    const { rerender } = render(<Harness provider={provider} />);
    expect(provider.statusRegistrations).toBe(1);
    rerender(<Harness provider={provider} />);
    rerender(<Harness provider={provider} />);
    expect(provider.statusRegistrations).toBe(1);
    expect(provider.destroyed).toBe(false);
  });

  it('is torn down when the board goes away, and nothing is left listening', () => {
    const provider = new FakeProvider();
    const { unmount } = render(<Harness provider={provider} />);
    act(() => provider.emitStatus('connected'));
    unmount();
    expect(provider.destroyed).toBe(true);
    expect(provider.listening).toBe(false);
    // An event arriving after the board is gone must not reach anything.
    expect(() => {
      act(() => provider.emitStatus('disconnected'));
    }).not.toThrow();
  });

  it('shows no badge and connects to nothing for a board that is not on the network', () => {
    const provider = new FakeProvider();
    render(<Offline provider={provider} />);
    expect(screen.queryByTestId('connection-status')).toBeNull();
    expect(provider.statusRegistrations).toBe(0);
    expect(provider.destroyed).toBe(false);
  });

  /** A board with no room to join: a document on its own, as the canvas tests drive. */
  function Offline({ provider }: { provider: FakeProvider }) {
    const [doc] = useState(() => {
      const created = new Y.Doc();
      initDoc(created);
      return created;
    });
    const { status } = useBoardConnection(doc, undefined, { provider });
    return <ConnectionStatus state={status} />;
  }

  /** The same badge, with the identity the board would choose for itself. */
  function Connectionless({ provider }: { provider: FakeProvider }) {
    const [doc] = useState(() => {
      const created = new Y.Doc();
      initDoc(created);
      return created;
    });
    const { status } = useBoardConnection(doc, BOARD_ID, { provider });
    return <ConnectionStatus state={status} />;
  }
});

describe('the badge on its own', () => {
  it('says what a link that is not a board link is', () => {
    render(<ConnectionStatus state="invalid-board" />);
    expect(badge().getAttribute('role')).toBe('status');
    expect(badge().textContent).toBe('Not a valid board link');
  });

  it('renders nothing when the board is connected', () => {
    render(<ConnectionStatus state="connected" />);
    expect(screen.queryByTestId('connection-status')).toBeNull();
  });

  it('names each state in its own words', () => {
    const seen = new Set<string>();
    for (const state of ['connecting', 'reconnecting', 'load_failed', 'invalid-board'] as const) {
      const { unmount } = render(<ConnectionStatus state={state} />);
      const text = badge().textContent as string;
      expect(seen.has(text)).toBe(false);
      seen.add(text);
      unmount();
    }
  });
});


describe('TC-22 — the badge when the room could not read the board', () => {
  it('says the board could not be loaded, in red, and says it as news', () => {
    const provider = new FakeProvider();
    render(<Harness provider={provider} />);
    act(() => provider.emitClose(CLOSE_BOARD_LOAD_FAILED));

    expect(badge().textContent).toBe("This board couldn't be loaded. Retrying…");
    expect(badge().getAttribute('role'), 'a screen reader is told').toBe('status');
    expect(badge().getAttribute('data-state')).toBe('load_failed');
    expect(badge().className, 'red, the colour of a board that is not coming').toContain(
      'connection-status--load_failed',
    );
    expect(badge().className, 'and not the amber of a line that is being difficult').not.toContain(
      'connection-status--reconnecting',
    );
  });

  it('is not softened by retries that go nowhere', () => {
    // The provider dials again — that is what it does, and what the badge's "Retrying…" is
    // pointing at — and each dial is refused in the same way. A badge that went back to
    // "Reconnecting…" between refusals would be reporting on the line while the board is
    // the thing that is wrong.
    const seen: ConnectionState[] = [];
    const provider = new FakeProvider();
    render(<Harness provider={provider} onState={(state) => seen.push(state)} />);
    act(() => provider.emitClose(CLOSE_BOARD_LOAD_FAILED));
    act(() => provider.emitStatus('connecting'));
    act(() => provider.emitSync(false));
    act(() => provider.emitStatus('disconnected'));
    act(() => provider.emitClose(CLOSE_BOARD_LOAD_FAILED));
    act(() => provider.emitClose(CLOSE_BOARD_LOAD_FAILED));

    expect(distinct(seen)).toEqual(['connecting', 'load_failed']);
  });

  it('is the state that stops the board being written to', () => {
    const seen: ConnectionState[] = [];
    const provider = new FakeProvider();
    render(<Harness provider={provider} onState={(state) => seen.push(state)} />);
    act(() => provider.emitClose(CLOSE_BOARD_LOAD_FAILED));
    expect(canEdit(distinct(seen)[distinct(seen).length - 1] as ConnectionState), 'a board we cannot read is not a board to type into').toBe(
      false,
    );
  });

  it('is not a give-up: the provider is still connected to and still dialing', () => {
    const provider = new FakeProvider();
    render(<Harness provider={provider} />);
    act(() => provider.emitClose(CLOSE_BOARD_LOAD_FAILED));
    expect(provider.destroyed, 'nothing tore the provider down').toBe(false);
    expect(provider.listening, 'the board is still listening for the room to come right').toBe(true);
  });
});

describe('TC-28 — what a close code means to the board', () => {
  /**
   * A board that got as far as working, because a close only means something to a board that
   * had a connection to lose.
   */
  function workingBoard(): {
    provider: FakeProvider;
    seen: ConnectionState[];
  } {
    const provider = new FakeProvider();
    const seen: ConnectionState[] = [];
    render(<Harness provider={provider} onState={(state) => seen.push(state)} />);
    act(() => {
      provider.emitStatus('connected');
      provider.emitSync(true);
    });
    return { provider, seen };
  }

  it('takes a storage failure for a line problem, and keeps the board editable', () => {
    const { provider, seen } = workingBoard();
    act(() => provider.emitClose(CLOSE_STORAGE_FAILURE));

    expect(distinct(seen)).toEqual(['connecting', 'connected', 'reconnecting']);
    expect(badge().getAttribute('data-state')).toBe('reconnecting');
    expect(
      canEdit(distinct(seen)[distinct(seen).length - 1] as ConnectionState),
      'the board is readable and the changes it holds go over again on the next connection',
    ).toBe(true);
  });

  it('takes a close with no code at all the same way', () => {
    // A polyfill that reports no code must not be read as "the room refused this board",
    // which is the mistake that would lock a perfectly good board.
    const { provider, seen } = workingBoard();
    act(() => provider.emitClose(null));
    expect(distinct(seen)).toEqual(['connecting', 'connected', 'reconnecting']);
    expect(canEdit(distinct(seen)[distinct(seen).length - 1] as ConnectionState)).toBe(true);
  });

  it('takes a close code that is somebody else\'s answer the same way', () => {
    // 1003 is the room saying "that was not a change". It is about one message, not about
    // the board; the badge says nothing about it and the board stays editable.
    const { provider, seen } = workingBoard();
    act(() => provider.emitClose(1003));
    expect(distinct(seen)).toEqual(['connecting', 'connected', 'reconnecting']);
    expect(badge().getAttribute('data-state')).toBe('reconnecting');
  });

  it('ends itself the moment the board arrives, without a reload', () => {
    const provider = new FakeProvider();
    const seen: ConnectionState[] = [];
    render(<Harness provider={provider} onState={(state) => seen.push(state)} />);
    act(() => provider.emitClose(CLOSE_BOARD_LOAD_FAILED));
    expect(screen.getByTestId('connection-status')).not.toBeNull();

    // The room found the board and sent it. There is no second half to this: nobody reloads
    // the page, nobody presses anything, and the wait for a connection to *hold* does not
    // apply to news as good as the board being in your hands.
    act(() => provider.emitSync(true));
    expect(distinct(seen)).toEqual(['connecting', 'load_failed', 'connected']);
    expect(screen.queryByTestId('connection-status')).toBeNull();
    expect(canEdit('connected')).toBe(true);
    expect(provider.destroyed).toBe(false);
    expect(provider.listening).toBe(true);
  });

  it('does not mistake a load failure for a reconnection the other way round either', () => {
    // A board that never worked and gets refused: it stays on the load failure rather than
    // claiming a reconnection that never happened, and it never says "Connecting…" again
    // under somebody's fingers.
    const provider = new FakeProvider();
    const seen: ConnectionState[] = [];
    render(<Harness provider={provider} onState={(state) => seen.push(state)} />);
    act(() => provider.emitClose(CLOSE_BOARD_LOAD_FAILED));
    act(() => provider.emitStatus('connected'));
    expect(distinct(seen), 'the socket being open is not the board being readable').toEqual([
      'connecting',
      'load_failed',
    ]);
  });
});
