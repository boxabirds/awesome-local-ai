/**
 * Component tests for pages (TC-16 to TC-21).
 * Mocks api.ts to test page state machines.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Use vi.hoisted to make mocks available before vi.mock factories run
const { mockNavigate, mockCreateBoard, mockCheckBoard } = vi.hoisted(() => {
  return {
    mockNavigate: vi.fn(),
    mockCreateBoard: vi.fn(),
    mockCheckBoard: vi.fn(),
  };
});

vi.mock('../../src/client/api', () => ({
  createBoardRequest: mockCreateBoard,
  checkBoard: mockCheckBoard,
}));

vi.mock('../../src/client/router', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/client/router')>();
  return {
    ...original,
    navigate: mockNavigate,
  };
});

// Mock App to prevent WebSocket / Y.Doc side effects when board reaches "ready"
vi.mock('../../src/client/App', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/App')>();
  return {
    ...actual,
    App: () => <div data-testid="board-ui">Board UI</div>,
  };
});

import { HomePage } from '../../src/client/pages/HomePage';
import { BoardPage } from '../../src/client/pages/BoardPage';
import { BOARD_CHECK_RETRY_BASE_MS } from '../../src/shared/config';

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// TC-16: click Create → "Creating…" disabled → navigate to /b/<id>
// ---------------------------------------------------------------------------
describe('TC-16: HomePage create success', () => {
  it('button shows Creating… and is disabled; navigates on success', async () => {
    let resolveCreate: ((v: { kind: 'created'; id: string }) => void) | null = null;
    mockCreateBoard.mockReturnValue(new Promise((resolve) => { resolveCreate = resolve; }));

    const user = userEvent.setup();
    render(<HomePage />);

    const button = screen.getByRole('button', { name: /create a board/i });
    await user.click(button);

    // Button should show "Creating…" and be disabled
    expect(button).toHaveTextContent('Creating…');
    expect(button).toBeDisabled();

    // Resolve the create
    await act(async () => {
      resolveCreate!({ kind: 'created', id: 'abcdefghijklmnopqrstuv' });
    });

    // Should have navigated
    expect(mockNavigate).toHaveBeenCalledWith('/b/abcdefghijklmnopqrstuv');
  });
});

// ---------------------------------------------------------------------------
// TC-17: create failure → error message, button enabled, no navigation
// ---------------------------------------------------------------------------
describe('TC-17: HomePage create failure', () => {
  it('shows failure message for 500, button re-enabled', async () => {
    mockCreateBoard.mockResolvedValue({ kind: 'failed' });
    const user = userEvent.setup();
    render(<HomePage />);

    const button = screen.getByRole('button', { name: /create a board/i });
    await user.click(button);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent("Couldn't create a board. Please try again.");
    });
    expect(button).toBeEnabled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('shows failure message for network error (same kind: failed)', async () => {
    mockCreateBoard.mockResolvedValue({ kind: 'failed' });
    const user = userEvent.setup();
    render(<HomePage />);

    const button = screen.getByRole('button', { name: /create a board/i });
    await user.click(button);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent("Couldn't create a board. Please try again.");
    });
    expect(button).toBeEnabled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// TC-18: rate limited → rate-limit message, button enabled
// ---------------------------------------------------------------------------
describe('TC-18: HomePage rate limited', () => {
  it('shows rate-limit message, button re-enabled', async () => {
    mockCreateBoard.mockResolvedValue({ kind: 'rate_limited' });
    const user = userEvent.setup();
    render(<HomePage />);

    const button = screen.getByRole('button', { name: /create a board/i });
    await user.click(button);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        "You're creating boards too quickly. Wait a minute and try again.",
      );
    });
    expect(button).toBeEnabled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// TC-19: BoardPage with malformed id → NotFoundPage, checkBoard never called
// ---------------------------------------------------------------------------
describe('TC-19: BoardPage malformed id → not found, no request', () => {
  it('renders NotFoundPage without calling checkBoard', () => {
    render(<BoardPage id="bad" />);
    expect(screen.getByText('Board not found')).toBeInTheDocument();
    expect(mockCheckBoard).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// TC-20: BoardPage not_found → "Opening board…" then NotFoundPage
// ---------------------------------------------------------------------------
describe('TC-20: BoardPage not found', () => {
  it('shows Opening board… then NotFoundPage with Create a new board button', async () => {
    // Make checkBoard resolve asynchronously so we can observe the "checking" state
    let resolveCheck: ((v: { kind: 'not_found' }) => void) | null = null;
    mockCheckBoard.mockReturnValue(new Promise((resolve) => { resolveCheck = resolve; }));

    render(<BoardPage id="abcdefghijklmnopqrstuv" />);

    // Initially shows "Opening board…"
    expect(screen.getByText('Opening board…')).toBeInTheDocument();

    // Resolve the check
    await act(async () => {
      resolveCheck!({ kind: 'not_found' });
    });

    // After check resolves, shows NotFoundPage
    await waitFor(() => {
      expect(screen.getByText('Board not found')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /create a new board/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// TC-21: BoardPage unreachable then healthy → retry message → board
// ---------------------------------------------------------------------------
describe('TC-21: BoardPage unreachable then exists', () => {
  it('shows retry message, retries with backoff, then board renders', async () => {
    vi.useFakeTimers();

    let checkCount = 0;
    mockCheckBoard.mockImplementation(async () => {
      checkCount++;
      if (checkCount <= 2) {
        return { kind: 'unreachable' as const };
      }
      return { kind: 'exists' as const };
    });

    render(<BoardPage id="abcdefghijklmnopqrstuv" />);

    // First call happens immediately (async microtask) → unreachable
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    await waitFor(() => {
      expect(screen.getByText("Couldn't reach vidi6. Retrying…")).toBeInTheDocument();
    });

    // Advance past first retry interval (BOARD_CHECK_RETRY_BASE_MS = 1000)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BOARD_CHECK_RETRY_BASE_MS + 100);
    });

    // Still unreachable after second failure
    await waitFor(() => {
      expect(screen.getByText("Couldn't reach vidi6. Retrying…")).toBeInTheDocument();
    });

    // Advance past second retry interval (doubled to 2000)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BOARD_CHECK_RETRY_BASE_MS * 2 + 100);
    });

    // Now it should be ready - the retry message is gone, board UI rendered
    await waitFor(() => {
      expect(screen.queryByText("Couldn't reach vidi6. Retrying…")).not.toBeInTheDocument();
    });

    expect(screen.getByTestId('board-ui')).toBeInTheDocument();

    // 3 calls total
    expect(mockCheckBoard).toHaveBeenCalledTimes(3);

    vi.useRealTimers();
  });
});
