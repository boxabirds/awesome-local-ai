import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, act } from '@testing-library/react';
import { HomePage } from '../../src/client/pages/HomePage';
import { BoardPage } from '../../src/client/pages/BoardPage';
import * as api from '../../src/client/api';

vi.mock('../../src/client/api');
vi.mock('../../src/client/BoardApp', () => ({
  BoardApp: ({ boardId }: { boardId: string }) => <div data-testid="board-app">{boardId}</div>,
}));

beforeEach(() => {
  vi.useFakeTimers();
  // Reset location to /
  window.history.pushState(null, '', '/');
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('TC-16: Create a board navigates to /b/id', () => {
  it('button shows Creating… disabled, then navigates to /b/<id>', async () => {
    vi.mocked(api.createBoardRequest).mockResolvedValue({ kind: 'created', id: 'abcdefghijklmnopqrstuvwx' });

    render(<HomePage />);
    const btn = screen.getByTestId('create-board-btn');
    fireEvent.click(btn);

    // Button should be disabled and show Creating…
    expect(btn).toBeDisabled();
    expect(btn.textContent).toContain('Creating…');

    // Wait for async resolution
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(window.location.pathname).toBe('/b/abcdefghijklmnopqrstuvwx');
  });
});

describe('TC-17: Create failure shows message, button enabled, no navigation', () => {
  it('api returns failed (500) -> error message shown, button enabled', async () => {
    vi.mocked(api.createBoardRequest).mockResolvedValue({ kind: 'failed' });

    render(<HomePage />);
    const btn = screen.getByTestId('create-board-btn');
    fireEvent.click(btn);

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(screen.getByTestId('create-error')).toHaveTextContent(
      "Couldn't create a board. Please try again.",
    );
    expect(btn).not.toBeDisabled();
    expect(window.location.pathname).toBe('/');
  });

  it('api returns failed (network error) -> error message shown, button enabled', async () => {
    vi.mocked(api.createBoardRequest).mockResolvedValue({ kind: 'failed' });

    render(<HomePage />);
    const btn = screen.getByTestId('create-board-btn');
    fireEvent.click(btn);

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(screen.getByTestId('create-error')).toHaveTextContent(
      "Couldn't create a board. Please try again.",
    );
    expect(btn).not.toBeDisabled();
    expect(window.location.pathname).toBe('/');
  });
});

describe('TC-18: Rate limit shows message, button enabled', () => {
  it('api returns rate_limited → rate-limit message shown, button enabled', async () => {
    vi.mocked(api.createBoardRequest).mockResolvedValue({ kind: 'rate_limited' });

    render(<HomePage />);
    const btn = screen.getByTestId('create-board-btn');
    fireEvent.click(btn);

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(screen.getByTestId('rate-limit-error')).toHaveTextContent(
      "You're creating boards too quickly. Wait a minute and try again.",
    );
    expect(btn).not.toBeDisabled();
  });
});

describe('TC-19: Malformed id → NotFoundPage without API call', () => {
  it('/b/bad renders NotFoundPage; checkBoard never called', () => {
    render(<BoardPage id="bad" />);

    expect(screen.getByText('Board not found')).toBeInTheDocument();
    expect(api.checkBoard).not.toHaveBeenCalled();
  });
});

describe('TC-20: Valid id but not_found → NotFoundPage after checking', async () => {
  it('shows Opening board… then NotFoundPage with Create a new board button', async () => {
    vi.mocked(api.checkBoard).mockResolvedValue({ kind: 'not_found' });

    render(<BoardPage id={'A'.repeat(22)} />);
    expect(screen.getByTestId('board-loading')).toHaveTextContent('Opening board…');

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(screen.getByText('Board not found')).toBeInTheDocument();
    expect(screen.getByTestId('not-found-create-btn')).toBeInTheDocument();
  });
});

describe('TC-21: Unreachable twice then exists → retry message → board', async () => {
  it('shows retry message, retries with backoff, then renders board', async () => {
    vi.mocked(api.checkBoard)
      .mockResolvedValueOnce({ kind: 'unreachable' })
      .mockResolvedValueOnce({ kind: 'unreachable' })
      .mockResolvedValueOnce({ kind: 'exists' });

    render(<BoardPage id={'A'.repeat(22)} />);

    // First call is immediate, gets unreachable
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId('board-unreachable')).toHaveTextContent(
      "Couldn't reach vidi6. Retrying…",
    );

    // Advance past first backoff (1000ms)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    // Still unreachable
    expect(screen.getByTestId('board-unreachable')).toBeInTheDocument();

    // Advance past second backoff (2000ms)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    // Now board should be rendered
    expect(screen.getByTestId('board-app')).toBeInTheDocument();
    expect(api.checkBoard).toHaveBeenCalledTimes(3);
  });
});
