/**
 * Component tests for Home/Board/NotFound pages (story 5).
 * TC-16, TC-17, TC-19, TC-20, TC-21.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Mock api.ts
vi.mock('../../src/client/api', () => ({
  createBoardRequest: vi.fn(),
  checkBoard: vi.fn(),
}));

// Mock router
const mockNavigate = vi.fn();
vi.mock('../../src/client/router', () => ({
  navigate: (...args: unknown[]) => mockNavigate(...args),
  useRoute: vi.fn(),
  parseRoute: vi.fn(),
}));

// Mock App component to avoid mounting real board
vi.mock('../../src/client/App', () => ({
  App: ({ boardId }: { boardId?: string }) => <div data-testid="board-app">Board App {boardId}</div>,
}));

// Mock SharePanel
vi.mock('../../src/client/share/SharePanel', () => ({
  SharePanel: ({ boardId }: { boardId: string }) => <div data-testid="share-panel">Share {boardId}</div>,
}));

import { createBoardRequest, checkBoard } from '../../src/client/api';
import { HomePage } from '../../src/client/pages/HomePage';
import { BoardPage } from '../../src/client/pages/BoardPage';
import { NotFoundPage } from '../../src/client/pages/NotFoundPage';
import { isValidBoardId } from '../../src/shared/board-id';

const mockCreateBoardRequest = vi.mocked(createBoardRequest);
const mockCheckBoard = vi.mocked(checkBoard);

describe('share.pages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // TC-16: click New board → "Creating…" disabled → navigate to /b/<id>
  it('TC-16: click New board shows Creating… then navigates', async () => {
    let resolveCreate: (value: { kind: 'created'; id: string }) => void;
    mockCreateBoardRequest.mockImplementation(() => {
      return new Promise((resolve) => { resolveCreate = resolve; });
    });

    render(<HomePage />);

    const button = screen.getByRole('button', { name: 'New board' });
    expect(button).toBeEnabled();

    await userEvent.click(button);

    // Button shows Creating… and is disabled
    expect(screen.getByText('Creating…')).toBeInTheDocument();
    expect(button).toBeDisabled();

    // Resolve the create request
    resolveCreate!({ kind: 'created', id: 'abcdefghijklmnopqrstuv' });

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/b/abcdefghijklmnopqrstuv');
    });
  });

  // TC-17a: create failure (500 → failed) → error message, button enabled, no navigate
  it('TC-17a: create failure shows message and re-enables button', async () => {
    mockCreateBoardRequest.mockResolvedValue({ kind: 'failed' });

    render(<HomePage />);

    const button = screen.getByRole('button', { name: 'New board' });
    await userEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText("Couldn't create a board. Please try again.")).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'New board' })).toBeEnabled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  // TC-17b: network error → same behavior
  it('TC-17b: network error shows message and re-enables button', async () => {
    mockCreateBoardRequest.mockResolvedValue({ kind: 'failed' });

    render(<HomePage />);

    const button = screen.getByRole('button', { name: 'New board' });
    await userEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText("Couldn't create a board. Please try again.")).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'New board' })).toBeEnabled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  // TC-19: /b/bad → NotFoundPage; checkBoard not called
  it('TC-19: malformed board id shows NotFoundPage without calling checkBoard', async () => {
    render(<BoardPage id="bad" />);

    expect(screen.getByText('Board not found')).toBeInTheDocument();
    expect(mockCheckBoard).not.toHaveBeenCalled();
  });

  // TC-20: checkBoard returns not_found → "Opening board…" then NotFoundPage
  it('TC-20: checkBoard 404 shows Opening then NotFoundPage', async () => {
    mockCheckBoard.mockResolvedValue({ kind: 'not_found' });
    const id = 'abcdefghijklmnopqrstuv'; // valid 22-char id

    render(<BoardPage id={id} />);

    // Initially shows "Opening board…"
    expect(screen.getByText('Opening board…')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Board not found')).toBeInTheDocument();
    });
  });

  // TC-21: unreachable twice then exists → retry message then board (with fake timers)
  it('TC-21: unreachable then exists shows retry message then board', async () => {
    vi.useFakeTimers();

    const id = 'abcdefghijklmnopqrstuv';

    mockCheckBoard
      .mockResolvedValueOnce({ kind: 'unreachable' })
      .mockResolvedValueOnce({ kind: 'unreachable' })
      .mockResolvedValueOnce({ kind: 'exists' });

    render(<BoardPage id={id} />);

    // First check triggers immediately - resolve microtask
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // Shows unreachable message
    expect(screen.getByText("Couldn't reach vidi6. Retrying…")).toBeInTheDocument();

    // First retry after BOARD_CHECK_RETRY_BASE_MS (1000ms)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    // Still unreachable
    expect(screen.getByText("Couldn't reach vidi6. Retrying…")).toBeInTheDocument();

    // Second retry after 2000ms (2× base)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    // Now exists - board rendered
    expect(screen.getByTestId('board-app')).toBeInTheDocument();
    expect(mockCheckBoard).toHaveBeenCalledTimes(3);

    vi.useRealTimers();
  });

  // NotFoundPage renders correctly
  it('NotFoundPage shows correct content', () => {
    render(<NotFoundPage />);
    expect(screen.getByText('Board not found')).toBeInTheDocument();
    expect(screen.getByText('Check the link, or ask the person who shared it to send it again.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New board' })).toBeInTheDocument();
  });

  // Verify isValidBoardId is used by BoardPage
  it('isValidBoardId correctly validates ids', () => {
    expect(isValidBoardId('abcdefghijklmnopqrstuv')).toBe(true);
    expect(isValidBoardId('bad')).toBe(false);
    expect(isValidBoardId('a'.repeat(23))).toBe(false);
  });
});
