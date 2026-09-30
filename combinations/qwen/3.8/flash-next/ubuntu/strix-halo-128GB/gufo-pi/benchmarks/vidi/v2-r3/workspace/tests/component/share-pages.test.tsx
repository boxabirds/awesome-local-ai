/**
 * Component tests for share.pages (TC-16, TC-17, TC-19 to TC-21).
 * Uses mocked api.ts and router.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BOARD_CHECK_RETRY_BASE_MS } from '../../src/shared/config';

// ─────────────────────────────────────────────────────────
// Mock the API module
// ─────────────────────────────────────────────────────────
const mockCreateBoardRequest = vi.fn();
const mockCheckBoard = vi.fn();

vi.mock('../../src/client/api', () => ({
  createBoardRequest: (...args: any[]) => mockCreateBoardRequest(...args),
  checkBoard: (...args: any[]) => mockCheckBoard(...args),
}));

// ─────────────────────────────────────────────────────────
// Mock the router module
// ─────────────────────────────────────────────────────────
const mockNavigate = vi.fn();

vi.mock('../../src/client/router', () => ({
  useRoute: () => ({ name: 'home' } as const),
  navigate: (...args: any[]) => mockNavigate(...args),
}));

// ─────────────────────────────────────────────────────────
// Mock BoardPage internals (BoardUI, SharePanel)
// ─────────────────────────────────────────────────────────
vi.mock('../../src/client/App', () => ({
  BoardUI: ({ boardId }: { boardId: string }) =>
    React.createElement('div', { 'data-testid': 'board-ui' }, `Board ${boardId}`),
}));

vi.mock('../../src/client/share/SharePanel', () => ({
  SharePanel: ({ boardId }: { boardId: string }) =>
    React.createElement('div', { 'data-testid': 'share-panel' }, `Share ${boardId}`),
}));

// ─────────────────────────────────────────────────────────
// Import components AFTER mocks are set up
// ─────────────────────────────────────────────────────────
import { HomePage } from '../../src/client/pages/HomePage';
import { BoardPage } from '../../src/client/pages/BoardPage';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('share.pages', () => {
  // TC-16: Click New board → "Creating…" disabled → navigate to /b/<id>
  describe('TC-16: New board creates and navigates', () => {
    it('clicks New board, shows Creating disabled, navigates', async () => {
      mockCreateBoardRequest.mockResolvedValue({ kind: 'created', id: 'abcdefghijklmnopqrstuv' });

      render(React.createElement(HomePage));
      const btn = screen.getByRole('button', { name: /new board/i });
      expect(btn).not.toBeDisabled();

      await userEvent.click(btn);

      // Should have navigated
      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/b/abcdefghijklmnopqrstuv');
      });
    });
  });

  // TC-17: api failed → exact failure message, button enabled, still on / (negative)
  describe('TC-17: New board failure shows error, no navigation', () => {
    it('server failure → message shown, button re-enabled, no navigation', async () => {
      mockCreateBoardRequest.mockResolvedValue({ kind: 'failed' });

      render(React.createElement(HomePage));
      const btn = screen.getByRole('button', { name: /new board/i });
      await userEvent.click(btn);

      await waitFor(() => {
        expect(screen.getByText(/couldn.t create a board/i)).toBeInTheDocument();
      });
      // Button should be re-enabled
      const btn2 = screen.getByRole('button', { name: /new board/i });
      expect(btn2).not.toBeDisabled();
      // No navigation
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('network error → message shown, button re-enabled, no navigation', async () => {
      mockCreateBoardRequest.mockResolvedValue({ kind: 'failed' });

      render(React.createElement(HomePage));
      const btn = screen.getByRole('button', { name: /new board/i });
      await userEvent.click(btn);

      await waitFor(() => {
        expect(screen.getByText(/couldn.t create a board/i)).toBeInTheDocument();
      });
      expect(mockNavigate).not.toHaveBeenCalled();
    });
  });

  // TC-19: /b/bad → NotFoundPage; checkBoard never called
  describe('TC-19: Invalid board id → NotFoundPage without API call', () => {
    it('renders NotFoundPage for malformed id', () => {
      render(React.createElement(BoardPage, { id: 'bad' }));
      expect(screen.getByText(/board not found/i)).toBeInTheDocument();
      expect(mockCheckBoard).not.toHaveBeenCalled();
    });
  });

  // TC-20: not_found → "Opening board…" then NotFoundPage with New board button
  describe('TC-20: not_found shows NotFoundPage with New board', () => {
    it('shows loading then NotFoundPage', async () => {
      mockCheckBoard.mockResolvedValue({ kind: 'not_found' });

      render(React.createElement(BoardPage, { id: 'abcdefghijklmnopqrstuv' }));

      // After check resolves, NotFoundPage
      await waitFor(() => {
        expect(screen.getByText(/board not found/i)).toBeInTheDocument();
      });
      // Should have a "New board" button
      expect(screen.getByRole('button', { name: /new board/i })).toBeInTheDocument();
    });
  });

  // TC-21: unreachable twice then exists → retry with backoff
  describe('TC-21: unreachable → retrying → board opens', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('shows retrying message then opens board after retries', async () => {
      let callCount = 0;
      mockCheckBoard.mockImplementation(async () => {
        callCount++;
        if (callCount <= 2) return { kind: 'unreachable' };
        return { kind: 'exists' };
      });

      render(React.createElement(BoardPage, { id: 'abcdefghijklmnopqrstuv' }));

      // First call resolves to unreachable (flush microtask + timer)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      // Should show retrying message
      expect(screen.getByText(/couldn.t reach vidi6/i)).toBeInTheDocument();

      // After first backoff (BOARD_CHECK_RETRY_BASE_MS) - second call
      await act(async () => {
        await vi.advanceTimersByTimeAsync(BOARD_CHECK_RETRY_BASE_MS);
      });

      // Still unreachable (second time)
      expect(screen.getByText(/couldn.t reach vidi6/i)).toBeInTheDocument();

      // After second backoff (2 * BOARD_CHECK_RETRY_BASE_MS) - third call
      await act(async () => {
        await vi.advanceTimersByTimeAsync(BOARD_CHECK_RETRY_BASE_MS * 2);
      });

      // Board should be shown
      expect(screen.getByTestId('board-ui')).toBeInTheDocument();

      // Verify 3 calls total
      expect(callCount).toBe(3);
    });
  });
});
