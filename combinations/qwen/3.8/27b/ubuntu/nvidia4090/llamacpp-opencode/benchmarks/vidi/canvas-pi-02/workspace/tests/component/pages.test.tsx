/**
 * Story 5 component tests: share.pages (TC-16 to TC-21).
 *
 * Tests the page state machines with mocked api.ts. The router is driven by
 * setting window.location via history.pushState.
 *
 * Uses real timers to avoid the complexity of flushing promises under
 * fake timers. The backoff delays are short enough (1s, 2s) that the tests
 * complete within the timeout.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { newBoardId } from '../../src/shared/board-id';

// Mock api.ts
vi.mock('../../src/client/api', () => ({
  createBoardRequest: vi.fn(),
  checkBoard: vi.fn(),
}));

import { createBoardRequest, checkBoard } from '../../src/client/api';
import { HomePage } from '../../src/client/pages/HomePage';
import { BoardPage } from '../../src/client/pages/BoardPage';

const mockCreate = vi.mocked(createBoardRequest);
const mockCheck = vi.mocked(checkBoard);

beforeEach(() => {
  vi.clearAllMocks();
  // Reset to home
  window.history.pushState(null, '', '/');
});

// --- TC-16: Create → Creating… → navigate -------------------------------------

describe('TC-16 Create a board navigates to new board', () => {
  it('click Create → Creating… disabled → navigate to /b/id', async () => {
    const boardId = newBoardId();
    mockCreate.mockResolvedValue({ kind: 'created', id: boardId });

    render(<HomePage />);
    const btn = screen.getByTestId('create-board-button');
    expect(btn).toBeEnabled();
    expect(btn.textContent).toBe('Create a board');

    const user = userEvent.setup();
    await user.click(btn);

    // While creating
    expect(btn.textContent).toBe('Creating…');
    expect(btn).toBeDisabled();

    // After the promise resolves
    await waitFor(() => {
      expect(window.location.pathname).toBe(`/b/${boardId}`);
    });
  });
});

// --- TC-17: Create fails → error message, button re-enabled --------------------

describe('TC-17 Create failure shows error message', () => {
  it("api failed → 'Couldn't create a board. Please try again.'; button enabled; still on /", async () => {
    mockCreate.mockResolvedValue({ kind: 'failed' });

    render(<HomePage />);
    const btn = screen.getByTestId('create-board-button');
    const user = userEvent.setup();
    await user.click(btn);

    await waitFor(() => {
      expect(screen.getByTestId('create-error')).toHaveTextContent(
        "Couldn't create a board. Please try again.",
      );
    });
    expect(btn).toBeEnabled();
    expect(window.location.pathname).toBe('/');
  });
});

// --- TC-18: Rate limited → rate limit message ---------------------------------

describe('TC-18 Rate limited shows rate-limit message', () => {
  it('rate_limited → rate-limit message; button enabled', async () => {
    mockCreate.mockResolvedValue({ kind: 'rate_limited' });

    render(<HomePage />);
    const btn = screen.getByTestId('create-board-button');
    const user = userEvent.setup();
    await user.click(btn);

    await waitFor(() => {
      expect(screen.getByTestId('rate-limit-error')).toHaveTextContent(
        "You're creating boards too quickly. Wait a minute and try again.",
      );
    });
    expect(btn).toBeEnabled();
  });
});

// --- TC-19: Malformed id → NotFoundPage, no request ---------------------------

describe('TC-19 Malformed board id shows NotFoundPage without request', () => {
  it('/b/bad → NotFoundPage; checkBoard not called', () => {
    render(<BoardPage id="bad" />);

    expect(screen.getByTestId('not-found-page')).toBeInTheDocument();
    expect(mockCheck).not.toHaveBeenCalled();
  });
});

// --- TC-20: Unknown valid id → Opening board… → NotFoundPage -------------------

describe('TC-20 Unknown valid id shows loading then NotFoundPage', () => {
  it('api returns 404 → "Opening board…" then NotFoundPage', async () => {
    const boardId = newBoardId();
    mockCheck.mockResolvedValue({ kind: 'not_found' });

    render(<BoardPage id={boardId} />);

    // Initially loading
    expect(screen.getByTestId('board-loading')).toHaveTextContent('Opening board…');

    // After the check resolves
    await waitFor(() => {
      expect(screen.getByTestId('not-found-page')).toBeInTheDocument();
    });

    // The NotFoundPage has a Create a new board button
    expect(screen.getByTestId('create-new-board-button')).toBeInTheDocument();
  });
});

// --- TC-21: Unreachable → retry with backoff ----------------------------------

describe('TC-21 Unreachable board retries with backoff', () => {
  it('unreachable twice then exists → retry message then board; 3 calls total', async () => {
    const boardId = newBoardId();
    // First two calls: unreachable; third: exists
    mockCheck
      .mockResolvedValueOnce({ kind: 'unreachable' })
      .mockResolvedValueOnce({ kind: 'unreachable' })
      .mockResolvedValueOnce({ kind: 'exists' });

    render(<BoardPage id={boardId} />);

    // Initially loading
    expect(screen.getByTestId('board-loading')).toHaveTextContent('Opening board…');

    // First check completes → unreachable → retry message
    await waitFor(
      () => {
        expect(screen.getByTestId('board-unreachable')).toHaveTextContent(
          "Couldn't reach vidi6. Retrying…",
        );
      },
      { timeout: 2000 },
    );
    expect(mockCheck).toHaveBeenCalledTimes(1);

    // Second check completes → unreachable again (after 1s backoff)
    await waitFor(
      () => {
        expect(mockCheck).toHaveBeenCalledTimes(2);
      },
      { timeout: 3000 },
    );

    // Third check completes → exists (after 2s backoff)
    await waitFor(
      () => {
        expect(mockCheck).toHaveBeenCalledTimes(3);
      },
      { timeout: 4000 },
    );

    // Board renders (loading and unreachable are gone)
    await waitFor(
      () => {
        expect(screen.queryByTestId('board-loading')).not.toBeInTheDocument();
        expect(screen.queryByTestId('board-unreachable')).not.toBeInTheDocument();
      },
      { timeout: 2000 },
    );
  }, 10_000);
});
