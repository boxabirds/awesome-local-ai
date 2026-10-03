/**
 * Story 5, share.pages: component tests for the Home, Board and Board not
 * found pages (mocked `api.ts`, per the design's mock-vs-real boundaries).
 *
 * TC-16, TC-17, TC-19 to TC-21.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createBoardRequest, checkBoard } from '../../src/client/api';
import { App } from '../../src/client/App';
import { HomePage } from '../../src/client/pages/HomePage';
import { newBoardId } from '../../src/shared/board-id';
import { BOARD_CHECK_RETRY_BASE_MS } from '../../src/shared/config';

vi.mock('../../src/client/api', () => ({
  createBoardRequest: vi.fn(),
  checkBoard: vi.fn(),
}));

// The ready board mounts the stories 1–4 board, which would open a real
// WebSocket in jsdom; the connection is stubbed (page state machines are
// under test, not the network).
vi.mock('../../src/client/sync/connectBoard', () => ({
  connectBoard: vi.fn(() => ({
    destroy: vi.fn(),
    disconnect: vi.fn(),
    debug: () => ({}),
    forceLoadFailed: vi.fn(),
    forceRecovered: vi.fn(),
  })),
}));

const mockedCreate = vi.mocked(createBoardRequest);
const mockedCheck = vi.mocked(checkBoard);

afterEach(() => {
  vi.clearAllMocks();
  window.history.pushState(null, '', '/');
});

describe('share.pages: Home page', () => {
  it('TC-16: click New board → "Creating…" disabled → navigate to /b/<id>', async () => {
    const id = newBoardId();
    mockedCreate.mockResolvedValueOnce({ kind: 'created', id });
    const user = userEvent.setup();

    render(<HomePage />);
    const button = screen.getByRole('button', { name: 'New board' });
    await user.click(button);

    // Creating: label swapped and disabled while the request runs.
    const creating = screen.getByRole('button', { name: 'Creating…' });
    expect(creating).toBeDisabled();
    expect(mockedCreate).toHaveBeenCalledTimes(1);

    await waitFor(() => expect(window.location.pathname).toBe(`/b/${id}`));
  });

  it.each(['500 response', 'network error'])(
    'TC-17 (%s): creation fails → exact message, button enabled again, still on /',
    async () => {
      mockedCreate.mockResolvedValueOnce({ kind: 'failed' });
      const user = userEvent.setup();

      render(<HomePage />);
      await user.click(screen.getByRole('button', { name: 'New board' }));

      expect(
        await screen.findByText("Couldn't create a board. Please try again."),
      ).toBeInTheDocument();
      // Button is available again and no navigation happened.
      expect(screen.getByRole('button', { name: 'New board' })).not.toBeDisabled();
      expect(window.location.pathname).toBe('/');
    },
  );
});

describe('share.pages: Board page', () => {
  it('TC-19: /b/bad (malformed id) → Board not found, checkBoard never called', () => {
    window.history.pushState(null, '', '/b/bad');

    render(<App />);

    expect(screen.getByRole('heading', { name: 'Board not found' })).toBeInTheDocument();
    expect(screen.getByText('Check the link, or ask the person who shared it to send it again.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New board' })).toBeInTheDocument();
    expect(mockedCheck).not.toHaveBeenCalled();
  });

  it('TC-20: 404 → "Opening board…" then Board not found with New board', async () => {
    const id = newBoardId();
    window.history.pushState(null, '', `/b/${id}`);
    mockedCheck.mockResolvedValueOnce({ kind: 'not_found' });

    render(<App />);

    // Loading state first.
    expect(screen.getByText('Opening board…')).toBeInTheDocument();
    // Then the not-found page.
    expect(await screen.findByRole('heading', { name: 'Board not found' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New board' })).toBeInTheDocument();
    expect(mockedCheck).toHaveBeenCalledTimes(1);
  });

  it('TC-21: unreachable twice then exists → retry message, board opens, 3 calls', async () => {
    vi.useFakeTimers();
    try {
      const id = newBoardId();
      window.history.pushState(null, '', `/b/${id}`);
      mockedCheck
        .mockResolvedValueOnce({ kind: 'unreachable' })
        .mockResolvedValueOnce({ kind: 'unreachable' })
        .mockResolvedValueOnce({ kind: 'exists' });

      render(<App />);
      expect(screen.getByText('Opening board…')).toBeInTheDocument();

      // First check resolves unreachable.
      await act(async () => {
        vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByText("Couldn't reach vidi6. Retrying…")).toBeInTheDocument();
      expect(mockedCheck).toHaveBeenCalledTimes(1);

      // Retry after BOARD_CHECK_RETRY_BASE_MS (1st backoff).
      await act(async () => {
        vi.advanceTimersByTimeAsync(BOARD_CHECK_RETRY_BASE_MS);
      });
      expect(mockedCheck).toHaveBeenCalledTimes(2);

      // Second backoff is doubled.
      await act(async () => {
        vi.advanceTimersByTimeAsync(BOARD_CHECK_RETRY_BASE_MS * 2);
      });
      expect(mockedCheck).toHaveBeenCalledTimes(3);

      // The board is rendered (stories 1–4 UI, connection stubbed).
      expect(screen.getByTestId('sticky-btn')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
