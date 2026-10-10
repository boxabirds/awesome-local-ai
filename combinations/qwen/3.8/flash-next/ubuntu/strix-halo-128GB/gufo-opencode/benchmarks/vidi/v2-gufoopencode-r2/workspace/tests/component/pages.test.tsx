// Story 5 task 6 (share.pages): Home/Board/NotFound page state machines with
// a mocked api client. TC-16, TC-17, TC-19, TC-20, TC-21.

import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/client/App';
import { newBoardId } from '../../src/shared/board-id';
import { BOARD_CHECK_RETRY_BASE_MS } from '../../src/shared/config';

const api = vi.hoisted(() => ({
  createBoardRequest: vi.fn(),
  checkBoard: vi.fn(),
}));
vi.mock('../../src/client/api', () => api);

function goTo(path: string): void {
  window.history.replaceState(null, '', path);
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  goTo('/');
});

describe('HomePage (share.create, share.create_failure)', () => {
  it('TC-16: click New board -> Creating… disabled -> navigates to /b/<id> and opens the board', async () => {
    const id = newBoardId();
    api.createBoardRequest.mockResolvedValue({ kind: 'created', id });
    api.checkBoard.mockResolvedValue({ kind: 'exists' });
    render(<App />);

    const button = screen.getByRole('button', { name: 'New board' });
    fireEvent.click(button);

    expect(screen.getByRole('button', { name: 'Creating…' })).toBeDisabled();
    expect(api.createBoardRequest).toHaveBeenCalledTimes(1);

    await settle();
    expect(window.location.pathname).toBe(`/b/${id}`);
    // BoardPage reached ready: the board UI and its Share button are mounted.
    expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument();
  });

  it('TC-17: create failure keeps the person on Home with the PRD message and an enabled button', async () => {
    for (const failure of [
      { kind: 'failed' as const }, // 500 create_failed
      () => Promise.reject(new Error('network down')), // network error
    ]) {
      goTo('/');
      api.createBoardRequest.mockReset();
      if (typeof failure === 'function') {
        api.createBoardRequest.mockImplementation(failure);
      } else {
        api.createBoardRequest.mockResolvedValue(failure);
      }
      const { unmount } = render(<App />);
      fireEvent.click(screen.getByRole('button', { name: 'New board' }));
      await settle();

      expect(screen.getByRole('alert')).toHaveTextContent(
        "Couldn't create a board. Please try again.",
      );
      expect(screen.getByRole('button', { name: 'New board' })).toBeEnabled();
      expect(window.location.pathname).toBe('/');
      unmount();
    }
  });
});

describe('BoardPage (share.open_link, share.not_found, share.unreachable)', () => {
  it('TC-19: malformed id renders Board not found and never calls the api', async () => {
    goTo('/b/bad');
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Board not found' })).toBeInTheDocument();
    expect(api.checkBoard).not.toHaveBeenCalled();
  });

  it('TC-20: unknown board shows Opening board… then Board not found with a New board button', async () => {
    goTo(`/b/${newBoardId()}`);
    api.checkBoard.mockResolvedValue({ kind: 'not_found' });
    render(<App />);

    expect(screen.getByRole('status')).toHaveTextContent('Opening board…');
    expect(api.checkBoard).toHaveBeenCalledTimes(1);

    await settle();
    expect(screen.getByRole('heading', { name: 'Board not found' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New board' })).toBeInTheDocument();
    // Creating nothing on its own: the not-found page performed no create.
    expect(api.createBoardRequest).not.toHaveBeenCalled();
  });

  it('TC-21: unreachable retries with backoff and opens the board without a reload', async () => {
    vi.useFakeTimers();
    try {
      goTo(`/b/${newBoardId()}`);
      const id = window.location.pathname.slice('/b/'.length);
      api.checkBoard
        .mockResolvedValueOnce({ kind: 'unreachable' })
        .mockResolvedValueOnce({ kind: 'unreachable' })
        .mockResolvedValue({ kind: 'exists' });
      render(<App />);

      await act(async () => {});
      expect(screen.getByRole('status')).toHaveTextContent("Couldn't reach vidi6. Retrying…");
      expect(api.checkBoard).toHaveBeenCalledTimes(1);

      // First backoff step: BOARD_CHECK_RETRY_BASE_MS.
      await act(async () => {
        vi.advanceTimersByTime(BOARD_CHECK_RETRY_BASE_MS - 1);
      });
      expect(api.checkBoard).toHaveBeenCalledTimes(1);
      await act(async () => {
        vi.advanceTimersByTime(1);
      });
      expect(api.checkBoard).toHaveBeenCalledTimes(2);

      // Second step doubles.
      await act(async () => {
        vi.advanceTimersByTime(BOARD_CHECK_RETRY_BASE_MS * 2);
      });
      expect(api.checkBoard).toHaveBeenCalledTimes(3);

      // Third check succeeded: the board is open, no reload happened.
      expect(window.location.pathname).toBe(`/b/${id}`);
      expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
