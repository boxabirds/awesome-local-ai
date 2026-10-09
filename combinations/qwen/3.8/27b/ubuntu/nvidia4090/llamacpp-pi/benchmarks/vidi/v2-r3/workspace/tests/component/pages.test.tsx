/**
 * Component tests for the story 5 pages (share.pages state machines) with a
 * mocked api module:
 *  TC-16 New board → creating → navigate to /b/<id>
 *  TC-17 create failure (5xx and network) → exact message, retryable, no nav
 *  TC-19 malformed id → NotFoundPage, no checkBoard call (negative)
 *  TC-20 not_found → "Opening board…" → NotFoundPage with New board
 *  TC-21 unreachable x2 then exists → retrying message, backoff 1s/2s, board
 *        mounts on the 3rd check (boundary)
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOARD_CHECK_RETRY_BASE_MS } from '../../src/shared/config';
import { CREATE_FAILED_MESSAGE } from '../../src/client/pages/state';
import { HomePage } from '../../src/client/pages/HomePage';
import { BoardPage } from '../../src/client/pages/BoardPage';

// A syntactically valid board id (22 chars, base64url).
const VALID_ID = 'a'.repeat(22);

vi.mock('../../src/client/api', () => ({
  createBoardRequest: vi.fn(),
  checkBoard: vi.fn(),
}));

// Board (mounted by BoardPage on 'ready') needs a provider; a quiet fake is
// enough — the page's state machine is what is under test.
vi.mock('../../src/client/sync/connectBoard', () => ({
  connectBoard: (_doc: unknown, _boardId: string, onState: (s: string) => void) => {
    onState('connected');
    return { destroy() {} };
  },
}));

const api = await import('../../src/client/api');

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    (globalThis as Record<string, unknown>).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

beforeEach(() => {
  // Deterministic starting route for every test.
  window.history.pushState(null, '', '/');
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('share.pages: home (create)', () => {
  it('TC-16: New board → "Creating…" disabled → navigate to /b/<id>', async () => {
    vi.mocked(api.createBoardRequest).mockResolvedValue({ kind: 'created', id: VALID_ID });

    render(<HomePage />);
    const button = screen.getByRole('button', { name: 'New board' });
    fireEvent.click(button);

    // Request in flight: the button is disabled and shows the in-flight label.
    const creating = screen.getByRole('button', { name: 'Creating…' }) as HTMLButtonElement;
    expect(creating.disabled).toBe(true);

    await waitFor(() => expect(window.location.pathname).toBe(`/b/${VALID_ID}`));
  });

  it.each([
    ['a 5xx failure', vi.fn().mockResolvedValue({ kind: 'failed' as const })],
    ['a network failure', vi.fn().mockRejectedValue(new TypeError('network down'))],
  ])('TC-17: %s → exact message, button enabled, still on /', async (_label, factory) => {
    vi.mocked(api.createBoardRequest).mockImplementationOnce(factory as never);

    render(<HomePage />);
    fireEvent.click(screen.getByRole('button', { name: 'New board' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(CREATE_FAILED_MESSAGE);
    // Retryable: the button is back and enabled.
    const button = screen.getByRole('button', { name: 'New board' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    // Negative: a failed create never navigates.
    expect(window.location.pathname).toBe('/');
  });
});

describe('share.pages: board (existence check)', () => {
  it('TC-19: a malformed id renders NotFoundPage and never calls checkBoard', () => {
    render(<BoardPage id="bad" />);

    expect(screen.getByRole('heading', { name: 'Board not found' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New board' })).toBeTruthy();
    expect(api.checkBoard).not.toHaveBeenCalled();
  });

  it('TC-20: not_found → "Opening board…" then NotFoundPage with New board', async () => {
    vi.mocked(api.checkBoard).mockResolvedValue({ kind: 'not_found' });

    render(<BoardPage id={VALID_ID} />);
    // First paint, before the check resolves.
    expect(screen.getByText('Opening board…')).toBeTruthy();

    await screen.findByRole('heading', { name: 'Board not found' });
    expect(screen.getByRole('button', { name: 'New board' })).toBeTruthy();
    // The board itself never mounts.
    expect(screen.queryByRole('button', { name: 'Share' })).toBeNull();
  });

  it('TC-21: unreachable x2 then exists → retrying, 1s/2s backoff, board on the 3rd check', async () => {
    vi.useFakeTimers();
    vi.mocked(api.checkBoard)
      .mockResolvedValueOnce({ kind: 'unreachable' })
      .mockResolvedValueOnce({ kind: 'unreachable' })
      .mockResolvedValue({ kind: 'exists' });

    render(<BoardPage id={VALID_ID} />);

    // Check 1 resolves on a microtask → unreachable, next retry in 1s.
    await act(async () => {});
    expect(api.checkBoard).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Couldn't reach vidi6. Retrying…")).toBeTruthy();

    // Retry after BOARD_CHECK_RETRY_BASE_MS (1st failure → 1s).
    await act(async () => {
      vi.advanceTimersByTime(BOARD_CHECK_RETRY_BASE_MS);
    });
    expect(api.checkBoard).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Couldn't reach vidi6. Retrying…")).toBeTruthy();

    // 2nd failure → backoff doubles to 2s.
    await act(async () => {
      vi.advanceTimersByTime(BOARD_CHECK_RETRY_BASE_MS * 2);
    });
    expect(api.checkBoard).toHaveBeenCalledTimes(3);

    // Check 3 says exists → the board mounts (boundary: exactly 3 calls).
    await act(async () => {});
    expect(screen.getByRole('button', { name: 'Share' })).toBeTruthy();
    expect(api.checkBoard).toHaveBeenCalledTimes(3);
  });
});
