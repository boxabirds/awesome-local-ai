// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, act, cleanup } from '@testing-library/react';

// The board UI mounts a y-websocket provider when ready; jsdom has no
// WebSocket. The page state machine is the unit under test, so the
// connection is a no-op here.
vi.mock('../../src/client/sync/connectBoard', () => ({
  connectBoard: vi.fn(() => ({ destroy: vi.fn() })),
  canEdit: (state: string) => state !== 'load_failed',
}));

import { App } from '../../src/client/App';
import { HomePage } from '../../src/client/pages/HomePage';
import { CREATE_FAILURE_MESSAGE } from '../../src/client/pages/state';
import { newBoardId } from '../../src/shared/board-id';

/** Route the (real) api.ts fetch calls per test. */
function mockFetch(handler: (url: string) => Response | Promise<Response>): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return handler(url);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

function setPath(path: string): void {
  window.history.pushState(null, '', path);
}

beforeEach(() => {
  // jsdom has no ResizeObserver; the board viewport needs it on mount.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  setPath('/');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('TC-16: home page creates a board and navigates (share.home)', () => {
  it('New board → "Creating…" → navigation to /b/<id>', async () => {
    const id = newBoardId();
    let resolveCreate: ((v: Response) => void) | undefined;
    mockFetch(
      () =>
        new Promise<Response>((resolve) => {
          resolveCreate = resolve;
        }),
    );

    render(<HomePage />);
    const btn = screen.getByTestId('new-board-button');
    expect(btn).toHaveTextContent('New board');

    await act(async () => {
      btn.click();
    });
    // Creating state: label + disabled while the request is in flight
    expect(screen.getByTestId('new-board-button')).toHaveTextContent('Creating…');
    expect(screen.getByTestId('new-board-button')).toBeDisabled();
    expect(window.location.pathname).toBe('/');

    await act(async () => {
      resolveCreate!(
        new Response(JSON.stringify({ id }), { status: 201, headers: { 'Content-Type': 'application/json' } }),
      );
    });
    expect(window.location.pathname).toBe(`/b/${id}`);
  });
});

describe('TC-17: create failure shows the exact message (share.home)', () => {
  it.each([
    ['a 500 create_failed response', () =>
      new Response(JSON.stringify({ error: 'create_failed' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })],
    ['a network error', () => Promise.reject(new Error('network down'))],
  ])('when creation fails with %s', async (_name, makeResponse) => {
    mockFetch(() => makeResponse());

    render(<HomePage />);
    await act(async () => {
      screen.getByTestId('new-board-button').click();
    });

    expect(screen.getByTestId('create-error')).toHaveTextContent(
      "Couldn't create a board. Please try again.",
    );
    expect(screen.getByTestId('create-error')).toHaveTextContent(CREATE_FAILURE_MESSAGE);
    // No partial navigation; the button is usable again
    expect(window.location.pathname).toBe('/');
    expect(screen.getByTestId('new-board-button')).toBeEnabled();
  });
});

describe('TC-19: malformed board links show not-found (share.not_found)', () => {
  it.each(['/b/abc', '/b/', '/b/has!bad', '/nope', '/b/too_long_board_id_value_1234567890'])(
    'pathname %s renders the not-found page without any request',
    (path) => {
      const fetchMock = mockFetch(() => new Response('x', { status: 200 }));
      setPath(path);
      render(<App />);
      expect(screen.getByTestId('not-found-page')).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});

describe('TC-20: unknown board shows not-found (share.not_found)', () => {
  it('checks existence, then renders the not-found page with New board', async () => {
    const id = newBoardId();
    mockFetch((url) =>
      url.includes('/api/boards/') ? new Response('nf', { status: 404 }) : new Response('x', { status: 200 }),
    );
    setPath(`/b/${id}`);

    render(<App />);
    expect(screen.getByTestId('board-checking')).toHaveTextContent('Opening board…');

    await act(async () => {});
    expect(screen.getByTestId('not-found-page')).toBeInTheDocument();
    expect(screen.getByTestId('new-board-button')).toBeInTheDocument();
  });
});

describe('TC-21: flaky service, then board (share.open_link)', () => {
  it('retries with 1s → 2s backoff and renders the board on the 3rd check', async () => {
    vi.useFakeTimers();
    const id = newBoardId();
    let boardChecks = 0;
    const fetchMock = mockFetch((url) => {
      if (!url.includes('/api/boards/')) return new Response('x', { status: 200 });
      boardChecks++;
      if (boardChecks < 3) return Promise.reject(new Error('network down'));
      return new Response(JSON.stringify({ id }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    setPath(`/b/${id}`);

    render(<App />);
    expect(screen.getByTestId('board-checking')).toHaveTextContent('Opening board…');

    // Attempt 1 resolves → unreachable, backoff 1s
    await act(async () => {});
    expect(screen.getByTestId('board-unreachable')).toHaveTextContent("Couldn't reach vidi6. Retrying…");

    // 1s backoff → attempt 2 → unreachable, backoff 2s
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    await act(async () => {});
    expect(screen.getByTestId('board-unreachable')).toBeInTheDocument();

    // 2s backoff → attempt 3 → exists → board renders
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    await act(async () => {});
    expect(screen.getByTestId('board-viewport')).toBeInTheDocument();

    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes('/api/boards/')).length).toBe(3);
  });
});
