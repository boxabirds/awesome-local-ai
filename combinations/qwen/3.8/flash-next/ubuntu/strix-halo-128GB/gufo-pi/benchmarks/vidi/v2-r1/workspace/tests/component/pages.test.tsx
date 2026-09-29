/**
 * Component tests for Home page and Board page state machines (story 5).
 * TC-16, TC-17, TC-19, TC-20, TC-21.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

import type { CreateResponse, CheckResponse } from '../../src/client/api';

// Mock the api module
vi.mock('../../src/client/api', () => ({
  createBoardRequest: vi.fn(),
  checkBoard: vi.fn(),
}));

import { createBoardRequest, checkBoard } from '../../src/client/api';
import { HomePage } from '../../src/client/pages/HomePage';
import { BoardPage } from '../../src/client/pages/BoardPage';
import { NotFoundPage } from '../../src/client/pages/NotFoundPage';

// Mock navigate
const mockNavigate = vi.fn();
vi.mock('../../src/client/router', () => ({
  navigate: (...args: unknown[]) => mockNavigate(...args),
  useRoute: () => ({ name: 'home' } as const),
}));

// Mock App (board UI)
vi.mock('../../src/client/App', () => ({
  App: ({ boardId }: { boardId: string }) => <div data-testid="board-ui">Board {boardId}</div>,
}));

const mockedCreateBoard = vi.mocked(createBoardRequest);
const mockedCheckBoard = vi.mocked(checkBoard);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(createBoardRequest).mockResolvedValue({ kind: 'failed' });
  vi.mocked(checkBoard).mockResolvedValue({ kind: 'exists' });
});

describe('HomePage (TC-16, TC-17)', () => {
  // TC-16: click New board → "Creating…" disabled → navigate to /b/<id>
  it('TC-16: click New board shows Creating… then navigates', async () => {
    let resolveCreate!: (v: CreateResponse) => void;
    mockedCreateBoard.mockReturnValue(
      new Promise<CreateResponse>((resolve) => { resolveCreate = resolve; }),
    );

    render(<HomePage />);
    const button = screen.getByTestId('new-board');
    expect(button.hasAttribute('disabled')).toBe(false);
    expect(button.textContent).toBe('New board');

    fireEvent.click(button);
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(button.textContent).toBe('Creating…');

    await act(async () => {
      resolveCreate({ kind: 'created', id: 'abcdefghijklmnopqrstuv' });
    });

    expect(mockNavigate).toHaveBeenCalledWith('/b/abcdefghijklmnopqrstuv');
  });

  // TC-17: create failure (500) → error message, button re-enabled, no navigation
  it('TC-17: create failure shows error message, button enabled, no navigation', async () => {
    mockedCreateBoard.mockResolvedValue({ kind: 'failed' });

    render(<HomePage />);
    fireEvent.click(screen.getByTestId('new-board'));

    await waitFor(() => {
      const err = screen.getByTestId('create-error');
      expect(err.textContent).toBe("Couldn't create a board. Please try again.");
    });
    const button = screen.getByTestId('new-board');
    expect(button.hasAttribute('disabled')).toBe(false);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  // TC-17b: network error → same failure state
  it('TC-17b: network error shows same error message', async () => {
    mockedCreateBoard.mockResolvedValue({ kind: 'failed' });

    render(<HomePage />);
    fireEvent.click(screen.getByTestId('new-board'));

    await waitFor(() => {
      expect(screen.getByTestId('create-error')).toBeDefined();
    });
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

describe('BoardPage (TC-19, TC-20, TC-21)', () => {
  // TC-19: malformed id → NotFoundPage, checkBoard never called
  it('TC-19: malformed id renders NotFoundPage without calling checkBoard', () => {
    render(<BoardPage id="bad" />);
    expect(screen.getByText('Board not found')).toBeDefined();
    expect(mockedCheckBoard).not.toHaveBeenCalled();
  });

  // TC-20: valid but unknown id → "Opening board…" then NotFoundPage
  it('TC-20: unknown valid id shows Opening… then NotFoundPage', async () => {
    // Use a deferred promise so we can capture the checking state
    let resolveCheck!: (v: CheckResponse) => void;
    mockedCheckBoard.mockReturnValue(
      new Promise<CheckResponse>((resolve) => { resolveCheck = resolve; }),
    );

    render(<BoardPage id="abcdefghijklmnopqrstuv" />);
    // The page starts in 'checking' state
    expect(screen.getByTestId('opening-board').textContent).toContain('Opening board');

    // Resolve with not_found
    await act(async () => {
      resolveCheck({ kind: 'not_found' });
    });

    expect(screen.getByText('Board not found')).toBeDefined();
    expect(screen.getByTestId('new-board')).toBeDefined();
  });

  // TC-21: unreachable twice then exists → retry message then board rendered
  it('TC-21: unreachable then exists shows retry message then board', async () => {
    vi.useFakeTimers();

    // Deferred promises for each check
    let resolvers: Array<(v: CheckResponse) => void> = [];
    mockedCheckBoard.mockImplementation(() => {
      return new Promise<CheckResponse>((resolve) => {
        resolvers.push(resolve);
      });
    });

    render(<BoardPage id="abcdefghijklmnopqrstuv" />);

    // First check is pending - flush microtasks
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    // Initial state is 'checking' since promise hasn't resolved
    expect(screen.getByTestId('opening-board')).toBeDefined();
    expect(mockedCheckBoard).toHaveBeenCalledTimes(1);

    // Resolve first check as unreachable
    await act(async () => {
      resolvers[0]({ kind: 'unreachable' });
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.getByTestId('unreachable-message').textContent).toContain(
      'Retrying',
    );

    // Advance past first retry interval (1000ms)
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(mockedCheckBoard).toHaveBeenCalledTimes(2);

    // Resolve second check as unreachable
    await act(async () => {
      resolvers[1]({ kind: 'unreachable' });
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.getByTestId('unreachable-message')).toBeDefined();

    // Advance past second retry interval (2000ms)
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(mockedCheckBoard).toHaveBeenCalledTimes(3);

    // Resolve third check as exists
    await act(async () => {
      resolvers[2]({ kind: 'exists' });
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.getByTestId('board-ui')).toBeDefined();

    vi.useRealTimers();
  });
});

describe('NotFoundPage', () => {
  it('renders heading and guidance text', () => {
    render(<NotFoundPage />);
    expect(screen.getByText('Board not found')).toBeDefined();
    expect(
      screen.getByText('Check the link, or ask the person who shared it to send it again.'),
    ).toBeDefined();
    expect(screen.getByTestId('new-board')).toBeDefined();
  });
});
