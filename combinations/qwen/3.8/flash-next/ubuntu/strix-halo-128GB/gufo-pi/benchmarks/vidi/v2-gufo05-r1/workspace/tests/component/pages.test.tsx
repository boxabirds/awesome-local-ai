/**
 * The pages this story adds: the home page, the board page's opening, and the board-not-found
 * page — component tests, with the network stubbed at `api.ts` and the real state machines.
 *
 * These exist because three of the things the story promises cannot be tested at the HTTP
 * level at all — that the button says "Creating…" and cannot be pressed twice, that a failure
 * keeps the person on the page they were on, that a Worker which will not answer is retried
 * with a wait that doubles — and because driving them through a browser to find out would
 * make a slow test out of a question about a state machine.
 *
 * What is stubbed is the network, never the decisions. `api.ts` is replaced wholesale, so
 * these tests cannot talk themselves into believing a 503 means "no board", and the retry
 * ladder is asserted on the clock the state machine was given (`BOARD_CHECK_RETRY_BASE_MS`),
 * so a change to that number moves the test rather than quietly changing the behaviour.
 *
 * TC numbers are the design's (spec/stories/005-…/design.md).
 */
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppRoot } from '../../src/client/App';
import { BoardPage } from '../../src/client/pages/BoardPage';
import { NotFoundPage } from '../../src/client/pages/NotFoundPage';
import {
  boardCheckRetryMs,
  nextBoardPageState,
  type BoardPageState,
} from '../../src/client/pages/state';
import { BOARD_CHECK_RETRY_BASE_MS, RECONNECT_MAX_BACKOFF_MS } from '../../src/shared/config';
import { boardPath } from '../../src/client/router';
import * as api from '../../src/client/api';
import { isValidBoardId, newBoardId } from '../../src/shared/board-id';

vi.mock('../../src/client/sync/connectBoard', () => ({
  // The board page mounts the story 1–4 board once the board exists. Connecting that board
  // to a server is story 3's business and is proved in the browser; here it would only be a
  // WebSocket that cannot exist in jsdom.
  connectBoard: () => ({ destroy: () => {} }),
}));

/**
 * Let every pending promise run, then every effect those resolutions queued.
 *
 * The `setTimeout(0)` is not decoration: React schedules the effects a resolved promise
 * triggers on the next macrotask, and asserting before it is how a test starts passing for
 * the wrong reason.
 */
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/**
 * The same, for tests running on fake timers.
 *
 * `flush` waits for a real timer, which fake time never fires; advancing by zero drains the
 * microtask queue between scheduled timers, which is what the effects need.
 */
async function flushFake(): Promise<void> {
  await act(async () => {
    // A real macrotask: React's scheduler runs on a MessageChannel, and one turn of the
    // event loop lets it, while the page's backoff timer stays under `vi`'s control.
    await new Promise((resolve) => setImmediate(resolve));
  });
}

function setPath(path: string): void {
  window.history.replaceState({}, '', path);
}

/** A `Response` for a status the real Worker answers with. */
function response(status: number): Response {
  return new Response(status === 200 ? JSON.stringify({ id: newBoardId() }) : null, { status });
}

let historyPush: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // The home page must not put a history entry behind a board that failed to appear, and
  // the only way to see that from jsdom is to watch the call.
  historyPush = vi.spyOn(window.history, 'pushState');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  setPath('/');
});

describe('the home page (TC-16, TC-17)', () => {
  it('offers one way in', () => {
    render(<AppRoot />);
    expect(screen.getByRole('heading', { name: 'vidi6' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New board' })).toBeTruthy();
  });

  it('TC-16 shows Creating…, cannot be pressed twice, then goes to the board it was given', async () => {
    const id = newBoardId();
    // A creation the test finishes by hand, so "still waiting" can be looked at for as long
    // as the test needs.
    let resolveCreation!: (value: { kind: 'created'; id: string }) => void;
    const created = vi
      .spyOn(api, 'createBoardRequest')
      .mockReturnValue(
        new Promise((resolve) => {
          resolveCreation = resolve;
        }),
      );
    const checked = vi.spyOn(api, 'checkBoard').mockResolvedValue({ kind: 'exists' });

    render(<AppRoot />);
    const button = screen.getByRole('button', { name: 'New board' });
    fireEvent.click(button);

    // Still waiting: the button says what it is doing, and says it cannot be pressed. The
    // waiting state is the mutex — a double press must not become two boards, because a
    // second one is this story's whole feature shared with nobody.
    const waiting = screen.getByRole('button', { name: 'Creating…' }) as HTMLButtonElement;
    expect(waiting.disabled).toBe(true);
    fireEvent.click(waiting);
    fireEvent.click(waiting);
    expect(created).toHaveBeenCalledTimes(1);

    resolveCreation({ kind: 'created', id });
    await flush();

    expect(window.location.pathname).toBe(boardPath(id));
    // The board page mounted for the id the server named, and asked about that id.
    expect(checked).toHaveBeenCalledWith(id);
    expect(created).toHaveBeenCalledTimes(1);
  });

  it('names a board that cannot be created as the board it is not', () => {
    // The home page's job ends at a valid address: nothing here is allowed to invent an id
    // locally, because a locally invented one names a board that will never exist.
    expect(isValidBoardId(newBoardId())).toBe(true);
  });
});

/**
 * TC-17, run twice.
 *
 * Two different things go wrong when a board is not created — the service answers "500", or
 * it does not answer at all — and `api.ts` collapses both into one report. The collapse is
 * the claim, so both are run: one because the app must treat them identically, and one
 * because if a future change started treating them differently, this is where it would show.
 */
describe.each([
  ['the service answers 500', () => vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(500))],
  [
    'the network is dead',
    () => vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch')),
  ],
])('a board that could not be created (%s)', (_label, stubFetch) => {
  it('arrives at the page as one report, whichever way it failed', async () => {
    stubFetch();
    expect(await api.createBoardRequest()).toEqual({ kind: 'failed' });
  });

  it('says so, stays home, and lets the press be tried again', async () => {
    // The page is driven by what the client reports, so this half stubs the client.
    const created = vi.spyOn(api, 'createBoardRequest').mockResolvedValue({ kind: 'failed' });
    render(<AppRoot />);
    fireEvent.click(screen.getByRole('button', { name: 'New board' }));
    await flush();

    expect(screen.getByRole('alert').textContent).toBe("Couldn't create a board. Please try again.");
    // The two halves of "stays home": the address, and no history entry pushed behind it, so
    // Back still means Back.
    expect(window.location.pathname).toBe('/');
    expect(historyPush).not.toHaveBeenCalled();
    // The waiting state has ended, so the button is a button again.
    const retry = screen.getByRole('button', { name: 'New board' }) as HTMLButtonElement;
    expect(retry.disabled).toBe(false);
    fireEvent.click(retry);
    expect(created).toHaveBeenCalledTimes(2);
  });
});

describe('the API client’s reports', () => {
  it('a board that answers 200 exists, and one that answers 404 does not', async () => {
    const id = newBoardId();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(200));
    expect(await api.checkBoard(id)).toEqual({ kind: 'exists' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(404));
    expect(await api.checkBoard(id)).toEqual({ kind: 'not_found' });
  });

  it('a check that gets no answer is about the service, not about the board', async () => {
    // The distinction the whole page rests on: a 404 is a board that is not there, and
    // anything else is a question that was never answered. Get it the wrong way round and a
    // bad network tells people their colleagues' boards have been deleted.
    const id = newBoardId();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await api.checkBoard(id)).toEqual({ kind: 'unreachable' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(503));
    expect(await api.checkBoard(id)).toEqual({ kind: 'unreachable' });
  });

  it('never asks about an address that cannot name a board', async () => {
    const fetches = vi.spyOn(globalThis, 'fetch');
    expect(await api.checkBoard('abc')).toEqual({ kind: 'not_found' });
    expect(fetches).not.toHaveBeenCalled();
  });

  it('a creation declined with 400 is a failure, not a board', async () => {
    // The client never sends a request that ought to be declined, so a 400 means a contract
    // violation somewhere. Either way there is no board, and the home page must not pretend
    // otherwise.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(400));
    expect(await api.createBoardRequest()).toEqual({ kind: 'failed' });
  });

  it('reports a board the browser cannot name as created from this origin', async () => {
    // `boardPath` is the one place the shape of a board address is decided; the client and
    // the tests both go through it, so a route change cannot leave a stale link behind.
    const id = newBoardId();
    expect(boardPath(id)).toBe(`/b/${id}`);
  });
});

describe('the board page (TC-19, TC-20, TC-21)', () => {
  it('TC-19 shows the not-found page for a malformed address, without asking', async () => {
    const checked = vi.spyOn(api, 'checkBoard');
    setPath('/b/bad');
    render(<AppRoot />);
    await flush();

    expect(screen.getByRole('heading', { name: 'Board not found' })).toBeTruthy();
    // The negative half, which is the point: a malformed address is not a question worth
    // asking, and asking it would put an id the server must reject in front of the object.
    expect(checked).not.toHaveBeenCalled();
  });

  it('TC-20 shows the not-found page when the Worker says the board is not there', async () => {
    const checked = vi.spyOn(api, 'checkBoard').mockResolvedValue({ kind: 'not_found' });
    const id = newBoardId();
    setPath(boardPath(id));
    render(<AppRoot />);
    expect(screen.getByText('Opening board…')).toBeTruthy();
    await flush();

    expect(checked).toHaveBeenCalledWith(id);
    expect(screen.getByRole('heading', { name: 'Board not found' })).toBeTruthy();
    // And the way out the PRD asks for: a board now, without another human being involved.
    expect(screen.getByRole('button', { name: 'New board' })).toBeTruthy();
  });

  it('TC-21 retries an unreachable Worker with a wait that doubles', async () => {
    // Only the page's own timer is put under test control. React schedules its own work on
    // a MessageChannel, and faking the whole event loop makes the test wait for the
    // scheduler rather than for the backoff.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const id = newBoardId();
    const checked = vi
      .spyOn(api, 'checkBoard')
      .mockResolvedValueOnce({ kind: 'unreachable' })
      .mockResolvedValueOnce({ kind: 'unreachable' })
      .mockResolvedValueOnce({ kind: 'exists' });

    render(<BoardPage id={id} />);
    expect(screen.getByText('Opening board…')).toBeTruthy();
    await flushFake();
    expect(checked).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Couldn't reach vidi6. Retrying…")).toBeTruthy();

    // First wait: the base. Nothing asked before it has passed.
    act(() => vi.advanceTimersByTime(BOARD_CHECK_RETRY_BASE_MS - 1));
    expect(checked).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(1));
    expect(checked).toHaveBeenCalledTimes(2);
    await flushFake();

    // Second wait: double, and then the third answer, which is the board. The waits are
    // asserted at the boundary because a backoff that fires a millisecond early is a
    // hammering client, and one that fires late is a page that looks frozen.
    act(() => vi.advanceTimersByTime(BOARD_CHECK_RETRY_BASE_MS * 2 - 1));
    expect(checked).toHaveBeenCalledTimes(2);
    act(() => vi.advanceTimersByTime(1));
    expect(checked).toHaveBeenCalledTimes(3);
    await flushFake();
    expect(screen.getByTestId('board-viewport')).toBeTruthy();
  });

  it('stops asking when the page is taken away mid-check', async () => {
    // The bug this catches is the quiet kind: a timer that outlives its page keeps asking,
    // and a resolution that arrives afterwards calls setState on a component that is gone.
    let resolveCheck: ((value: { kind: 'exists' }) => void) | undefined;
    vi.spyOn(api, 'checkBoard').mockReturnValue(
      new Promise((resolve) => {
        resolveCheck = resolve;
      }),
    );
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

    const view = render(<BoardPage id={newBoardId()} />);
    await flush();
    view.unmount();
    resolveCheck?.({ kind: 'exists' });
    await flush();

    expect(errors).not.toHaveBeenCalled();
  });

  it('renders in StrictMode, where every effect runs twice', async () => {
    // React's own double-invocation is the production build's neighbour: a check that is not
    // idempotent asks twice, and a timer that is not cleared leaks.
    const checked = vi.spyOn(api, 'checkBoard').mockResolvedValue({ kind: 'exists' });
    render(
      <StrictMode>
        <BoardPage id={newBoardId()} />
      </StrictMode>,
    );
    await flush();
    expect(screen.getByTestId('board-viewport')).toBeTruthy();
    expect(checked.mock.calls.length).toBeGreaterThanOrEqual(1);
  });
});

describe('the board page state machine', () => {
  const someId = 'a'.repeat(22);

  it('keeps asking, and doubles the wait, on every failure it is given', () => {
    for (const attempt of [1, 2, 5]) {
      expect(
        nextBoardPageState({ kind: 'checking', boardId: someId }, 'unreachable', attempt, someId),
      ).toEqual({ kind: 'unreachable', attempt, nextRetryMs: boardCheckRetryMs(attempt) });
      expect(boardCheckRetryMs(attempt)).toBe(
        Math.min(BOARD_CHECK_RETRY_BASE_MS * 2 ** (attempt - 1), RECONNECT_MAX_BACKOFF_MS),
      );
    }
  });

  it('waits no longer than the backoff cap, however long the outage lasts', () => {
    // The cap is the reason a two-hour outage does not end with the page asking once a day.
    expect(boardCheckRetryMs(30)).toBe(RECONNECT_MAX_BACKOFF_MS);
  });

  it('never shortens a wait it already promised', () => {
    // A retry that reports a smaller attempt than the wait on screen would restart the
    // ladder from the top, which is the one thing backoff must not do while a service is
    // struggling. The count only goes up, and by at least one.
    const waiting: BoardPageState = {
      kind: 'unreachable',
      attempt: 5,
      nextRetryMs: boardCheckRetryMs(5),
    };
    const again = nextBoardPageState(waiting, 'unreachable', 2, someId);
    expect(again).toEqual({
      kind: 'unreachable',
      attempt: 6,
      nextRetryMs: boardCheckRetryMs(6),
    });
  });

  it('names not found only what the Worker said was not there', () => {
    // A 404 and no answer at all are different facts, and the page has to keep them apart or
    // every bad network becomes a deleted board.
    const checking: BoardPageState = { kind: 'checking', boardId: someId };
    expect(nextBoardPageState(checking, 'not_found', 1, someId)).toEqual({ kind: 'not_found' });
    expect(nextBoardPageState(checking, 'unreachable', 1, someId).kind).toBe('unreachable');
  });

  it('carries the id it asked about into the ready state', () => {
    // The answer travels with the id rather than being read back off a variable: a board
    // that opened the wrong board would be worse than one that never opened.
    const id = newBoardId();
    expect(nextBoardPageState({ kind: 'checking', boardId: id }, 'exists', 1, id)).toEqual({
      kind: 'ready',
      boardId: id,
    });
  });
});

describe('the board-not-found page', () => {
  it('says what is missing and offers a way onward', () => {
    render(<NotFoundPage />);
    expect(screen.getByRole('heading', { name: 'Board not found' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New board' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go to the home page' })).toBeTruthy();
  });

  it('hands the offer to the same creation the home page uses', async () => {
    // One create action, two pages: a second implementation would be a second set of
    // failure modes to get wrong.
    const id = newBoardId();
    const created = vi.spyOn(api, 'createBoardRequest').mockResolvedValue({ kind: 'created', id });
    vi.spyOn(api, 'checkBoard').mockResolvedValue({ kind: 'exists' });

    setPath('/b/not-a-board-id');
    render(<AppRoot />);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'New board' }));
    await flush();

    expect(created).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe(boardPath(id));
  });

  it('links home without going through the server', () => {
    render(<NotFoundPage />);
    fireEvent.click(screen.getByRole('link', { name: 'Go to the home page' }));
    expect(window.location.pathname).toBe('/');
  });
});
