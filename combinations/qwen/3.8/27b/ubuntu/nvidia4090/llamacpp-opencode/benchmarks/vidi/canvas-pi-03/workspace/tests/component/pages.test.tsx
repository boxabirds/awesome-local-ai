/**
 * Story 5 — share.pages component tests (TC-16..TC-21).
 *
 * The page state machines are tested directly (HomePage / BoardPage) with
 * `@/client/api` mocked and the heavy board UI stubbed, so the tests cover
 * exactly the navigation, messaging and retry behaviour of story 5.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { newBoardId } from '@/shared/board-id';
import { BOARD_CHECK_RETRY_BASE_MS } from '@/shared/config';
import { HomePage } from '@/client/pages/HomePage';
import { BoardPage } from '@/client/pages/BoardPage';
import { checkBoard, createBoardRequest } from '@/client/api';
import { CREATE_FAILED_TEXT, RATE_LIMITED_TEXT } from '@/client/pages/useCreateBoard';

vi.mock('@/client/api', () => ({
  checkBoard: vi.fn(),
  createBoardRequest: vi.fn(),
}));

vi.mock('@/client/board/Board', () => ({
  Board: () => <div data-testid="board-mock" />,
  canEdit: (s: string) => s === 'connected',
}));

const mockedCheckBoard = vi.mocked(checkBoard);
const mockedCreate = vi.mocked(createBoardRequest);

/** Flush pending microtasks (mocked api promises) inside act. */
async function flush(): Promise<void> {
  await act(async () => {});
}

beforeEach(() => {
  vi.clearAllMocks();
  window.history.pushState({}, '', '/');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('share.pages (story 5)', () => {
  it('TC-16: click Create -> "Creating…" disabled -> navigate to /b/<id>', async () => {
    const id = newBoardId();
    mockedCreate.mockResolvedValue({ kind: 'created', id });
    render(<HomePage />);

    const btn = screen.getByTestId('create-board-button');
    expect(btn).toBeEnabled();
    fireEvent.click(btn);

    // In flight: disabled with the "Creating…" label.
    expect(btn).toBeDisabled();
    expect(btn.textContent).toBe('Creating…');

    await flush();
    expect(window.location.pathname).toBe('/b/' + id);
  });

  it('TC-17: api failed (500 and network) -> exact failure message, button enabled, no navigation', async () => {
    // Run 1: the server answered 500 -> api maps it to { kind: 'failed' }.
    mockedCreate.mockResolvedValue({ kind: 'failed' });
    render(<HomePage />);
    const btn = screen.getByTestId('create-board-button');
    fireEvent.click(btn);
    await flush();

    expect(screen.getByTestId('create-error')).toHaveTextContent(CREATE_FAILED_TEXT);
    expect(screen.getByRole('alert')).toHaveTextContent(CREATE_FAILED_TEXT);
    expect(btn).toBeEnabled();
    expect(btn.textContent).toBe('Create a board');
    expect(window.location.pathname).toBe('/'); // negative: no navigation

    // Run 2: the request never completed (network) -> same message.
    mockedCreate.mockRejectedValue(new Error('network down'));
    fireEvent.click(btn);
    await flush();

    expect(screen.getByTestId('create-error')).toHaveTextContent(CREATE_FAILED_TEXT);
    expect(btn).toBeEnabled();
    expect(window.location.pathname).toBe('/');
  });

  it('TC-18: rate limited -> exact rate-limit message, button enabled', async () => {
    mockedCreate.mockResolvedValue({ kind: 'rate_limited' });
    render(<HomePage />);
    const btn = screen.getByTestId('create-board-button');
    fireEvent.click(btn);
    await flush();

    expect(screen.getByTestId('create-error')).toHaveTextContent(RATE_LIMITED_TEXT);
    expect(btn).toBeEnabled();
    expect(window.location.pathname).toBe('/');
  });

  it('TC-19: malformed id -> NotFoundPage and checkBoard is never called', async () => {
    render(<BoardPage id="bad" />);

    // No "Opening board…" phase: the id is rejected locally.
    expect(screen.queryByTestId('board-loading')).toBeNull();
    expect(screen.getByTestId('not-found-page')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create a new board' })).toBeTruthy();
    expect(mockedCheckBoard).not.toHaveBeenCalled(); // negative
  });

  it('TC-20: not_found -> "Opening board…" then NotFoundPage with Create a new board', async () => {
    const id = newBoardId();
    let release: (r: { kind: 'not_found' }) => void = () => {};
    mockedCheckBoard.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );

    render(<BoardPage id={id} />);
    // The checking phase is visible while the request is in flight.
    const loading = screen.getByTestId('board-loading');
    expect(loading).toHaveAttribute('role', 'status');
    expect(loading.textContent).toBe('Opening board…');
    expect(screen.queryByTestId('not-found-page')).toBeNull();

    await act(async () => {
      release({ kind: 'not_found' });
    });

    expect(screen.getByTestId('not-found-page')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create a new board' })).toBeTruthy();
    expect(mockedCheckBoard).toHaveBeenCalledTimes(1);
  });

  it('TC-21: unreachable twice then exists -> retry after base and 2x base; 3 calls total', async () => {
    vi.useFakeTimers();
    const id = newBoardId();
    const results = [
      { kind: 'unreachable' as const },
      { kind: 'unreachable' as const },
      { kind: 'exists' as const },
    ];
    mockedCheckBoard.mockImplementation(async () => (results.shift() ?? { kind: 'exists' }));

    render(<BoardPage id={id} />);
    // First check resolves unreachable: the retrying status is shown.
    await act(async () => {});
    expect(screen.getByTestId('board-unreachable')).toHaveTextContent(
      "Couldn't reach vidi6. Retrying…",
    );
    expect(mockedCheckBoard).toHaveBeenCalledTimes(1);

    // Retry 1 after BOARD_CHECK_RETRY_BASE_MS.
    await act(async () => {
      vi.advanceTimersByTime(BOARD_CHECK_RETRY_BASE_MS);
    });
    expect(mockedCheckBoard).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('board-unreachable')).toBeTruthy();

    // Retry 2 after 2 x base (exponential backoff).
    await act(async () => {
      vi.advanceTimersByTime(BOARD_CHECK_RETRY_BASE_MS * 2);
    });
    expect(mockedCheckBoard).toHaveBeenCalledTimes(3);
    // The board renders and the retrying status is gone.
    expect(screen.getByTestId('board-mock')).toBeTruthy();
    expect(screen.queryByTestId('board-unreachable')).toBeNull();
  });
});
