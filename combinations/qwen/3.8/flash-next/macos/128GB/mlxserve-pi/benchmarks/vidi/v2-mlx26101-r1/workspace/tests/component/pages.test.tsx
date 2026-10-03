// share.create / share.board_api / share.not_found at the page level (TC-16, TC-17,
// TC-19, TC-20, TC-21). The whole React tree is real — the router, the pages,
// the board — and only the two HTTP calls are scripted, because in this project there
// is no server to talk to. The socket stays the component stub, so "a bad link never
// opens a socket" is asserted by looking at which providers were constructed.
//
// TC-21 uses fake timers on purpose: the retry sequence is 1000ms, 2000ms, 4000ms and
// must not fire a millisecond early, so the assertions are made at those exact marks.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../../src/client/App';
import { routeFromPathname } from '../../src/client/router';
import { CREATE_BUDGET_MS, RECONNECT_MAX_BACKOFF_MS } from '../../src/shared/config';
import { TEST_BOARD_ID } from './helpers';
import { created, resetProviderStub } from './y-websocket-stub';

/** A scripted HTTP answer. Throwing from a script simulates a network failure. */
type Reply = { status: number; body?: unknown };
type Script = (url: string, init?: RequestInit) => Reply | Promise<Reply>;

/** Another board's link, validly formed, that the scripts answer 404 for. */
const MISSING_BOARD = 'zzzzzzzzzzzzzzzzzzzzzz';

/** A validly formed link that nothing has created. */
const OTHER_BOARD = 'another000000000000000';

/** Install a fake `fetch`; returns the URLs it was called with, in order. */
function stubFetch(script: Script): string[] {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      const { status, body } = await script(url, init);
      return new Response(JSON.stringify(body ?? {}), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return calls;
}

/** The existence checks among the recorded calls. */
function checks(calls: string[]): string[] {
  return calls.filter((url) => url.startsWith('/api/boards/'));
}

function goTo(path: string): void {
  window.history.replaceState(null, '', path);
}

beforeEach(() => {
  resetProviderStub();
  goTo('/');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('the router maps an address to exactly one page', () => {
  it('sees / as home, /b/<link> as that board, and everything else as not found', () => {
    expect(routeFromPathname('/')).toEqual({ name: 'home' });
    expect(routeFromPathname(`/b/${TEST_BOARD_ID}`)).toEqual({
      name: 'board',
      id: TEST_BOARD_ID,
    });
    // Not a link, so not a board: `/b/abc` is answered here rather than being asked
    // about, which is why a paste with a bit missing gets the same page as `/nope`.
    expect(routeFromPathname('/b/abc')).toEqual({ name: 'not_found' });
    expect(routeFromPathname('/b/abc/extra')).toEqual({ name: 'not_found' });
    expect(routeFromPathname('/b/')).toEqual({ name: 'not_found' });
    expect(routeFromPathname('/b')).toEqual({ name: 'not_found' });
    expect(routeFromPathname('/anything/else')).toEqual({ name: 'not_found' });
  });
});

describe('home page (share.create)', () => {
  it('TC-16: one click creates one board and the address bar becomes its link', async () => {
    const started = Date.now();
    let answerCreate: ((reply: Reply) => void) | undefined;
    const calls = stubFetch((url, init) => {
      if (url === '/api/boards' && init?.method === 'POST') {
        // Held open so the in-flight state can be observed.
        return new Promise<Reply>((resolve) => {
          answerCreate = resolve;
        });
      }
      return { status: 200 };
    });

    render(<App />);

    // It is the product, in words, and there is one way forward.
    expect(screen.getByTestId('home-page')).toBeTruthy();
    expect(screen.getByText('vidi6')).toBeTruthy();
    expect(screen.getByTestId('new-board')).toBeTruthy();
    // ...and nothing of a board yet: no surface, no connection, no Share button.
    expect(screen.queryByTestId('board-viewport')).toBeNull();
    expect(screen.queryByTestId('share-open')).toBeNull();
    expect(created).toHaveLength(0);
    expect(calls).toHaveLength(0);

    fireEvent.click(screen.getByTestId('new-board'));

    // In flight: disabled, and saying what it is doing, so a second click cannot
    // make a second board.
    const button = screen.getByTestId<HTMLButtonElement>('new-board');
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe('Creating\u2026');
    expect(calls.filter((url) => url === '/api/boards')).toHaveLength(1);

    await act(async () => {
      answerCreate?.({ status: 201, body: { id: TEST_BOARD_ID } });
    });

    // The board is on screen under the link that was just created — well inside the
    // budget a person is willing to wait for a click to mean something.
    await waitFor(() => expect(screen.getByTestId('board-viewport')).toBeTruthy());
    expect(window.location.pathname).toBe(`/b/${TEST_BOARD_ID}`);
    expect(Date.now() - started).toBeLessThan(CREATE_BUDGET_MS);
    // Exactly one board was asked for: the button being disabled worked.
    expect(calls.filter((url) => url === '/api/boards')).toHaveLength(1);
    expect(screen.getByTestId('share-open')).toBeTruthy();
  });

  // The PRD gives one message for both ways a create can fail, so both are run: the
  // service answering `create_failed`, and the request never getting an answer at all.
  it.each([
    ['a 500 create_failed', () => ({ status: 500, body: { error: 'create_failed' } })],
    ['a network failure', () => { throw new TypeError('Failed to fetch'); }],
  ])(
    'TC-17: a create that fails with %s says so under the button and leaves the page alone',
    async (_name, whenFailing) => {
      let failing = true;
      const calls = stubFetch((url, init) => {
        if (url === '/api/boards' && init?.method === 'POST') {
          if (failing) return whenFailing();
          return { status: 201, body: { id: TEST_BOARD_ID } };
        }
        return { status: 200 };
      });

      render(<App />);
      fireEvent.click(screen.getByTestId('new-board'));

      // An honest sentence, the home page still there, nothing created at all.
      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toBe("Couldn't create a board. Please try again.");
      expect(screen.queryByTestId('board-viewport')).toBeNull();
      expect(window.location.pathname).toBe('/');
      expect(created).toHaveLength(0);

      // The way out is the same button, not a reload: the PRD's "available again".
      failing = false;
      fireEvent.click(screen.getByTestId('new-board'));
      await waitFor(() => expect(screen.getByTestId('board-viewport')).toBeTruthy());
      expect(screen.queryByRole('alert')).toBeNull();
      expect(window.location.pathname).toBe(`/b/${TEST_BOARD_ID}`);
      expect(calls.filter((url) => url === '/api/boards')).toHaveLength(2);
    },
  );

  it('"Board not found" offers the same New board button and lands on the new link', async () => {
    goTo(`/b/${MISSING_BOARD}`);
    const calls = stubFetch((url) => {
      if (url === '/api/boards') return { status: 201, body: { id: OTHER_BOARD } };
      // The new board exists (it was just created); the one in the address bar did not.
      if (url === `/api/boards/${OTHER_BOARD}`) return { status: 200 };
      return { status: 404, body: { error: 'not_found' } };
    });

    render(<App />);
    expect(await screen.findByText('Board not found')).toBeTruthy();
    // It was asked once, about this link only, and the answer was no.
    expect(checks(calls)).toEqual([`/api/boards/${MISSING_BOARD}`]);

    fireEvent.click(screen.getByTestId('new-board'));
    await waitFor(() => expect(screen.getByTestId('board-viewport')).toBeTruthy());
    expect(window.location.pathname).toBe(`/b/${OTHER_BOARD}`);
  });
});

describe('board page (share.not_found)', () => {
  it('TC-19: an address that is not a board link is not found without asking', async () => {
    // A mistyped, truncated or invented link: `/b/bad` cannot be a board, and the
    // service is never consulted about it (TC-07 at the page level).
    goTo('/b/bad');
    const calls = stubFetch(() => ({ status: 200 }));

    render(<App />);

    expect(await screen.findByText('Board not found')).toBeTruthy();
    expect(screen.getByTestId('not-found-page')).toBeTruthy();
    expect(screen.queryByTestId('board-viewport')).toBeNull();
    expect(calls).toHaveLength(0);
    expect(created).toHaveLength(0);

    // The same answer for a path this app has never heard of.
    goTo('/anything/else');
    cleanup();
    render(<App />);
    expect(await screen.findByText('Board not found')).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it('TC-20: a link that was never created shows "Opening board…" then "Board not found"', async () => {
    goTo(`/b/${MISSING_BOARD}`);
    const calls = stubFetch(() => ({ status: 404, body: { error: 'not_found' } }));

    render(<App />);

    // Asking first: the loading state the PRD names, and no board behind it.
    expect(screen.getByTestId('board-checking')).toBeTruthy();
    expect(screen.getByText('Opening board\u2026')).toBeTruthy();

    expect(await screen.findByText('Board not found')).toBeTruthy();
    expect(screen.getByText(/Check the link/i)).toBeTruthy();
    // The way forward the PRD asks for: a New board button, and nothing else.
    expect(screen.getByTestId('new-board')).toBeTruthy();
    expect(screen.queryByTestId('board-viewport')).toBeNull();
    expect(screen.queryByTestId('share-open')).toBeNull();
    // The point of the check: a bad link never opens a connection or writes storage.
    expect(created).toHaveLength(0);
    expect(checks(calls)).toEqual([`/api/boards/${MISSING_BOARD}`]);
  });

  it('TC-21: an unreachable board says "Couldn\'t reach vidi6. Retrying\u2026", never "not found", and backs off 1s/2s/4s', async () => {
    vi.useFakeTimers();
    let down = true;
    const calls = stubFetch(() => {
      if (down) throw new TypeError('Failed to fetch');
      return { status: 200 };
    });
    goTo(`/b/${TEST_BOARD_ID}`);

    const settle = async (ms: number) => {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });
    };

    render(<App />);
    await settle(0);

    expect(screen.getByTestId('board-unreachable')).toBeTruthy();
    expect(screen.getByText("Couldn't reach vidi6. Retrying\u2026")).toBeTruthy();
    // The two answers that must never be shown for something we could not ask about.
    expect(screen.queryByText('Board not found')).toBeNull();
    expect(screen.queryByTestId('board-viewport')).toBeNull();
    expect(checks(calls)).toHaveLength(1);

    // Exactly on the marks, never early: 1000ms, then 2000ms, then 4000ms.
    await settle(999);
    expect(checks(calls)).toHaveLength(1);
    await settle(1);
    expect(checks(calls)).toHaveLength(2);
    await settle(1999);
    expect(checks(calls)).toHaveLength(2);
    await settle(1);
    expect(checks(calls)).toHaveLength(3);
    await settle(3999);
    expect(checks(calls)).toHaveLength(3);
    await settle(1);
    expect(checks(calls)).toHaveLength(4);
    expect(screen.queryByText('Board not found')).toBeNull();

    // A definitive answer ends the sequence, however many tries it took — and the
    // backoff is capped, so the asks never fall further behind than the cap.
    down = false;
    await settle(RECONNECT_MAX_BACKOFF_MS);
    // The service came back, so this link is a board after all — on screen, no
    // not-found page, and the asking has stopped.
    expect(screen.getByTestId('board-viewport')).toBeTruthy();
    expect(screen.queryByTestId('board-unreachable')).toBeNull();
    expect(screen.queryByText('Board not found')).toBeNull();
    const after = checks(calls).length;
    await settle(30_000);
    expect(checks(calls)).toHaveLength(after);
  });

  it('mounts the board only once the link has been answered, and says so while asking', async () => {
    let answer: ((reply: Reply) => void) | undefined;
    stubFetch((url) =>
      checks([url]).length > 0
        ? new Promise<Reply>((resolve) => {
            answer = resolve;
          })
        : { status: 200 },
    );
    goTo(`/b/${TEST_BOARD_ID}`);

    render(<App />);

    // Asking: a status line, and no board, no socket.
    expect(screen.getByTestId('board-checking')).toBeTruthy();
    expect(screen.getByText('Opening board\u2026')).toBeTruthy();
    expect(screen.queryByTestId('board-viewport')).toBeNull();
    expect(created).toHaveLength(0);

    await act(async () => {
      answer?.({ status: 200 });
    });
    await waitFor(() => expect(screen.getByTestId('board-viewport')).toBeTruthy());
    expect(screen.queryByTestId('board-checking')).toBeNull();
    expect(created).toHaveLength(1);
    // The connection is named after the link in the address bar.
    expect(created[0].roomname).toBe(TEST_BOARD_ID);
  });
});
