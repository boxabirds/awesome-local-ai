// Story 5, client.story5_share_link (TC-20, TC-21): the Board page's existence
// check and its retry, driven through a mocked `api.ts`. The two states the page
// must never paper over are here: an address the service says has no board is
// "Board not found" (and a malformed one never asks at all), and an address the
// service cannot be *reached* at is "Couldn't reach vidi6. Retrying…" and retries
// on a capped backoff — not a false not-found.
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoardPage } from '../../src/client/pages/BoardPage';
import { checkBoard } from '../../src/client/api';
import { BOARD_CHECK_RETRY_BASE_MS } from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';

vi.mock('../../src/client/api', () => ({
  createBoardRequest: vi.fn(async () => ({ kind: 'failed' as const })),
  checkBoard: vi.fn(),
}));

const mockedCheck = vi.mocked(checkBoard);

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('TC-20: a bad address is not-found, and a malformed one never asks', () => {
  it('makes no request for a malformed id and shows Board not found', () => {
    render(<BoardPage id="not-an-id" />);
    expect(screen.getByRole('heading', { name: 'Board not found' })).toBeTruthy();
    expect(mockedCheck).not.toHaveBeenCalled();
  });

  it('asks about a well-formed id, then shows Board not found on a not-found answer', async () => {
    const id = newBoardId();
    mockedCheck.mockResolvedValue({ kind: 'not_found' });
    render(<BoardPage id={id} />);
    expect(screen.getByRole('status')).toHaveTextContent('Opening board');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Board not found' })).toBeTruthy());
    expect(mockedCheck).toHaveBeenCalledTimes(1);
  });

  it('mounts the live board when the service says it exists', async () => {
    const id = newBoardId();
    mockedCheck.mockResolvedValue({ kind: 'exists' });
    render(<BoardPage id={id} />);
    await waitFor(() => expect(screen.getByTestId('sticky-note-button')).toBeTruthy());
    expect(mockedCheck).toHaveBeenCalledWith(id);
  });
});

describe('TC-21: an unreachable service is retried, not declared a not-found', () => {
  it('retries twice on the backoff and opens once the service answers', async () => {
    vi.useFakeTimers();
    const id = newBoardId();
    mockedCheck
      .mockResolvedValueOnce({ kind: 'unreachable' })
      .mockResolvedValueOnce({ kind: 'unreachable' })
      .mockResolvedValue({ kind: 'exists' });

    render(<BoardPage id={id} />);
    // The first attempt has been made and failed to reach the service.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mockedCheck).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent("Couldn't reach vidi6. Retrying");

    // The first retry waits BOARD_CHECK_RETRY_BASE_MS.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BOARD_CHECK_RETRY_BASE_MS);
    });
    expect(mockedCheck).toHaveBeenCalledTimes(2);

    // The second waits twice that; then the service answers and the board opens.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BOARD_CHECK_RETRY_BASE_MS * 2);
    });
    expect(mockedCheck).toHaveBeenCalledTimes(3);
    expect(screen.getByTestId('sticky-note-button')).toBeTruthy();
  });
});
