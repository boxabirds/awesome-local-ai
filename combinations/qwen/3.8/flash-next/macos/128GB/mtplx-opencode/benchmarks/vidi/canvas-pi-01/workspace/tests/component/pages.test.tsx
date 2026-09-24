/**
 * Story 5 · component tests for navigation and the pages (contract TC-16 to
 * TC-21).
 *
 * These run the *real* `App` in jsdom with `fetch` stubbed, so what is under
 * test is the pair the story introduces: the router deciding which page a path
 * is, and `BoardPage` deciding whether an id is a board. The board chrome is
 * only ever asserted as "mounted or not" — its own behaviour belongs to the
 * stories 1–4 files.
 *
 * Two seams keep the tests honest and hermetic:
 *  - `connectBoard` is mocked, so a mounted board never opens a socket;
 *  - `fetch` is replaced with a recorded stub, so "no request for a malformed
 *    id" (TC-19) is an assertion on the recorded calls, not on a log line.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from '../../src/client/App';
import { BoardPage } from '../../src/client/pages/BoardPage';
import { navigate } from '../../src/client/router';
import { BOARD_CHECK_RETRY_BASE_MS } from '../../src/shared/config';
import type { CheckResponse } from '../../src/client/api';

/** A well-formed 22-character board id. */
const VALID_ID = 'AAAAAAAAAAAAAAAAAAAAAA';

/** The three page-level labels the tests look for. */
const HOME_TITLE = 'vidi6';
const NOT_FOUND_TITLE = 'Board not found';

/** Recorded fetch calls, so a test can prove a request was *not* made. */
let calls: string[];

function stubFetch(handler: (url: string, init?: RequestInit) => Promise<Response> | Response) {
  calls = [];
  const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String(input);
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    return handler(url, init);
  });
  vi.stubGlobal('fetch', fetchStub);
  return fetchStub;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Let queued promise callbacks and timers run. */
async function settle(times = 6): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

/** Put the address bar somewhere without going through the app. */
function goto(path: string): void {
  window.history.replaceState(null, '', path);
}

beforeEach(() => {
  vi.unstubAllGlobals();
  goto('/');
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// No socket in jsdom: a mounted board would otherwise try to reach a server.
vi.mock('../../src/client/sync/connectBoard', () => ({
  connectBoard: () => ({ destroy: () => undefined }),
}));

describe('router (TC-16)', () => {
  beforeEach(() => {
    stubFetch(() => jsonResponse({ id: VALID_ID }, 200));
  });

  it('renders home at `/`, a board at `/b/<id>`, and not-found anywhere else', async () => {
    goto('/');
    render(<App />);
    expect(await screen.findByTestId('home-page')).toBeTruthy();

    // An address change with no remount: the router subscription is what
    // re-renders, which is exactly what Back / Forward will do.
    goto(`/b/${VALID_ID}`);
    await act(async () => {
      navigate(window.location.pathname);
    });
    // The page swaps to the board as soon as the check answers, without a
    // remount: the same `App` tree re-renders off the router subscription.
    await waitFor(() => {
      expect(screen.getByTestId('board-root')).toBeTruthy();
    });
    expect(screen.queryByTestId('home-page')).toBeNull();
    expect(calls).toContain(`GET /api/boards/${VALID_ID}`);

    goto('/anything/else');
    await act(async () => {
      navigate(window.location.pathname);
    });
    expect(screen.getByTestId('not-found-page')).toBeTruthy();
    expect(screen.getByTestId('not-found-title').textContent).toBe(NOT_FOUND_TITLE);
  });

  it('navigates on a successful create and leaves the home page', async () => {
    stubFetch((_url, init) =>
      init?.method === 'POST' ? jsonResponse({ id: VALID_ID }, 201) : jsonResponse({}, 404),
    );
    goto('/');
    render(<App />);
    const button = await screen.findByTestId('create-board');
    await act(async () => {
      fireEvent.click(button);
      await settle();
    });
    expect(window.location.pathname).toBe(`/b/${VALID_ID}`);
    expect(screen.queryByTestId('home-page')).toBeNull();
  });
});

describe('home page (TC-17, TC-18)', () => {
  it('shows the product name, one line, and a working Create a board button', async () => {
    const fetchStub = stubFetch(() => jsonResponse({ id: VALID_ID }, 201));
    render(<App />);
    expect(screen.getByText(HOME_TITLE)).toBeTruthy();
    expect(screen.getByText('A shared board for thinking together')).toBeTruthy();

    const button = screen.getByTestId('create-board');
    await act(async () => {
      fireEvent.click(button);
      await settle();
    });
    // One POST for the create; the only other call is the new board's own
    // existence check, which is the board page doing its job.
    expect(calls.filter((call) => call === 'POST /api/boards')).toHaveLength(1);
    expect(fetchStub).toHaveBeenCalledTimes(2);
    expect(window.location.pathname).toBe(`/b/${VALID_ID}`);
  });

  it('keeps the button live and explains a 429', async () => {
    stubFetch(() => jsonResponse({ error: 'rate_limited' }, 429));
    render(<App />);
    const button = screen.getByTestId('create-board');
    await act(async () => {
      fireEvent.click(button);
      await settle();
    });
    expect(screen.getByTestId('create-message').textContent).toBe(
      "You're creating boards too quickly. Wait a minute and try again.",
    );
    expect(button.hasAttribute('disabled')).toBe(false);
    expect(window.location.pathname).toBe('/');
  });

  it('shows the failure copy for a 500, and retries on the next click', async () => {
    stubFetch(() => jsonResponse({ error: 'create_failed' }, 500));
    render(<App />);
    const button = screen.getByTestId('create-board');
    await act(async () => {
      fireEvent.click(button);
      await settle();
    });
    expect(screen.getByTestId('create-message').textContent).toBe(
      "Couldn't create a board. Please try again.",
    );
    expect(button.hasAttribute('disabled')).toBe(false);

    await act(async () => {
      fireEvent.click(button);
      await settle();
    });
    expect(calls.filter((call) => call === 'POST /api/boards')).toHaveLength(2);
  });

  it('treats a network failure as a failure, not as a board', async () => {
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    render(<App />);
    const button = screen.getByTestId('create-board');
    await act(async () => {
      fireEvent.click(button);
      await settle();
    });
    expect(screen.getByTestId('create-message').textContent).toBe(
      "Couldn't create a board. Please try again.",
    );
    expect(screen.queryByTestId('board-root')).toBeNull();
  });
});

describe('board page (TC-19, TC-20)', () => {
  it('shows not-found for a malformed id without asking the server', async () => {
    stubFetch(() => jsonResponse({}, 200));
    render(<BoardPage id="bad" />);
    await settle();
    expect(screen.getByTestId('not-found-page')).toBeTruthy();
    expect(calls).toEqual([]);
  });

  it('shows not-found for a well-formed id the server does not know', async () => {
    stubFetch(() => jsonResponse({ error: 'not_found' }, 404));
    render(<BoardPage id={VALID_ID} />);
    await settle();
    expect(screen.getByTestId('not-found-page')).toBeTruthy();
    expect(calls).toEqual([`GET /api/boards/${VALID_ID}`]);
  });

  it('mounts the board when the server says it exists', async () => {
    stubFetch(() => jsonResponse({ id: VALID_ID }, 200));
    render(<BoardPage id={VALID_ID} />);
    // Before the answer lands the page must say "Opening board…", not show an
    // empty canvas (PRD share.open_link).
    expect(screen.getByTestId('board-loading-message').textContent).toBe('Opening board…');
    await settle();
    await waitFor(() => {
      expect(screen.getByTestId('board-root')).toBeTruthy();
    });
  });

  it('retries an unreachable service with doubling backoff and opens the board', async () => {
    vi.useFakeTimers();
    const seen: string[] = [];
    const check = async (): Promise<CheckResponse> => {
      seen.push('attempt');
      return seen.length <= 2 ? { kind: 'unreachable' } : { kind: 'exists' };
    };

    render(<BoardPage id={VALID_ID} check={check} />);
    expect(screen.getByTestId('board-loading-message').textContent).toBe('Opening board…');

    // First two attempts fail: the page says the service is unreachable and
    // keeps a retry pending (PRD share.unreachable).
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(seen).toHaveLength(1);
    expect(screen.getByTestId('board-loading-message').textContent).toBe(
      "Couldn't reach vidi6. Retrying…",
    );

    await act(async () => {
      vi.advanceTimersByTime(BOARD_CHECK_RETRY_BASE_MS);
    });
    expect(seen).toHaveLength(2);

    await act(async () => {
      vi.advanceTimersByTime(BOARD_CHECK_RETRY_BASE_MS * 2);
    });
    expect(seen).toHaveLength(3);
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByTestId('board-root')).toBeTruthy();
  });

  it('caps the retry interval at the reconnect ceiling', async () => {
    const { checkBackoffMs } = await import('../../src/client/pages/useBoardCheck');
    const { RECONNECT_MAX_BACKOFF_MS } = await import('../../src/shared/config');
    expect(checkBackoffMs(0)).toBe(BOARD_CHECK_RETRY_BASE_MS);
    expect(checkBackoffMs(1)).toBe(BOARD_CHECK_RETRY_BASE_MS * 2);
    expect(checkBackoffMs(20)).toBe(RECONNECT_MAX_BACKOFF_MS);
  });
});
