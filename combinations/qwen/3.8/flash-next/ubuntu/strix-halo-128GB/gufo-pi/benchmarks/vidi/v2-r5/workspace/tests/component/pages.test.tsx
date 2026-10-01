import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HomePage } from '../../src/client/pages/HomePage';
import { BoardPage } from '../../src/client/pages/BoardPage';
import { NotFoundPage } from '../../src/client/pages/NotFoundPage';
import { BOARD_CHECK_RETRY_BASE_MS } from '../../src/shared/config';
import type { CreateResponse, CheckResponse } from '../../src/client/api';

// Mock the api module
vi.mock('../../src/client/api', () => ({
  createBoardRequest: vi.fn(),
  checkBoard: vi.fn(),
}));

// Mock the router navigate
const mockNavigate = vi.fn();
vi.mock('../../src/client/router', () => ({
  navigate: (path: string) => mockNavigate(path),
  useRoute: vi.fn(() => ({ name: 'home' })),
}));

// Mock App (the board UI)
vi.mock('../../src/client/App', () => ({
  App: ({ boardId }: { boardId?: string }) => <div data-testid="board-ui">Board {boardId}</div>,
}));

// Mock SharePanel
vi.mock('../../src/client/share/SharePanel', () => ({
  SharePanel: ({ boardId }: { boardId: string }) => <div data-testid="share-panel">Share {boardId}</div>,
}));

import { createBoardRequest, checkBoard } from '../../src/client/api';

describe('TC-16: HomePage - click New board creates and navigates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows Creating… disabled, then navigates to /b/<id>', async () => {
    const mockId = 'abcdefghijklmnopqrstuv';
    (createBoardRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ kind: 'created', id: mockId } as CreateResponse);

    const user = userEvent.setup();
    render(<HomePage />);

    const button = screen.getByRole('button', { name: 'New board' });
    await user.click(button);

    // Button shows Creating… and is disabled
    expect(screen.getByRole('button', { name: 'New board' })).toBeDisabled();
    expect(screen.getByText('Creating\u2026')).toBeInTheDocument();

    // After resolution, navigates
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(`/b/${mockId}`);
    });
  });
});

describe('TC-17: HomePage - creation failure shows error, stays on home', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows failure message when api returns failed (500)', async () => {
    (createBoardRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ kind: 'failed' } as CreateResponse);

    const user = userEvent.setup();
    render(<HomePage />);

    await user.click(screen.getByRole('button', { name: 'New board' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent("Couldn't create a board. Please try again.");
    });

    // Button is enabled again
    expect(screen.getByRole('button', { name: 'New board' })).toBeEnabled();
    // No navigation occurred
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('shows failure message on network error', async () => {
    (createBoardRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ kind: 'failed' } as CreateResponse);

    const user = userEvent.setup();
    render(<HomePage />);

    await user.click(screen.getByRole('button', { name: 'New board' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent("Couldn't create a board. Please try again.");
    });
    expect(screen.getByRole('button', { name: 'New board' })).toBeEnabled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

describe('TC-19: BoardPage - malformed id shows NotFound without request', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders NotFoundPage for /b/bad, checkBoard never called', () => {
    render(<BoardPage id="bad" />);

    expect(screen.getByText('Board not found')).toBeInTheDocument();
    expect(checkBoard).not.toHaveBeenCalled();
  });
});

describe('TC-20: BoardPage - not_found shows NotFoundPage after checking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows Opening board… then NotFoundPage with New board button', async () => {
    const validId = 'abcdefghijklmnopqrstuv';
    (checkBoard as ReturnType<typeof vi.fn>).mockResolvedValue({ kind: 'not_found' } as CheckResponse);

    render(<BoardPage id={validId} />);

    // Initially shows "Opening board…"
    expect(screen.getByText('Opening board\u2026')).toBeInTheDocument();

    // After resolution, shows NotFoundPage
    await waitFor(() => {
      expect(screen.getByText('Board not found')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'New board' })).toBeInTheDocument();
  });
});

describe('TC-21: BoardPage - unreachable retries with backoff then succeeds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows retry message, retries after backoff intervals, board opens', async () => {
    vi.useFakeTimers();
    const validId = 'abcdefghijklmnopqrstuv';
    const mockCheckBoard = checkBoard as ReturnType<typeof vi.fn>;

    mockCheckBoard
      .mockResolvedValueOnce({ kind: 'unreachable' } as CheckResponse) // first attempt
      .mockResolvedValueOnce({ kind: 'unreachable' } as CheckResponse) // second attempt
      .mockResolvedValueOnce({ kind: 'exists' } as CheckResponse);     // third attempt succeeds

    render(<BoardPage id={validId} />);

    // Let initial effect run
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // First call happened and shows unreachable
    expect(mockCheckBoard).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("Couldn't reach vidi6. Retrying…")).toBeInTheDocument();

    // Advance past first retry interval (BOARD_CHECK_RETRY_BASE_MS = 1000)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BOARD_CHECK_RETRY_BASE_MS);
    });
    expect(mockCheckBoard).toHaveBeenCalledTimes(2);

    // Advance past second retry interval (BOARD_CHECK_RETRY_BASE_MS * 2 = 2000)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BOARD_CHECK_RETRY_BASE_MS * 2);
    });
    expect(mockCheckBoard).toHaveBeenCalledTimes(3);

    // Board renders
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId('board-ui')).toBeInTheDocument();
  });
});

describe('NotFoundPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows heading, text, New board button, link home', () => {
    render(<NotFoundPage />);
    expect(screen.getByText('Board not found')).toBeInTheDocument();
    expect(screen.getByText('Check the link, or ask the person who shared it to send it again.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New board' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to home' })).toBeInTheDocument();
  });
});
