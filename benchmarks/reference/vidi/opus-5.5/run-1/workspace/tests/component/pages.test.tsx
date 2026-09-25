/**
 * share.pages (story 5): Home, Board (existence check with retry) and Board not found as state
 * machines. `api.ts` is mocked per test; TC-17 also runs the real wrappers over a stubbed fetch
 * to prove 500 and network errors both map to the failure message.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../../src/client/api';
import { App } from '../../src/client/App';
import { newBoardId } from '../../src/shared/board-id';
import { BOARD_CHECK_RETRY_BASE_MS, RECONNECT_MAX_BACKOFF_MS } from '../../src/shared/config';
import { checkRetryDelay } from '../../src/client/pages/BoardPage';

vi.mock('../../src/client/api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/client/api')>();
  return { ...real, createBoardRequest: vi.fn(real.createBoardRequest), checkBoard: vi.fn(real.checkBoard) };
});

const createMock = vi.mocked(api.createBoardRequest);
const checkMock = vi.mocked(api.checkBoard);

const CREATE_FAILED = "Couldn't create a board. Please try again.";
const RATE_LIMITED = "You're creating boards too quickly. Wait a minute and try again.";
const OPENING = 'Opening board…';
const UNREACHABLE = "Couldn't reach vidi6. Retrying…";
const HTTP_INTERNAL_ERROR = 500;

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Lets pending promise callbacks (API answers) run inside act. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

function goTo(path: string): void {
  window.history.pushState(null, '', path);
}

beforeEach(() => {
  createMock.mockReset();
  checkMock.mockReset();
  // Default: never answers (tests set what they need).
  checkMock.mockImplementation(() => new Promise(() => {}));
});

afterEach(() => {
  goTo('/');
});

describe('share.pages: home', () => {
  beforeEach(() => goTo('/'));

  it('shows the product name, the one-line description and Create a board', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'vidi6' })).toBeTruthy();
    expect(screen.getByText('A shared board for thinking together')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create a board' })).toBeTruthy();
  });

  it('TC-16 click → Creating… (disabled) → navigates to /b/<id>', async () => {
    const id = newBoardId();
    const answer = deferred<api.CreateResponse>();
    createMock.mockReturnValue(answer.promise);
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Create a board' }));
    const busy = screen.getByRole('button', { name: 'Creating…' }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    // A second click while creating sends nothing.
    fireEvent.click(busy);
    expect(createMock).toHaveBeenCalledTimes(1);

    answer.resolve({ kind: 'created', id });
    await flush();
    expect(window.location.pathname).toBe(`/b/${id}`);
    expect(screen.getByText(OPENING)).toBeTruthy();
    expect(checkMock).toHaveBeenCalledWith(id);
  });

  const failures: [string, () => void][] = [
    [
      '500 create_failed',
      () =>
        vi.stubGlobal(
          'fetch',
          vi.fn(async () => Response.json({ error: 'create_failed' }, { status: HTTP_INTERNAL_ERROR })),
        ),
    ],
    ['network error', () => vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))],
  ];
  for (const [name, stub] of failures) {
    it(`TC-17 ${name} → failure message, button enabled, still on /`, async () => {
      stub();
      const real = await vi.importActual<typeof import('../../src/client/api')>('../../src/client/api');
      createMock.mockImplementation(real.createBoardRequest);
      render(<App />);
      fireEvent.click(screen.getByRole('button', { name: 'Create a board' }));
      await vi.waitFor(() => expect(screen.getByRole('alert').textContent).toBe(CREATE_FAILED));
      const button = screen.getByRole('button', { name: 'Create a board' }) as HTMLButtonElement;
      expect(button.disabled).toBe(false);
      expect(window.location.pathname).toBe('/');
      expect(fetch).toHaveBeenCalledWith('/api/boards', { method: 'POST' });
    });
  }

  it('TC-18 rate limited → rate-limit message, button enabled; a later click tries again', async () => {
    createMock.mockResolvedValue({ kind: 'rate_limited' });
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Create a board' }));
    await flush();
    expect(screen.getByRole('alert').textContent).toBe(RATE_LIMITED);
    const button = screen.getByRole('button', { name: 'Create a board' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(window.location.pathname).toBe('/');
    fireEvent.click(button);
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it('TC-18 the real wrapper maps 429 to rate_limited', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'rate_limited' }, { status: 429 })));
    const real = await vi.importActual<typeof import('../../src/client/api')>('../../src/client/api');
    expect(await real.createBoardRequest()).toEqual({ kind: 'rate_limited' });
  });
});

describe('share.pages: board link', () => {
  it('TC-19 /b/bad → Board not found; the board API is never asked', () => {
    goTo('/b/bad');
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Board not found' })).toBeTruthy();
    expect(checkMock).not.toHaveBeenCalled();
  });

  it('other addresses → Board not found', () => {
    goTo('/somewhere/else');
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Board not found' })).toBeTruthy();
  });

  it('TC-20 unknown id → Opening board… then Board not found with Create a new board and a home link', async () => {
    const id = newBoardId();
    const answer = deferred<api.CheckResponse>();
    checkMock.mockReturnValue(answer.promise);
    goTo(`/b/${id}`);
    render(<App />);
    expect(screen.getByText(OPENING)).toBeTruthy();
    answer.resolve({ kind: 'not_found' });
    await flush();
    expect(screen.getByRole('heading', { name: 'Board not found' })).toBeTruthy();
    expect(
      screen.getByText('Check the link, or ask the person who shared it to send it again.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create a new board' })).toBeTruthy();
    expect(checkMock).toHaveBeenCalledTimes(1);

    // Home link: same-document navigation.
    fireEvent.click(screen.getByRole('link', { name: 'Go to the home page' }));
    expect(window.location.pathname).toBe('/');
    expect(screen.getByRole('button', { name: 'Create a board' })).toBeTruthy();
  });

  it('TC-20 Create a new board on Board not found reuses the create action', async () => {
    const fresh = newBoardId();
    checkMock.mockResolvedValueOnce({ kind: 'not_found' });
    createMock.mockResolvedValue({ kind: 'created', id: fresh });
    goTo(`/b/${newBoardId()}`);
    render(<App />);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Create a new board' }));
    await flush();
    expect(window.location.pathname).toBe(`/b/${fresh}`);
  });

  it('TC-21 unreachable twice then exists → retry message, retries after base then 2× base, board shown', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const id = newBoardId();
    checkMock
      .mockResolvedValueOnce({ kind: 'unreachable' })
      .mockResolvedValueOnce({ kind: 'unreachable' })
      .mockResolvedValueOnce({ kind: 'exists' });
    goTo(`/b/${id}`);
    render(<App />);
    await flush();
    expect(screen.getByText(UNREACHABLE)).toBeTruthy();
    expect(checkMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(BOARD_CHECK_RETRY_BASE_MS - 1);
    });
    expect(checkMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(checkMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText(UNREACHABLE)).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2 * BOARD_CHECK_RETRY_BASE_MS - 1);
    });
    expect(checkMock).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(checkMock).toHaveBeenCalledTimes(3);
    expect(screen.queryByText(UNREACHABLE)).toBeNull();
    expect(screen.getByTestId('board-viewport')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Share' })).toBeTruthy();
  });

  it('TC-21 the real wrapper maps network errors and 5xx to unreachable, 404 to not_found', async () => {
    const real = await vi.importActual<typeof import('../../src/client/api')>('../../src/client/api');
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    expect(await real.checkBoard(newBoardId())).toEqual({ kind: 'unreachable' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
    expect(await real.checkBoard(newBoardId())).toEqual({ kind: 'unreachable' });
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'not_found' }, { status: 404 })));
    expect(await real.checkBoard(newBoardId())).toEqual({ kind: 'not_found' });
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ id: 'x' }, { status: 200 })));
    expect(await real.checkBoard(newBoardId())).toEqual({ kind: 'exists' });
  });

  it('retry backoff doubles and is capped at RECONNECT_MAX_BACKOFF_MS', () => {
    expect(checkRetryDelay(0)).toBe(BOARD_CHECK_RETRY_BASE_MS);
    expect(checkRetryDelay(1)).toBe(2 * BOARD_CHECK_RETRY_BASE_MS);
    expect(checkRetryDelay(20)).toBe(RECONNECT_MAX_BACKOFF_MS);
  });

  it('retry timers are cleared on unmount', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    checkMock.mockResolvedValue({ kind: 'unreachable' });
    goTo(`/b/${newBoardId()}`);
    const { unmount } = render(<App />);
    await flush();
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
