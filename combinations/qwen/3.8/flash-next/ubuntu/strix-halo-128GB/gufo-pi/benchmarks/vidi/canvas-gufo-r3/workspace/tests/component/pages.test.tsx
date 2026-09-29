import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, act, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HomePage } from '@client/pages/HomePage';
import { BoardPage } from '@client/pages/BoardPage';
import { NotFoundPage } from '@client/pages/NotFoundPage';
import { navigate } from '@client/router';

// Mock api.ts
vi.mock('@client/api', () => ({
  createBoardRequest: vi.fn(),
  checkBoard: vi.fn(),
}));

// Mock navigate
vi.mock('@client/router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@client/router')>();
  return {
    ...actual,
    navigate: vi.fn(),
  };
});

// Mock BoardPage's heavy dependencies
vi.mock('@client/Board', () => ({
  Board: ({ boardId }: { boardId: string }) =>
    React.createElement('div', { 'data-testid': 'board', 'data-board-id': boardId }),
}));

vi.mock('@client/share/SharePanel', () => ({
  SharePanel: ({ boardId }: { boardId: string }) =>
    React.createElement('div', { 'data-testid': 'share-panel' }),
}));

import { createBoardRequest, checkBoard } from '@client/api';

const mockCreateBoardRequest = vi.mocked(createBoardRequest);
const mockCheckBoard = vi.mocked(checkBoard);
const mockNavigate = vi.mocked(navigate);

describe('share.pages component tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'location', {
      value: { pathname: '/', origin: 'http://localhost', href: 'http://localhost/' },
      writable: true,
    });
  });

  afterEach(() => {
    cleanup();
  });

  // TC-16: click Create → "Creating…" disabled → navigate to /b/<id>
  describe('TC-16: Create a board flow', () => {
    it('shows Creating… and navigates on success', async () => {
      let resolveCreate: (v: any) => void;
      mockCreateBoardRequest.mockImplementation(() => new Promise((r) => { resolveCreate = r; }));

      const { unmount } = render(React.createElement(HomePage));

      const button = screen.getByRole('button', { name: /create a board/i });
      await userEvent.click(button);

      // Button shows "Creating…" and is disabled
      expect(screen.getByRole('button', { name: /creating/i })).toBeDisabled();

      // Resolve with created
      await act(async () => {
        resolveCreate!({ kind: 'created', id: 'abcdefghijklmnopqrstuv' });
      });

      expect(mockNavigate).toHaveBeenCalledWith('/b/abcdefghijklmnopqrstuv');
      unmount();
    });
  });

  // TC-17: create failure (500 and network error, 2 runs)
  describe('TC-17: Create failure shows message', () => {
    it('shows failure message on api failed (500)', async () => {
      mockCreateBoardRequest.mockResolvedValue({ kind: 'failed' });

      render(React.createElement(HomePage));

      const button = screen.getByRole('button', { name: /create a board/i });
      await userEvent.click(button);

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(
          "Couldn't create a board. Please try again.",
        );
      });
      // Button is enabled again
      const btn = screen.getByRole('button', { name: /create a board/i });
      expect(btn).toBeEnabled();
      // No navigation
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('shows failure message on network error (kind=failed)', async () => {
      mockCreateBoardRequest.mockResolvedValue({ kind: 'failed' });

      render(React.createElement(HomePage));

      const button = screen.getByRole('button', { name: /create a board/i });
      await userEvent.click(button);

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(
          "Couldn't create a board. Please try again.",
        );
      });
      expect(mockNavigate).not.toHaveBeenCalled();
    });
  });

  // TC-18: rate limited → rate-limit message; button enabled
  describe('TC-18: Rate limit message', () => {
    it('shows rate-limit message and button enabled', async () => {
      mockCreateBoardRequest.mockResolvedValue({ kind: 'rate_limited' });

      render(React.createElement(HomePage));

      const button = screen.getByRole('button', { name: /create a board/i });
      await userEvent.click(button);

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(
          "You're creating boards too quickly. Wait a minute and try again.",
        );
      });
      const btn = screen.getByRole('button', { name: /create a board/i });
      expect(btn).toBeEnabled();
    });
  });

  // TC-19: /b/bad → NotFoundPage; checkBoard never called
  describe('TC-19: Malformed id → NotFound without API call', () => {
    it('renders NotFoundPage for bad id', () => {
      render(React.createElement(BoardPage, { id: 'bad' }));
      expect(screen.getByText('Board not found')).toBeDefined();
      expect(mockCheckBoard).not.toHaveBeenCalled();
    });
  });

  // TC-20: not_found → "Opening board…" then NotFoundPage
  describe('TC-20: Board not found after check', () => {
    it('shows opening then not found', async () => {
      let resolveCheck: (v: any) => void;
      mockCheckBoard.mockImplementation(() => new Promise((r) => { resolveCheck = r; }));

      render(React.createElement(BoardPage, { id: 'abcdefghijklmnopqrstuv' }));

      // Initially shows "Opening board…"
      expect(screen.getByText('Opening board…')).toBeDefined();

      // Resolve as not_found
      await act(async () => {
        resolveCheck!({ kind: 'not_found' });
      });

      await waitFor(() => {
        expect(screen.getByText('Board not found')).toBeDefined();
      });
      // Create a new board button is present
      expect(screen.getByRole('button', { name: /create a new board/i })).toBeDefined();
    });
  });

  // TC-21: unreachable twice then exists → retry then board
  describe('TC-21: Unreachable with retry backoff', () => {
    it('shows retry message then board after 2 unreachable with backoff', async () => {
      let checkCount = 0;
      mockCheckBoard.mockImplementation(async () => {
        checkCount++;
        if (checkCount <= 2) return { kind: 'unreachable' as const };
        return { kind: 'exists' as const };
      });

      render(React.createElement(BoardPage, { id: 'abcdefghijklmnopqrstuv' }));

      // First call resolves → unreachable message
      await waitFor(() => {
        expect(screen.getByText("Couldn't reach vidi6. Retrying…")).toBeDefined();
      });
      expect(mockCheckBoard).toHaveBeenCalledTimes(1);

      // Wait for first backoff (1000ms = BOARD_CHECK_RETRY_BASE_MS)
      await waitFor(
        () => {
          expect(mockCheckBoard).toHaveBeenCalledTimes(2);
        },
        { timeout: 2000 },
      );
      expect(screen.getByText("Couldn't reach vidi6. Retrying…")).toBeDefined();

      // Wait for second backoff (2000ms)
      await waitFor(
        () => {
          expect(mockCheckBoard).toHaveBeenCalledTimes(3);
        },
        { timeout: 3000 },
      );

      // Board rendered
      await waitFor(() => {
        expect(screen.getByTestId('board')).toBeDefined();
      });
    });
  });
});
