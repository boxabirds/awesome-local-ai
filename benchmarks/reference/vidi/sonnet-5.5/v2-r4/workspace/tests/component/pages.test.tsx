import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newBoardId } from '../../src/shared/board-id';
import { BOARD_CHECK_RETRY_BASE_MS } from '../../src/shared/config';
import type { CheckResponse, CreateResponse } from '../../src/client/api';
import * as api from '../../src/client/api';
import { BoardPage } from '../../src/client/pages/BoardPage';
import { HomePage } from '../../src/client/pages/HomePage';
import { NotFoundPage } from '../../src/client/pages/NotFoundPage';
import { nextBoardPageState, retryDelayMs } from '../../src/client/pages/state';
import { parseRoute } from '../../src/client/router';

vi.mock('../../src/client/api', () => ({ createBoardRequest: vi.fn(), checkBoard: vi.fn() }));
// The board itself (stories 1-4) is not under test here: no sockets in jsdom.
vi.mock('../../src/client/sync/connectBoard', () => ({
  connectBoard: (_doc: unknown, _id: string, onState: (s: string) => void) => {
    onState('connected');
    return { destroy() {} };
  },
}));

const createBoardRequest = vi.mocked(api.createBoardRequest);
const checkBoard = vi.mocked(api.checkBoard);

beforeEach(() => {
  history.replaceState(null, '', '/');
  createBoardRequest.mockReset();
  checkBoard.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('HomePage', () => {
  it('shows the product name, tagline and New board', () => {
    render(<HomePage />);
    expect(screen.getByText('A shared board for thinking together')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New board' })).toBeTruthy();
  });

  it('TC-16: click → "Creating…" disabled → navigate to /b/<id>', async () => {
    const d = deferred<CreateResponse>();
    createBoardRequest.mockReturnValue(d.promise);
    render(<HomePage />);
    fireEvent.click(screen.getByRole('button', { name: 'New board' }));
    const busy = screen.getByRole('button', { name: 'Creating…' }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    expect(location.pathname).toBe('/');
    const id = newBoardId();
    await act(async () => d.resolve({ kind: 'created', id }));
    expect(location.pathname).toBe(`/b/${id}`);
  });

  it.each([
    ['500', { kind: 'failed' } as CreateResponse, false],
    ['network error', { kind: 'failed' } as CreateResponse, true],
  ])('TC-17: creation failure (%s) → message, button enabled, still on /', async (_name, result) => {
    createBoardRequest.mockResolvedValue(result);
    render(<HomePage />);
    fireEvent.click(screen.getByRole('button', { name: 'New board' }));
    expect(await screen.findByText("Couldn't create a board. Please try again.")).toBeTruthy();
    expect((screen.getByRole('button', { name: 'New board' }) as HTMLButtonElement).disabled).toBe(false);
    expect(location.pathname).toBe('/');
  });
});

describe('BoardPage', () => {
  it('TC-19: a malformed id shows Board not found and never calls the API', () => {
    render(<BoardPage id="bad" />);
    expect(screen.getByRole('heading', { name: 'Board not found' })).toBeTruthy();
    expect(checkBoard).not.toHaveBeenCalled();
  });

  it('TC-20: 404 → "Opening board…" then Board not found with a New board button', async () => {
    const d = deferred<CheckResponse>();
    checkBoard.mockReturnValue(d.promise);
    render(<BoardPage id={newBoardId()} />);
    expect(screen.getByText('Opening board…')).toBeTruthy();
    await act(async () => d.resolve({ kind: 'not_found' }));
    expect(screen.getByRole('heading', { name: 'Board not found' })).toBeTruthy();
    expect(screen.getByText('Check the link, or ask the person who shared it to send it again.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New board' })).toBeTruthy();
    expect(screen.getByRole('link')).toBeTruthy();
  });

  it('TC-21: unreachable twice then exists → retry message, backoff 1x then 2x, board opens (3 calls)', async () => {
    vi.useFakeTimers();
    checkBoard
      .mockResolvedValueOnce({ kind: 'unreachable' })
      .mockResolvedValueOnce({ kind: 'unreachable' })
      .mockResolvedValueOnce({ kind: 'exists' });
    render(<BoardPage id={newBoardId()} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("Couldn't reach vidi6. Retrying…")).toBeTruthy();
    expect(checkBoard).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(BOARD_CHECK_RETRY_BASE_MS - 1);
    });
    expect(checkBoard).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(checkBoard).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Couldn't reach vidi6. Retrying…")).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2 * BOARD_CHECK_RETRY_BASE_MS - 1);
    });
    expect(checkBoard).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(checkBoard).toHaveBeenCalledTimes(3);
    expect(screen.getByTestId('board-viewport')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Share' })).toBeTruthy();
    expect(screen.queryByText("Couldn't reach vidi6. Retrying…")).toBeNull();
  });

  it('stops retrying after unmount', async () => {
    vi.useFakeTimers();
    checkBoard.mockResolvedValue({ kind: 'unreachable' });
    const { unmount } = render(<BoardPage id={newBoardId()} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(checkBoard).toHaveBeenCalledTimes(1);
  });
});

describe('NotFoundPage', () => {
  it('links back to the home page', () => {
    history.replaceState(null, '', '/nowhere');
    render(<NotFoundPage />);
    fireEvent.click(screen.getByRole('link'));
    expect(location.pathname).toBe('/');
  });
});

describe('state and routing helpers', () => {
  it('backoff doubles and is capped', () => {
    expect(retryDelayMs(0)).toBe(BOARD_CHECK_RETRY_BASE_MS);
    expect(retryDelayMs(1)).toBe(2 * BOARD_CHECK_RETRY_BASE_MS);
    expect(retryDelayMs(30)).toBe(10_000);
  });
  it('nextBoardPageState maps check results', () => {
    const s = { kind: 'checking' } as const;
    expect(nextBoardPageState(s, { kind: 'not_found' }, 0)).toEqual({ kind: 'not_found' });
    expect(nextBoardPageState(s, { kind: 'unreachable' }, 1)).toEqual({
      kind: 'unreachable',
      attempt: 1,
      nextRetryMs: 2 * BOARD_CHECK_RETRY_BASE_MS,
    });
    expect(nextBoardPageState(s, { kind: 'exists' }, 0).kind).toBe('ready');
  });
  it('parseRoute', () => {
    expect(parseRoute('/')).toEqual({ name: 'home' });
    expect(parseRoute('/b/abc')).toEqual({ name: 'board', id: 'abc' });
    expect(parseRoute('/x')).toEqual({ name: 'not_found' });
    expect(parseRoute('/b/')).toEqual({ name: 'not_found' });
  });
});
