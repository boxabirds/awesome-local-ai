// Component tests for story 5's pages (design "share.pages": TC-16 to TC-21).
//
// These render the real `App` — the same component `main.tsx` mounts — with the
// document placed at a URL, because in this story the URL is what selects the page.
// The board API's HTTP calls are mocked (design: "with mocked api.ts"): what is
// under test is which page the visitor is shown and the exact sentence they read,
// not fetch itself. The websocket is replaced by a socket that never connects, so
// reaching a board page does not reach the network either.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import {
  App,
  atPath,
  mockBoardApi,
  settle,
  type ApiResponse,
} from './helpers/appShell.tsx';
import { newBoardId } from '../../src/shared/board-id.ts';
import { BOARD_CHECK_RETRY_BASE_MS } from '../../src/shared/config.ts';

const CREATE_FAILED = "Couldn't create a board. Please try again.";
const RATE_LIMITED = "You're creating boards too quickly. Wait a minute and try again.";
const UNREACHABLE = "Couldn't reach vidi6. Retrying…";

/** A socket that stays open-looking and never talks to a server. */
class DeadWebSocket {
  static readonly OPEN = 1;
  readyState = 0;
  binaryType = 'arraybuffer';
  constructor(public readonly url: string) {}
  addEventListener(): void {}
  removeEventListener(): void {}
  send(): void {}
  close(): void {
    this.readyState = 3;
  }
}

/** A promise the test settles by hand, to observe an in-flight request. */
function deferred(): {
  promise: Promise<ApiResponse>;
  resolve: (value: ApiResponse) => void;
} {
  let resolve!: (value: ApiResponse) => void;
  const promise = new Promise<ApiResponse>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => {
  atPath('/');
  vi.stubGlobal('WebSocket', DeadWebSocket);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  atPath('/');
});

describe('home page: creating a board (TC-16, TC-17, TC-18)', () => {
  it('TC-16 shows "Creating…" while disabled during creation, then opens /b/:id', async () => {
    const boardId = newBoardId();
    // The create request is held open by hand, so the in-flight state — the one a
    // visitor sees for a moment and a double-click must not double-spend — can be
    // asserted instead of raced past.
    const create = deferred();
    // The new board's own link check is left unanswered on purpose: this test is
    // about the navigation, not about what the next page decides.
    const unanswered = new Promise<never>(() => {});
    mockBoardApi((method) => (method === 'POST' ? create.promise : unanswered));

    render(<App />);
    const button = screen.getByTestId('create-board');
    fireEvent.click(button);

    expect(button).toBeDisabled();
    expect(button).toHaveTextContent('Creating…');
    // Nothing has been navigated to yet: the board does not exist until it answers.
    expect(window.location.pathname).toBe('/');

    create.resolve({ status: 201, body: { id: boardId } });
    await waitFor(() => expect(window.location.pathname).toBe(`/b/${boardId}`));
    // The board page runs its own link check rather than trusting the create: it is
    // asking about the id it was handed.
    expect(screen.getByTestId('board-opening')).toBeInTheDocument();
  });

  it.each([
    ['a 500 answer', () => ({ status: 500 }) as ApiResponse],
    ['no answer at all', () => ({ networkError: true }) as ApiResponse],
  ])('TC-17 explains a failed creation after %s and stays on the home page', async (_name, fail) => {
    mockBoardApi((method) => (method === 'POST' ? fail() : { status: 200 }));

    render(<App />);
    fireEvent.click(screen.getByTestId('create-board'));

    const error = await screen.findByTestId('home-error');
    expect(error).toHaveTextContent(CREATE_FAILED);
    expect(screen.getByTestId('create-board')).toBeEnabled();
    // The negative half of the requirement: no navigation on failure.
    expect(window.location.pathname).toBe('/');
    expect(screen.getByTestId('home-page')).toBeInTheDocument();
  });

  it('TC-18 names the creation limit when the answer is 429, and leaves the button enabled', async () => {
    mockBoardApi((method) => (method === 'POST' ? { status: 429 } : { status: 200 }));

    render(<App />);
    fireEvent.click(screen.getByTestId('create-board'));

    const error = await screen.findByTestId('home-error');
    expect(error).toHaveTextContent(RATE_LIMITED);
    expect(screen.getByTestId('create-board')).toBeEnabled();
    expect(window.location.pathname).toBe('/');
  });
});

describe('board page: opening a link (TC-19, TC-20, TC-21)', () => {
  it('TC-19 shows Board not found for a path that cannot be a board id, without asking the server', async () => {
    const api = mockBoardApi(() => ({ status: 200 }));

    atPath('/b/bad');
    render(<App />);

    expect(screen.getByTestId('board-not-found')).toBeInTheDocument();
    expect(screen.getByTestId('create-new-board')).toBeInTheDocument();
    await settle();
    // The assertion that matters: a malformed id is never looked up, so it can
    // never be turned into a board by being visited.
    expect(api).not.toHaveBeenCalled();
    expect(document.querySelector('[data-testid="canvas-layer"]')).toBeNull();
  });

  it('TC-20 says "Opening board…" and then Board not found for a board that is not there', async () => {
    const boardId = newBoardId();
    mockBoardApi(() => ({ status: 404 }));

    atPath(`/b/${boardId}`);
    render(<App />);

    const opening = screen.getByTestId('board-opening');
    expect(opening).toHaveTextContent('Opening board…');
    expect(opening).toHaveAttribute('role', 'status');
    // No board is mounted while the answer is still unknown.
    expect(document.querySelector('[data-testid="canvas-layer"]')).toBeNull();

    await waitFor(() => expect(screen.getByTestId('board-not-found')).toBeInTheDocument());
    expect(screen.getByTestId('create-new-board')).toBeInTheDocument();
    expect(screen.queryByTestId('board-opening')).toBeNull();
  });

  it('TC-21 retries an unreachable service on a doubling schedule and opens the board once it answers', async () => {
    const boardId = newBoardId();
    let calls = 0;
    vi.useFakeTimers();
    // The first two checks get no answer at all; the third one finds the board.
    mockBoardApi((): ApiResponse => {
      calls++;
      return calls <= 2 ? { networkError: true } : { status: 200 };
    });

    atPath(`/b/${boardId}`);
    render(<App />);

    await act(async () => {
      await settle(4);
    });
    expect(calls).toBe(1);
    expect(screen.getByTestId('board-unreachable')).toHaveTextContent(UNREACHABLE);

    // The first retry is exactly BOARD_CHECK_RETRY_BASE_MS away, not earlier.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BOARD_CHECK_RETRY_BASE_MS - 1);
    });
    expect(calls).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await settle(4);
    });
    expect(calls).toBe(2);

    // The second retry waits twice as long (the boundary the design names).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BOARD_CHECK_RETRY_BASE_MS * 2 - 1);
    });
    expect(calls).toBe(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await settle(4);
    });

    // Three requests in total, and the board is open — no reload was needed.
    expect(calls).toBe(3);
    expect(screen.getByTestId('app')).toBeInTheDocument();
    expect(screen.queryByTestId('board-unreachable')).toBeNull();
  });
});
