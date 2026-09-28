// Story 5 component tests (tasks.md TC-16 to TC-25): the home create flow,
// the board existence check with retries, and the Share panel. Fetch is
// stubbed per test (tests/component/setup.ts provides a default-200
// stand-in the board page's existence check uses).

import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderAppAt } from './render-app';
import {
  BOARD_CHECK_MAX_RETRIES,
  BOARD_CHECK_RETRY_BASE_MS,
  LINK_COPIED_MS,
} from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';

type FetchMock = ReturnType<typeof vi.fn>;

/** Stubs global fetch, answering GET /api/boards/:id with the given status
 *  function (called per request). Returns the mock for assertions. */
function stubBoardCheck(statusFor: (call: number, boardId: string) => number): FetchMock {
  let call = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = input as string | URL;
    const url = typeof raw === 'string' ? raw : raw.pathname;
    const method = init?.method ?? 'GET';
    const match = url.match(/^\/api\/boards\/([^/]+)$/);
    if (method === 'GET' && match !== null) {
      call += 1;
      const status = statusFor(call, match[1]);
      return new Response(status === 404 ? JSON.stringify({ error: 'not_found' }) : JSON.stringify({ id: match[1] }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    throw new Error(`stub: unhandled ${method} ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('share.pages (home + board page)', () => {
  it('TC-16: click Create -> "Creating…" disabled -> navigates to /b/<id> and the board renders', async () => {
    const serverId = newBoardId();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const raw = input as string | URL;
      const url = typeof raw === 'string' ? raw : raw.pathname;
      const method = init?.method ?? 'GET';
      if (method === 'POST' && url === '/api/boards') {
        return new Response(JSON.stringify({ id: serverId }), { status: 201 });
      }
      const match = url.match(/^\/api\/boards\/([^/]+)$/);
      if (match !== null) {
        return new Response(JSON.stringify({ id: match[1] }), { status: 200 });
      }
      throw new Error(`stub: unhandled ${method} ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await renderAppAt('/');
    const button = screen.getByTestId('create-board');
    fireEvent.click(button);
    // Synchronously: the button is disabled and shows "Creating…".
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent('Creating…');

    await act(async () => {
      // Let the POST resolve, navigate, and the board mount.
    });
    expect(await screen.findByTestId('board-viewport')).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2); // POST create + GET existence
  });

  it('TC-17: create failure (500, then network) -> exact message, button re-enabled, stays on /', async () => {
    for (const failMode of ['500', 'network'] as const) {
      const fetchMock = vi.fn(async () => {
        if (failMode === 'network') throw new TypeError('failed to fetch');
        return new Response(JSON.stringify({ error: 'create_failed' }), { status: 500 });
      });
      vi.stubGlobal('fetch', fetchMock);
      const view = await renderAppAt('/');
      const button = screen.getByTestId('create-board');
      fireEvent.click(button);
      await act(async () => {});
      expect(screen.getByTestId('create-error')).toHaveTextContent(
        "Couldn't create a board. Please try again.",
      );
      expect(button).toBeEnabled();
      expect(button).toHaveTextContent('Create a board');
      // Negative: no navigation — still the home page.
      expect(screen.queryByTestId('board-viewport')).toBeNull();
      expect(screen.getByTestId('create-board')).not.toBeNull();
      view.unmount();
    }
  });

  it('TC-18: 429 on create -> exact rate-limit message, button re-enabled', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'rate_limited' }), { status: 429 })),
    );
    await renderAppAt('/');
    const button = screen.getByTestId('create-board');
    fireEvent.click(button);
    await act(async () => {});
    expect(screen.getByTestId('create-error')).toHaveTextContent(
      "You're creating boards too quickly. Wait a minute and try again.",
    );
    expect(button).toBeEnabled();
  });

  it('TC-19: /b/bad -> NotFoundPage with no existence request (negative)', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('must not be called');
    });
    vi.stubGlobal('fetch', fetchMock);
    await renderAppAt('/b/bad');
    expect(screen.getByTestId('not-found-create')).toHaveTextContent('Create a new board');
    expect(screen.queryByTestId('board-viewport')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe('board existence check (fake timers)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('TC-20: not_found -> "Opening board…" then NotFoundPage with Create a new board', async () => {
      // Gate the first response so the "Opening board…" state is observable
      // while the first check is in flight.
      let releaseFirst: (() => void) | undefined;
      const firstGate = new Promise<void>((res) => { releaseFirst = res; });
      let call = 0;
      const fetchMock = vi.fn(async () => {
        call += 1;
        if (call === 1) await firstGate;
        return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
      });
      vi.stubGlobal('fetch', fetchMock);
      await renderAppAt();

      expect(screen.getByTestId('board-loading')).toHaveTextContent('Opening board…');
      releaseFirst?.();
      await act(async () => {});

      let delay = BOARD_CHECK_RETRY_BASE_MS;
      for (let i = 1; i < BOARD_CHECK_MAX_RETRIES; i++) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(delay);
        });
        delay = Math.min(delay * 2, 5000);
      }

      expect(screen.getByTestId('not-found-create')).toHaveTextContent('Create a new board');
      expect(screen.getByTestId('not-found-home')).toHaveTextContent('Go home');
      expect(screen.queryByTestId('board-viewport')).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(BOARD_CHECK_MAX_RETRIES);
    });

    it('TC-21: unreachable twice then exists -> "Retrying…" then board; retries at 1x, 2x; 3 calls', async () => {
      const seen: number[] = [];
      const stub = stubBoardCheck((call) => {
        seen.push(call);
        return call < 3 ? 503 : 200;
      });
      await renderAppAt();

      // First failure -> the retrying message.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByTestId('board-loading')).toHaveTextContent("Couldn't reach vidi6. Retrying…");

      // Retry after BOARD_CHECK_RETRY_BASE_MS.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(BOARD_CHECK_RETRY_BASE_MS);
      });
      // Second failure; next retry after 2x the base.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(BOARD_CHECK_RETRY_BASE_MS * 2);
      });

      expect(screen.getByTestId('board-viewport')).not.toBeNull();
      expect(screen.queryByTestId('board-loading')).toBeNull();
      expect(seen).toEqual([1, 2, 3]);
      void stub;
    });

    it('the document title never contains the board id (no id leakage; index.html keeps "vidi6")', async () => {
      const boardId = newBoardId();
      stubBoardCheck(() => 200);
      await renderAppAt(`/b/${boardId}`);
      expect(document.title).not.toContain(boardId);
    });
  });
});

describe('share.share_panel', () => {
  /** Opens the share panel on a mounted board. */
  async function openSharePanel(): Promise<void> {
    stubBoardCheck(() => 200);
    await renderAppAt();
    await act(async () => {
      screen.getByTestId('share-button').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(screen.getByTestId('share-panel')).not.toBeNull();
  }

  it('TC-22: copy resolves -> "Link copied" at LINK_COPIED_MS-1, reverted at LINK_COPIED_MS', async () => {
    vi.useFakeTimers();
    try {
      const boardId = newBoardId();
      stubBoardCheck(() => 200);
      const written: string[] = [];
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: async (t: string) => { written.push(t); } },
        configurable: true,
      });
      await renderAppAt(`/b/${boardId}`);
      await act(async () => {
        screen.getByTestId('share-button').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(screen.getByTestId('share-link')).toHaveValue(`${window.location.origin}/b/${boardId}`);
      expect(screen.getByTestId('share-note')).toHaveTextContent('Anyone with this link can view and edit this board.');

      await act(async () => {
        screen.getByTestId('share-copy').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      // Visible just before the revert...
      await act(async () => {
        await vi.advanceTimersByTimeAsync(LINK_COPIED_MS - 1);
      });
      expect(screen.getByTestId('share-copy')).toHaveTextContent('Link copied');
      // ...and reverted at LINK_COPIED_MS.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(screen.getByTestId('share-copy')).toHaveTextContent('Copy');
      expect(screen.queryByTestId('share-copied')).toBeNull();
      expect(written).toEqual([`${window.location.origin}/b/${boardId}`]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('TC-23: writeText rejects -> input fully selected + focused, manual-copy message', async () => {
    const boardId = newBoardId();
    await openSharePanel();
    const link = `${window.location.origin}/b/${boardId}`;
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async () => { throw new Error('denied'); } },
      configurable: true,
    });

    await act(async () => {
      screen.getByTestId('share-copy').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const input = screen.getByTestId('share-link') as HTMLInputElement;
    expect(screen.getByTestId('share-manual-copy')).toHaveTextContent('Press Ctrl+C (Cmd+C on Mac) to copy.');
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(link.length);
  });

  it('TC-24: navigator.clipboard undefined -> same manual-copy behaviour', async () => {
    const boardId = newBoardId();
    await openSharePanel();
    const link = `${window.location.origin}/b/${boardId}`;
    // jsdom defines no navigator.clipboard, so the copy fails and the
    // manual-copy guidance shows.
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });

    await act(async () => {
      screen.getByTestId('share-copy').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const input = screen.getByTestId('share-link') as HTMLInputElement;
    expect(screen.getByTestId('share-manual-copy')).toHaveTextContent('Press Ctrl+C (Cmd+C on Mac) to copy.');
    expect(document.activeElement).toBe(input);
    expect(input.selectionEnd).toBe(link.length);
  });

  it('TC-25: Escape closes, outside click closes, focus returns to the Share button', async () => {
    const open = async (): Promise<void> => {
      await act(async () => {
        screen.getByTestId('share-button').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(screen.getByTestId('share-panel')).not.toBeNull();
    };

    await openSharePanel();

    // Escape closes it and returns focus to the Share button.
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(screen.queryByTestId('share-panel')).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId('share-button'));

    // Reopen, then a pointerdown outside the panel closes it.
    await open();
    const outside = document.createElement('div');
    document.body.appendChild(outside);
    try {
      await act(async () => {
        outside.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      });
    } finally {
      outside.remove();
    }
    expect(screen.queryByTestId('share-panel')).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId('share-button'));
  });
});
