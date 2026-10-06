/**
 * Component tests for the pages (design `share.pages`: TC-16, TC-17, TC-19, TC-20, TC-21).
 *
 * `api.ts` is mocked here and little else is: the pages are being tested for what they do
 * with an answer, including the answers that only a broken service gives, and the only way
 * to test a page that is waiting for a server is to be a server that answers late. The
 * board underneath the pages is faked with the story 3/4 `FakeLink` too, because a component
 * test that opened a real socket would be testing the network.
 *
 * Fake timers, on purpose: the retry backoff is the one clock this story adds to the board
 * page, and a test that waited for it in real time would take seconds and still be flakier
 * than one that turns it. `requestAnimationFrame` is deliberately *not* faked - the frame
 * queue in `setup.ts` is what paints the board, and a faked rAF would leave it unpainted.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../../src/client/App.js';
import type { BoardsApi, CheckResponse, CreateResponse } from '../../src/client/api.js';
import type { BoardConnector } from '../../src/client/board/useBoardDoc.js';
import { connectBoard } from '../../src/client/sync/connectBoard.js';
import {
  CREATE_FAILED_MESSAGE,
  NOT_FOUND_HEADING,
  OPENING_BOARD_MESSAGE,
  UNREACHABLE_MESSAGE,
  initialBoardPageState,
  nextBoardPageState,
  nextHomePageState,
  retryDelayMs,
} from '../../src/client/pages/state.js';
import { HOME_PATH, boardPath, routeOf } from '../../src/client/router.js';
import { newBoardId } from '../../src/shared/board-id.js';
import { BOARD_CHECK_RETRY_BASE_MS, RECONNECT_MAX_BACKOFF_MS } from '../../src/shared/config.js';
import { FakeLink } from './fake-link.js';
import { drainFrames } from './setup.js';

/** The clocks these pages use. `requestAnimationFrame` is left alone, because the frame queue is faked by the suite setup (see setup.ts). */
const pageTimers: Parameters<(typeof vi)['useFakeTimers']>[0] = {
  toFake: ['setTimeout', 'clearTimeout', 'Date'],
};

/** Put the address bar at a path without pushing history. */
const at = (path: string): void => {
  window.history.replaceState(null, '', path);
};

const bodyText = (): string => document.body.textContent ?? '';

/** The text of an element, with the markup stripped. */
const textOf = (testId: string): string => screen.getByTestId(testId).textContent ?? '';

/** An API whose answers the test chooses. Nothing about it is real but the shape. */
function fakeApi(): BoardsApi {
  return {
    create: vi.fn<() => Promise<CreateResponse>>(() => Promise.resolve({ kind: 'failed' })),
    check: vi.fn<(id: string) => Promise<CheckResponse>>(() => Promise.resolve({ kind: 'not_found' })),
  };
}

const apiOf = (api: BoardsApi): { create: ReturnType<typeof vi.fn>; check: ReturnType<typeof vi.fn> } =>
  api as unknown as { create: ReturnType<typeof vi.fn>; check: ReturnType<typeof vi.fn> };

interface Harness {
  api: BoardsApi;
  link: FakeLink;
  /** The board connector, and the count of the boards it was asked to open. */
  connect: ReturnType<typeof vi.fn<BoardConnector>>;
}

/**
 * The app's two seams, both fake: an API that says what the test says, and a real connector
 * over a fake room link, spied on so a test can see whether a socket was asked for at all.
 * That last question is the interesting one on this page: a board that is not there must
 * never be connected to, and "the board is not in the DOM" is not proof of it.
 */
function harness(): Harness {
  const link = new FakeLink();
  const connect = vi.fn((...args: Parameters<BoardConnector>) =>
    connectBoard(...args, { createLink: () => link }),
  );
  return { api: fakeApi(), link, connect };
}

/**
 * Render the app at a path, as the browser would: the address bar first, then the
 * component, then the frame the board needs in order to paint.
 */
function renderAt(h: Harness, path: string): void {
  cleanup();
  at(path);
  act(() => {
    render(<App api={h.api} connect={h.connect} />);
    drainFrames();
  });
}

/**
 * Let the timers that are due run, and the promises they settle land in the DOM.
 *
 * The clock moves by `ms` and no further, so a test that is checking "nothing at 999 ms,
 * the check at 1 s" is really checking that.
 */
async function settle(ms = 0): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
  act(() => drainFrames());
}

/**
 * Let a mount finish settling without moving the clock.
 *
 * A page that navigates mounts a page whose first question is asked on a `setTimeout(…, 0)`
 * that is only scheduled once the mount's effects have run - which is one round trip later
 * than the tick that caused the navigation. Two things waiting for the same zero, so a test
 * that has just been taken somewhere needs two turns of a clock that does not move.
 */
async function flush(): Promise<void> {
  for (let turn = 0; turn < 3; turn += 1) {
    await act(async () => {
      vi.advanceTimersByTime(0);
    });
  }
  act(() => drainFrames());
}

beforeEach(() => {
  vi.useFakeTimers(pageTimers);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  cleanup();
});

describe('home page: create a board (TC-16)', () => {
  it('shows Creating… and is disabled while the board is being made, then opens it', async () => {
    const h = harness();
    apiOf(h.api).check.mockResolvedValue({ kind: 'exists' });
    let created: ((value: CreateResponse) => void) | null = null;
    apiOf(h.api).create.mockImplementation(
      () =>
        new Promise<CreateResponse>((resolve) => {
          created = resolve;
        }),
    );
    const id = newBoardId();

    renderAt(h, HOME_PATH);
    const button = screen.getByTestId('new-board-button');
    expect(textOf('home-tagline')).toBe('A shared board for thinking together');

    fireEvent.click(button);

    // The wait is honest about waiting. A button that still says "New board" while a board
    // is on its way is a button that gets clicked again.
    expect(textOf('new-board-button')).toBe('Creating…');
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(h.connect).not.toHaveBeenCalled();

    await act(async () => {
      (created as unknown as (value: CreateResponse) => void)({ kind: 'created', id });
    });
    // The page has navigated, and the board page asks this link the same question it asks
    // every other one. The answer is what opens the board.
    await flush();

    // The address bar went to the board (pushState, so Back returns here) and the board is
    // what is on the screen.
    expect(window.location.pathname).toBe(boardPath(id));
    expect(screen.getByTestId('board-viewport')).toBeInTheDocument();
    expect(apiOf(h.api).create).toHaveBeenCalledTimes(1);
    // The board that opened is the one the server named: the connector was handed that
    // board id, and so the socket that is open is the new board's.
    expect(h.connect).toHaveBeenCalledWith(expect.anything(), id, expect.anything());
  });

  it('leaves the new board in history, so Back goes home', async () => {
    const h = harness();
    apiOf(h.api).check.mockResolvedValue({ kind: 'exists' });
    const id = newBoardId();
    apiOf(h.api).create.mockResolvedValue({ kind: 'created', id });

    renderAt(h, HOME_PATH);
    fireEvent.click(screen.getByTestId('new-board-button'));
    await flush();
    expect(window.location.pathname).toBe(boardPath(id));

    // What the browser's Back does: the address bar changes and `popstate` fires. jsdom
    // will not traverse history for a test, so the test does the two things a traversal
    // does, which is all the router can see.
    at(HOME_PATH);
    await act(async () => {
      window.dispatchEvent(new PopStateEvent('popstate'));
      drainFrames();
    });

    expect(screen.getByTestId('home-page')).toBeInTheDocument();
    expect(screen.queryByTestId('board-viewport')).toBeNull();
  });

  it('makes one board however many times the button is clicked', async () => {
    const h = harness();
    let created: ((value: CreateResponse) => void) | null = null;
    apiOf(h.api).create.mockImplementation(
      () =>
        new Promise<CreateResponse>((resolve) => {
          created = resolve;
        }),
    );

    renderAt(h, HOME_PATH);
    const button = screen.getByTestId('new-board-button');
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    expect(apiOf(h.api).create).toHaveBeenCalledTimes(1);
    await act(async () => {
      (created as unknown as (value: CreateResponse) => void)({ kind: 'created', id: newBoardId() });
    });
  });
});

describe('home page: creation fails (TC-17)', () => {
  it.each([
    // The two ways a creation can fail look different at the network and must look the
    // same on the screen: the service answered "no", and the service did not answer.
    ['the service said no', (api: BoardsApi) => apiOf(api).create.mockResolvedValue({ kind: 'failed' })],
    ['the network threw', (api: BoardsApi) => apiOf(api).create.mockRejectedValue(new TypeError('Failed to fetch'))],
  ])('%s: the message appears, the person stays home, the button comes back', async (_name, fail) => {
    const h = harness();
    fail(h.api);

    renderAt(h, HOME_PATH);
    fireEvent.click(screen.getByTestId('new-board-button'));
    await settle();

    expect(textOf('home-message')).toBe(CREATE_FAILED_MESSAGE);
    expect(bodyText()).toContain(CREATE_FAILED_MESSAGE);
    // Nobody went anywhere, and nothing was connected to.
    expect(window.location.pathname).toBe(HOME_PATH);
    expect(h.connect).not.toHaveBeenCalled();

    const button = screen.getByTestId('new-board-button');
    expect(button.hasAttribute('disabled')).toBe(false);
    expect(textOf('new-board-button')).toBe('New board');
    expect(apiOf(h.api).create).toHaveBeenCalledTimes(1);
  });

  it('tries again when asked, and opens the board that finally arrives', async () => {
    const h = harness();
    const id = newBoardId();
    apiOf(h.api).check.mockResolvedValue({ kind: 'exists' });
    apiOf(h.api).create.mockResolvedValueOnce({ kind: 'failed' }).mockResolvedValue({ kind: 'created', id });

    renderAt(h, HOME_PATH);
    fireEvent.click(screen.getByTestId('new-board-button'));
    await settle();
    expect(textOf('home-message')).toBe(CREATE_FAILED_MESSAGE);

    fireEvent.click(screen.getByTestId('new-board-button'));
    await flush();

    // The failure message left with the home page, which is the point: the person is not
    // looking at a apology any more, they are looking at the board.
    expect(window.location.pathname).toBe(boardPath(id));
    expect(screen.queryByTestId('home-page')).toBeNull();
    expect(screen.getByTestId('board-viewport')).toBeInTheDocument();
  });

  it('says nothing about a press nobody is waiting on any more', () => {
    expect(nextHomePageState({ kind: 'creating' }, { kind: 'failed' })).toEqual({
      kind: 'create_failed',
      message: CREATE_FAILED_MESSAGE,
    });
    expect(nextHomePageState({ kind: 'idle' }, { kind: 'failed' })).toEqual({ kind: 'idle' });
    expect(nextHomePageState({ kind: 'create_failed', message: CREATE_FAILED_MESSAGE }, { kind: 'failed' })).toEqual({
      kind: 'create_failed',
      message: CREATE_FAILED_MESSAGE,
    });
    // A created board is not a state to render: the page has gone somewhere else by then.
    expect(nextHomePageState({ kind: 'creating' }, { kind: 'created', id: 'x' })).toEqual({ kind: 'idle' });
  });
});

describe('board page: a link that cannot name a board (TC-19)', () => {
  it.each(['/b/bad', `/b/${'a'.repeat(21)}`, '/b/', '/boards', '/anything/else'])(
    'shows Board not found for %s without asking the service anything',
    (path) => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      const h = harness();

      renderAt(h, path);

      expect(screen.getByTestId('not-found-page')).toBeInTheDocument();
      expect(bodyText()).toContain(NOT_FOUND_HEADING);
      // Nothing was asked: not the API, and not the network. A malformed link is not a
      // question worth sending, and an unknown board is answered once.
      expect(apiOf(h.api).check).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(h.connect).not.toHaveBeenCalled();
    },
  );

  it('knows the addresses apart without asking anyone', () => {
    const id = newBoardId();
    expect(routeOf(HOME_PATH)).toEqual({ name: 'home' });
    expect(routeOf(boardPath(id))).toEqual({ name: 'board', id });
    expect(routeOf('/b/bad')).toEqual({ name: 'not_found' });
    expect(routeOf('/b/' + id + '/')).toEqual({ name: 'board', id });
    expect(routeOf('/')).not.toEqual({ name: 'board' });
  });
});

describe('board page: a link to a board that is not there (TC-20)', () => {
  it('opens with "Opening board…" and lands on Board not found, with a New board button', async () => {
    const h = harness();

    renderAt(h, boardPath(newBoardId()));

    // The first paint is the wait and not a blank board: the person can see the link is
    // being looked at, rather than wondering whether the page has finished.
    expect(textOf('board-opening-message')).toBe(OPENING_BOARD_MESSAGE);
    expect(h.connect).not.toHaveBeenCalled();

    await settle();

    expect(screen.getByTestId('not-found-page')).toBeInTheDocument();
    expect(screen.getByTestId('new-board-button')).toBeInTheDocument();
    expect(screen.queryByTestId('board-viewport')).toBeNull();

    // And it stopped asking. A not-found page that kept retrying is a machine for turning
    // typos into questions, and the answer was never going to change.
    const asked = apiOf(h.api).check.mock.calls.length;
    await settle(RECONNECT_MAX_BACKOFF_MS * 3);
    expect(apiOf(h.api).check).toHaveBeenCalledTimes(asked);
  });

  it('never opens a socket for a board that is not there', async () => {
    const h = harness();
    renderAt(h, boardPath(newBoardId()));
    await settle();

    // The room would have answered 404, and the badge would have been complaining about
    // the connection where the person needs to read a sentence about the link.
    expect(h.connect).not.toHaveBeenCalled();
    expect(h.link.emitted).toHaveLength(0);
  });

  it('offers a board, and only the button makes one', async () => {
    const h = harness();
    const missing = newBoardId();
    const id = newBoardId();
    // One board is there and one is not: the same service answering both links.
    apiOf(h.api).check.mockImplementation((asked: string) =>
      Promise.resolve(asked === missing ? { kind: 'not_found' } : { kind: 'exists' }),
    );
    apiOf(h.api).create.mockResolvedValue({ kind: 'created', id });

    renderAt(h, boardPath(missing));
    await settle();

    expect(apiOf(h.api).create).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('new-board-button'));
    await flush();

    expect(apiOf(h.api).create).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe(boardPath(id));
    expect(screen.getByTestId('board-viewport')).toBeInTheDocument();
  });

  it('gives the Board not found page a way back to the home page', async () => {
    const h = harness();
    renderAt(h, boardPath(newBoardId()));
    await settle();

    fireEvent.click(screen.getByTestId('home-link'));
    await settle();

    expect(window.location.pathname).toBe(HOME_PATH);
    expect(screen.getByTestId('home-page')).toBeInTheDocument();
  });
});

describe('board page: a service that cannot be reached (TC-21)', () => {
  it('retries on its own, with a growing wait, and opens the board when the service returns', async () => {
    const h = harness();
    const id = newBoardId();
    apiOf(h.api).check
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue({ kind: 'exists' });

    renderAt(h, boardPath(id));

    // The first failure: the page says what is wrong instead of going quiet.
    await settle();
    expect(textOf('board-opening-message')).toBe(UNREACHABLE_MESSAGE);
    expect(apiOf(h.api).check).toHaveBeenCalledTimes(1);

    // Nothing at the end of the first wait but the wait itself, then the second question.
    await settle(BOARD_CHECK_RETRY_BASE_MS - 1);
    expect(apiOf(h.api).check).toHaveBeenCalledTimes(1);
    await settle(1);
    expect(apiOf(h.api).check).toHaveBeenCalledTimes(2);

    // The second wait is twice the first; the message does not change.
    await settle(BOARD_CHECK_RETRY_BASE_MS * 2 - 1);
    expect(apiOf(h.api).check).toHaveBeenCalledTimes(2);
    expect(textOf('board-opening-message')).toBe(UNREACHABLE_MESSAGE);
    await settle(1);
    expect(apiOf(h.api).check).toHaveBeenCalledTimes(3);

    // The board opens by itself. Nobody reloaded anything.
    expect(screen.getByTestId('board-viewport')).toBeInTheDocument();
    expect(screen.queryByTestId('board-opening')).toBeNull();
    expect(h.connect).toHaveBeenCalledWith(expect.anything(), id, expect.anything());
  });

  it('shows Board not found when the service comes back to say the board is not there', async () => {
    const h = harness();
    apiOf(h.api).check
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue({ kind: 'not_found' });

    renderAt(h, boardPath(newBoardId()));
    await settle();
    expect(textOf('board-opening-message')).toBe(UNREACHABLE_MESSAGE);

    await settle(BOARD_CHECK_RETRY_BASE_MS);
    expect(screen.getByTestId('not-found-page')).toBeInTheDocument();
  });

  it('waits 1 s, 2 s, 4 s, 8 s and then never longer than the socket does', async () => {
    const h = harness();
    apiOf(h.api).check.mockRejectedValue(new TypeError('Failed to fetch'));

    renderAt(h, boardPath(newBoardId()));
    await settle();
    expect(apiOf(h.api).check).toHaveBeenCalledTimes(1);

    // One ceiling for the whole app: the socket's. A page that retried faster than the
    // socket would be two ideas about how to behave when a service is down.
    const intervals = [1_000, 2_000, 4_000, 8_000];
    intervals.forEach((interval, index) => {
      expect(retryDelayMs(index + 1)).toBe(interval);
    });

    let asked = 1;
    for (const interval of intervals) {
      await settle(interval - 1);
      expect(apiOf(h.api).check).toHaveBeenCalledTimes(asked);
      await settle(1);
      asked += 1;
      expect(apiOf(h.api).check).toHaveBeenCalledTimes(asked);
    }

    // Past the ceiling it holds, rather than either stopping or hammering.
    expect(retryDelayMs(5)).toBe(RECONNECT_MAX_BACKOFF_MS);
    expect(retryDelayMs(40)).toBe(RECONNECT_MAX_BACKOFF_MS);

    const held = apiOf(h.api).check.mock.calls.length;
    await settle(RECONNECT_MAX_BACKOFF_MS - 1);
    expect(apiOf(h.api).check).toHaveBeenCalledTimes(held);
    await settle(1);
    expect(apiOf(h.api).check).toHaveBeenCalledTimes(held + 1);

    // Still waiting, still saying so.
    expect(textOf('board-opening-message')).toBe(UNREACHABLE_MESSAGE);
  });

  it('stops the moment the page goes away, and asks again for the next board opened', async () => {
    const h = harness();
    apiOf(h.api).check.mockRejectedValue(new TypeError('Failed to fetch'));

    renderAt(h, boardPath(newBoardId()));
    await settle();
    expect(apiOf(h.api).check).toHaveBeenCalledTimes(1);

    // The timer belongs to the page. One that outlived it would keep a service that is down
    // being asked about a board nobody is looking at any more.
    cleanup();
    await settle(RECONNECT_MAX_BACKOFF_MS * 2);
    expect(apiOf(h.api).check).toHaveBeenCalledTimes(1);

    const second = newBoardId();
    renderAt(h, boardPath(second));
    await settle();
    expect(apiOf(h.api).check).toHaveBeenCalledTimes(2);
    expect(apiOf(h.api).check).toHaveBeenLastCalledWith(second);
  });

  it('treats exists, not found and no answer as three different answers, and the last two as final', () => {
    const id = newBoardId();
    const checking = initialBoardPageState();
    expect(nextBoardPageState(checking, { kind: 'exists' }, 1, id)).toEqual({ kind: 'ready', boardId: id });
    expect(nextBoardPageState(checking, { kind: 'not_found' }, 1, id)).toEqual({ kind: 'not_found' });
    expect(nextBoardPageState(checking, { kind: 'unreachable' }, 1, id)).toEqual({
      kind: 'unreachable',
      attempt: 1,
      nextRetryMs: BOARD_CHECK_RETRY_BASE_MS,
    });

    // Both endings are endings, whoever turns up next: an open board is not taken away by a
    // late answer, and a board that is not there is not resurrected by one.
    const ready = nextBoardPageState(checking, { kind: 'exists' }, 1, id);
    expect(nextBoardPageState(ready, { kind: 'unreachable' }, 2, id)).toBe(ready);
    const gone = nextBoardPageState(checking, { kind: 'not_found' }, 1, id);
    expect(nextBoardPageState(gone, { kind: 'exists' }, 2, id)).toBe(gone);

    // The wait grows by doubling and stops growing at the socket's ceiling.
    expect(nextBoardPageState(checking, { kind: 'unreachable' }, 3, id)).toEqual({
      kind: 'unreachable',
      attempt: 3,
      nextRetryMs: BOARD_CHECK_RETRY_BASE_MS * 4,
    });
    expect(nextBoardPageState(checking, { kind: 'unreachable' }, 9, id)).toEqual({
      kind: 'unreachable',
      attempt: 9,
      nextRetryMs: RECONNECT_MAX_BACKOFF_MS,
    });
  });
});

describe('the tab a board is open in', () => {
  it('says which board it is, and gives the title back when the board goes away', async () => {
    const h = harness();
    apiOf(h.api).check.mockResolvedValue({ kind: 'exists' });
    const id = newBoardId();
    const before = document.title;

    renderAt(h, boardPath(id));
    await settle();

    // Once boards have links they get shared, and once they are shared somebody has three of
    // them open. Three tabs reading "vidi6" is how a pasted link ends up in the wrong board,
    // which is the one mistake a tab title is there to prevent.
    expect(document.title).toBe(`Board ${id} - vidi6`);

    // The title came with the board and leaves with it: the page after - home, or not found -
    // is not left holding the name of a board that is no longer on the screen.
    cleanup();
    expect(document.title).toBe(before);
  });

  it('says nothing about a board the page never got to', async () => {
    const h = harness();
    const before = document.title;

    renderAt(h, boardPath(newBoardId()));
    await settle();
    expect(textOf('not-found-heading')).toBe('Board not found');
    expect(document.title).toBe(before);
  });
});
