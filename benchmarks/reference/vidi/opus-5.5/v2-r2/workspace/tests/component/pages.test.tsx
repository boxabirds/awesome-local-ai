// Story 5 — page state machines with a mocked api.ts (share.pages): TC-16, TC-17, TC-19 to TC-21.
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CheckResponse, CreateResponse } from '../../src/client/api';
import { Root } from '../../src/client/Root';
import { BoardPage } from '../../src/client/pages/BoardPage';
import { HomePage } from '../../src/client/pages/HomePage';
import { boardCheckRetryDelay, nextBoardPageState } from '../../src/client/pages/state';
import { newBoardId } from '../../src/shared/board-id';
import { BOARD_CHECK_RETRY_BASE_MS, RECONNECT_MAX_BACKOFF_MS } from '../../src/shared/config';

const api = vi.hoisted(() => ({
  createBoardRequest: vi.fn<() => Promise<CreateResponse>>(),
  checkBoard: vi.fn<(id: string) => Promise<CheckResponse>>(),
}));
vi.mock('../../src/client/api', () => api);

// The board itself (stories 1–4) stays offline in these tests.
const connected = vi.hoisted(() => [] as string[]);
vi.mock('../../src/client/sync/connectBoard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/sync/connectBoard')>();
  return {
    ...actual,
    connectBoard: (_doc: unknown, boardId: string, onState: (s: string) => void) => {
      connected.push(boardId);
      onState('connecting');
      return { destroy() {} };
    },
  };
});

const CREATE_FAILED = "Couldn't create a board. Please try again.";
const UNREACHABLE = "Couldn't reach vidi6. Retrying…";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/** Lets pending promise callbacks run (inside act). */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  api.createBoardRequest.mockReset();
  api.checkBoard.mockReset();
  connected.length = 0;
});

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('Home page (share.create)', () => {
  it('shows the product name, the description and New board', () => {
    render(<HomePage />);
    expect(screen.getByRole('heading', { name: 'vidi6' })).toBeTruthy();
    expect(screen.getByText('A shared board for thinking together')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New board' })).toBeTruthy();
  });

  it('TC-16: New board → "Creating…" and disabled → navigates to /b/<id> and opens the board', async () => {
    const id = newBoardId();
    const created = deferred<CreateResponse>();
    api.createBoardRequest.mockReturnValue(created.promise);
    api.checkBoard.mockResolvedValue({ kind: 'exists' });
    render(<Root />);
    fireEvent.click(screen.getByRole('button', { name: 'New board' }));
    const button = screen.getByRole('button', { name: 'Creating…' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    // A second click while creating creates nothing more.
    fireEvent.click(button);
    expect(api.createBoardRequest).toHaveBeenCalledTimes(1);
    await act(async () => created.resolve({ kind: 'created', id }));
    expect(window.location.pathname).toBe(`/b/${id}`);
    await flush();
    expect(api.checkBoard).toHaveBeenCalledWith(id);
    expect(screen.getByTestId('board-viewport')).toBeTruthy();
    expect(connected).toEqual([id]);
  });

  it.each([['500 create_failed'], ['network error']])(
    'TC-17: creation fails (%s) → message, button enabled again, still on /',
    async () => {
      // api.ts maps both a 500 and a network error to { kind: 'failed' }.
      api.createBoardRequest.mockResolvedValue({ kind: 'failed' });
      render(<Root />);
      fireEvent.click(screen.getByRole('button', { name: 'New board' }));
      await flush();
      expect(screen.getByText(CREATE_FAILED)).toBeTruthy();
      const button = screen.getByRole('button', { name: 'New board' }) as HTMLButtonElement;
      expect(button.disabled).toBe(false);
      expect(window.location.pathname).toBe('/');
      expect(screen.getByRole('heading', { name: 'vidi6' })).toBeTruthy();
      // Trying again works.
      api.createBoardRequest.mockResolvedValue({ kind: 'created', id: newBoardId() });
      api.checkBoard.mockResolvedValue({ kind: 'exists' });
      fireEvent.click(button);
      await flush();
      expect(window.location.pathname).toMatch(/^\/b\//);
    },
  );
});

describe('Board page (share.open_link, share.not_found, share.unreachable)', () => {
  it('TC-19: /b/bad → Board not found without any request', () => {
    window.history.replaceState(null, '', '/b/bad');
    render(<Root />);
    expect(screen.getByRole('heading', { name: 'Board not found' })).toBeTruthy();
    expect(screen.getByText('Check the link, or ask the person who shared it to send it again.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New board' })).toBeTruthy();
    expect(api.checkBoard).not.toHaveBeenCalled();
  });

  it('other addresses show Board not found too', () => {
    window.history.replaceState(null, '', '/somewhere/else');
    render(<Root />);
    expect(screen.getByRole('heading', { name: 'Board not found' })).toBeTruthy();
  });

  it('TC-20: unknown board → "Opening board…" then Board not found with New board, and a link home', async () => {
    const id = newBoardId();
    const check = deferred<CheckResponse>();
    api.checkBoard.mockReturnValue(check.promise);
    render(<BoardPage id={id} />);
    expect(screen.getByText('Opening board…')).toBeTruthy();
    await act(async () => check.resolve({ kind: 'not_found' }));
    expect(screen.getByRole('heading', { name: 'Board not found' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New board' })).toBeTruthy();
    expect(screen.queryByTestId('board-viewport')).toBeNull();
    expect(connected).toEqual([]);
    // New board from the not-found page creates a fresh board.
    const fresh = newBoardId();
    api.createBoardRequest.mockResolvedValue({ kind: 'created', id: fresh });
    fireEvent.click(screen.getByRole('button', { name: 'New board' }));
    await flush();
    expect(window.location.pathname).toBe(`/b/${fresh}`);
  });

  it('Board not found links back to the home page', async () => {
    window.history.replaceState(null, '', '/b/bad');
    render(<Root />);
    fireEvent.click(screen.getByRole('link'));
    expect(window.location.pathname).toBe('/');
    expect(screen.getByRole('heading', { name: 'vidi6' })).toBeTruthy();
  });

  it('TC-21: unreachable twice then exists → retry message, retries after BASE then 2× BASE, then the board', async () => {
    vi.useFakeTimers();
    const id = newBoardId();
    api.checkBoard
      .mockResolvedValueOnce({ kind: 'unreachable' })
      .mockResolvedValueOnce({ kind: 'unreachable' })
      .mockResolvedValueOnce({ kind: 'exists' });
    render(<BoardPage id={id} />);
    await flush();
    expect(screen.getByText(UNREACHABLE)).toBeTruthy();
    expect(api.checkBoard).toHaveBeenCalledTimes(1);

    await act(async () => vi.advanceTimersByTime(BOARD_CHECK_RETRY_BASE_MS - 1));
    expect(api.checkBoard).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTime(1));
    await flush();
    expect(api.checkBoard).toHaveBeenCalledTimes(2);
    expect(screen.getByText(UNREACHABLE)).toBeTruthy();

    await act(async () => vi.advanceTimersByTime(2 * BOARD_CHECK_RETRY_BASE_MS - 1));
    expect(api.checkBoard).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTime(1));
    await flush();
    expect(api.checkBoard).toHaveBeenCalledTimes(3);
    expect(screen.queryByText(UNREACHABLE)).toBeNull();
    expect(screen.getByTestId('board-viewport')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Share' })).toBeTruthy();
    expect(connected).toEqual([id]);
  });

  it('retry timers are cleared on unmount', async () => {
    vi.useFakeTimers();
    api.checkBoard.mockResolvedValue({ kind: 'unreachable' });
    const { unmount } = render(<BoardPage id={newBoardId()} />);
    await flush();
    unmount();
    await act(async () => vi.advanceTimersByTime(RECONNECT_MAX_BACKOFF_MS * 2));
    expect(api.checkBoard).toHaveBeenCalledTimes(1);
  });

  it('nextBoardPageState follows the state diagram; backoff doubles and is capped', () => {
    const id = newBoardId();
    expect(nextBoardPageState({ kind: 'checking' }, { kind: 'exists' }, 1, id)).toEqual({ kind: 'ready', boardId: id });
    expect(nextBoardPageState({ kind: 'checking' }, { kind: 'not_found' }, 1, id)).toEqual({ kind: 'not_found' });
    expect(nextBoardPageState({ kind: 'checking' }, { kind: 'unreachable' }, 2, id)).toEqual({
      kind: 'unreachable',
      attempt: 2,
      nextRetryMs: 2 * BOARD_CHECK_RETRY_BASE_MS,
    });
    expect(boardCheckRetryDelay(1)).toBe(BOARD_CHECK_RETRY_BASE_MS);
    expect(boardCheckRetryDelay(50)).toBe(RECONNECT_MAX_BACKOFF_MS);
  });
});
