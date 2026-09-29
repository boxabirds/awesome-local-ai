import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { HomePage } from '@client/pages/HomePage';
import { BoardPage } from '@client/pages/BoardPage';
import { checkBoard } from '@client/api';
import { CREATE_FAILED_MESSAGE } from '@client/pages/state';
import { BOARD_CHECK_RETRY_BASE_MS } from '@shared/config';

// Mock the board existence check (share.pages state machine tests); keep the
// real createBoardRequest so the fetch-level failure mapping is exercised.
vi.mock('@client/api', async () => {
  const actual = await vi.importActual<typeof import('@client/api')>('@client/api');
  return { ...actual, checkBoard: vi.fn() };
});

// The stories 1–4 board mounts a canvas/WebSocket; in jsdom we only need the
// ready state to be observable.
vi.mock('@client/Board', () => ({
  Board: (props: { boardId: string }) => (
    <div data-testid="board-mount">{props.boardId}</div>
  ),
}));

const mockCheckBoard = vi.mocked(checkBoard);
const VALID_ID = 'a'.repeat(22);

beforeEach(() => {
  // Each test starts at the home path.
  window.history.pushState(null, '', '/');
  mockCheckBoard.mockReset();
  vi.unstubAllGlobals();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('TC-16: New board → Creating… → navigate to /b/<id>', () => {
  it('click New board shows disabled "Creating…", then navigates to the new board', async () => {
    const newId = 'b'.repeat(22);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ id: newId }), { status: 201 }),
      ),
    );

    render(<HomePage />);
    const button = screen.getByTestId('new-board');

    fireEvent.click(button);

    // Creating: label changes and the button is disabled.
    expect(button).toHaveTextContent('Creating…');
    expect(button).toBeDisabled();

    // Created: navigates to /b/<id>.
    await act(async () => {});
    expect(window.location.pathname).toBe(`/b/${newId}`);
  });
});

describe('TC-17: create failure (500 and network) stays on home (negative)', () => {
  async function runCreateFailure(fetchImpl: () => Promise<Response>) {
    vi.stubGlobal('fetch', fetchImpl);
    render(<HomePage />);
    const button = screen.getByTestId('new-board');

    fireEvent.click(button);
    expect(button).toHaveTextContent('Creating…');
    expect(button).toBeDisabled();

    await act(async () => {});

    // Exact failure message, button re-enabled, still on "/".
    expect(screen.getByTestId('create-error')).toHaveTextContent(CREATE_FAILED_MESSAGE);
    expect(button).toHaveTextContent('New board');
    expect(button).toBeEnabled();
    expect(window.location.pathname).toBe('/');
    cleanup();
  }

  it('500 response → failure message, no navigation', async () => {
    await runCreateFailure(() =>
      Promise.resolve(new Response('Internal Server Error', { status: 500 })),
    );
  });

  it('network error → failure message, no navigation', async () => {
    await runCreateFailure(() => Promise.reject(new TypeError('network down')));
  });
});

describe('TC-19: malformed id → Board not found, no request (negative)', () => {
  it('renders NotFoundPage and never calls checkBoard', async () => {
    render(<BoardPage id="bad" />);

    expect(screen.getByTestId('not-found-heading')).toHaveTextContent('Board not found');
    // The page must offer a way forward.
    expect(screen.getByTestId('new-board')).toBeEnabled();

    await act(async () => {});
    expect(mockCheckBoard).not.toHaveBeenCalled();
  });
});

describe('TC-20: not_found → Opening board… then Board not found', () => {
  it('shows the checking state, then the not-found page with New board', async () => {
    let resolveCheck!: (r: { kind: 'not_found' }) => void;
    mockCheckBoard.mockReturnValue(
      new Promise((resolve) => {
        resolveCheck = resolve;
      }),
    );

    render(<BoardPage id={VALID_ID} />);

    // Checking state while the request is in flight.
    expect(screen.getByTestId('opening-board')).toHaveTextContent('Opening board…');
    expect(mockCheckBoard).toHaveBeenCalledTimes(1);
    expect(mockCheckBoard).toHaveBeenCalledWith(VALID_ID);

    await act(async () => {
      resolveCheck({ kind: 'not_found' });
    });

    expect(screen.getByTestId('not-found-heading')).toHaveTextContent('Board not found');
    expect(screen.getByTestId('new-board')).toHaveTextContent('New board');
    expect(screen.queryByTestId('opening-board')).toBeNull();
  });
});

describe('TC-21: unreachable twice then exists → board, with backoff (boundary)', () => {
  it('retries after BOARD_CHECK_RETRY_BASE_MS then 2×; 3 calls total', async () => {
    vi.useFakeTimers();

    mockCheckBoard
      .mockResolvedValueOnce({ kind: 'unreachable' })
      .mockResolvedValueOnce({ kind: 'unreachable' })
      .mockResolvedValueOnce({ kind: 'exists' });

    render(<BoardPage id={VALID_ID} />);

    // Initial check in flight → checking.
    expect(screen.getByTestId('opening-board')).toBeTruthy();

    await act(async () => {});
    expect(mockCheckBoard).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('unreachable')).toHaveTextContent(
      "Couldn't reach vidi6. Retrying…",
    );

    // First backoff: BOARD_CHECK_RETRY_BASE_MS.
    await act(async () => {
      vi.advanceTimersByTime(BOARD_CHECK_RETRY_BASE_MS);
    });
    expect(mockCheckBoard).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('unreachable')).toBeTruthy();

    // Second backoff: 2 × BOARD_CHECK_RETRY_BASE_MS.
    await act(async () => {
      vi.advanceTimersByTime(2 * BOARD_CHECK_RETRY_BASE_MS);
    });
    expect(mockCheckBoard).toHaveBeenCalledTimes(3);

    // Board is open (ready state), no more retries scheduled.
    expect(screen.getByTestId('board-mount')).toHaveTextContent(VALID_ID);
    expect(screen.queryByTestId('unreachable')).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(BOARD_CHECK_RETRY_BASE_MS * 10);
    });
    expect(mockCheckBoard).toHaveBeenCalledTimes(3);
  });
});
