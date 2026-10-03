// Component tests for share.pages state machines (mocked api.ts)
// and share.share_panel (stubbed clipboard, fake timers).
// TC-16, TC-17, TC-19 to TC-25.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BOARD_CHECK_RETRY_BASE_MS, LINK_COPIED_MS } from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';

// Mock the api module.
vi.mock('../../src/client/api', () => ({
  createBoardRequest: vi.fn(),
  checkBoard: vi.fn(),
}));

// Mock the router's navigate function.
vi.mock('../../src/client/router', async () => {
  const actual = await vi.importActual<typeof import('../../src/client/router')>(
    '../../src/client/router',
  );
  return {
    ...actual,
    navigate: vi.fn(),
  };
});

import { createBoardRequest, checkBoard } from '../../src/client/api';
import { navigate } from '../../src/client/router';
import { HomePage } from '../../src/client/pages/HomePage';
import { BoardPage } from '../../src/client/pages/BoardPage';
import { SharePanel, boardLink } from '../../src/client/share/SharePanel';

const mockCreateBoardRequest = vi.mocked(createBoardRequest);
const mockCheckBoard = vi.mocked(checkBoard);
const mockNavigate = vi.mocked(navigate);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// --- TC-16: click New board → "Creating…" disabled → navigate to /b/<id> ---
describe('TC-16: HomePage create success', () => {
  it('shows Creating… disabled then navigates to /b/<id>', async () => {
    const user = userEvent.setup();
    const boardId = newBoardId();
    mockCreateBoardRequest.mockResolvedValue({ kind: 'created', id: boardId });

    render(<HomePage />);

    const btn = screen.getByTestId('new-board-button');
    expect(btn).toBeEnabled();
    expect(btn.textContent).toBe('New board');

    const clickPromise = user.click(btn);
    // After click, button should show "Creating…" and be disabled.
    await waitFor(() => {
      expect(btn.textContent).toBe('Creating…');
      expect(btn).toBeDisabled();
    });

    await clickPromise;
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(`/b/${boardId}`);
    });
  });
});

// --- TC-17: api failed (500 and network, 2 runs) → exact failure message, button enabled, still on / ---
describe('TC-17: HomePage create failure', () => {
  it('shows failure message, button re-enabled, no navigation (500)', async () => {
    const user = userEvent.setup();
    mockCreateBoardRequest.mockResolvedValue({ kind: 'failed' });

    render(<HomePage />);

    const btn = screen.getByTestId('new-board-button');
    const clickPromise = user.click(btn);
    await clickPromise;

    await waitFor(() => {
      expect(screen.getByTestId('home-error').textContent).toBe(
        "Couldn't create a board. Please try again.",
      );
    });
    expect(btn).toBeEnabled();
    expect(btn.textContent).toBe('New board');
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('shows failure message, button re-enabled, no navigation (network error)', async () => {
    const user = userEvent.setup();
    // Simulate network error: the mock returns 'failed' (api.ts catches and returns failed).
    mockCreateBoardRequest.mockResolvedValue({ kind: 'failed' });

    render(<HomePage />);

    const btn = screen.getByTestId('new-board-button');
    const clickPromise = user.click(btn);
    await clickPromise;

    await waitFor(() => {
      expect(screen.getByTestId('home-error').textContent).toBe(
        "Couldn't create a board. Please try again.",
      );
    });
    expect(btn).toBeEnabled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

// --- TC-19: /b/bad → NotFoundPage; checkBoard never called ---
describe('TC-19: BoardPage with malformed id', () => {
  it('shows NotFoundPage without calling checkBoard', async () => {
    render(<BoardPage id="bad" />);

    await waitFor(() => {
      expect(screen.getByTestId('not-found-page')).toBeDefined();
    });
    expect(mockCheckBoard).not.toHaveBeenCalled();
  });
});

// --- TC-20: not_found → "Opening board…" then NotFoundPage with New board button ---
describe('TC-20: BoardPage not found', () => {
  it('shows Opening board… then NotFoundPage', async () => {
    const boardId = newBoardId();
    mockCheckBoard.mockResolvedValue({ kind: 'not_found' });

    render(<BoardPage id={boardId} />);

    // Initially shows "Opening board…"
    expect(screen.getByTestId('board-loading').textContent).toBe('Opening board…');

    await waitFor(() => {
      expect(screen.getByTestId('not-found-page')).toBeDefined();
    });
    // NotFoundPage has a New board button.
    expect(screen.getByTestId('new-board-button')).toBeDefined();
  });
});

// --- TC-21: unreachable twice then exists → retry message → board; 3 calls total ---
describe('TC-21: BoardPage unreachable then success', () => {
  it('retries with backoff then shows board', async () => {
    vi.useFakeTimers();
    const boardId = newBoardId();

    // First two calls return unreachable, third returns exists.
    mockCheckBoard
      .mockResolvedValueOnce({ kind: 'unreachable' })
      .mockResolvedValueOnce({ kind: 'unreachable' })
      .mockResolvedValueOnce({ kind: 'exists' });

    render(<BoardPage id={boardId} />);

    // Initially shows "Opening board…"
    expect(screen.getByTestId('board-loading').textContent).toBe('Opening board…');

    // Let the first checkBoard promise resolve.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId('board-unreachable').textContent).toBe(
      "Couldn't reach vidi6. Retrying…",
    );
    expect(mockCheckBoard).toHaveBeenCalledTimes(1);

    // Advance by BOARD_CHECK_RETRY_BASE_MS (first backoff = 1000ms).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BOARD_CHECK_RETRY_BASE_MS);
    });
    expect(mockCheckBoard).toHaveBeenCalledTimes(2);

    // Advance by 2 * BOARD_CHECK_RETRY_BASE_MS (second backoff = 2000ms).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BOARD_CHECK_RETRY_BASE_MS * 2);
    });
    expect(mockCheckBoard).toHaveBeenCalledTimes(3);

    // Board is now ready.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId('board-page')).toBeDefined();
  });
});

// --- TC-22: writeText resolves → "Link copied" visible at LINK_COPIED_MS - 1, reverted at LINK_COPIED_MS ---
describe('TC-22: SharePanel copy success', () => {
  it('shows Link copied for LINK_COPIED_MS then reverts', async () => {
    vi.useFakeTimers();
    const boardId = newBoardId();

    // Stub clipboard.
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      writable: true,
      configurable: true,
    });

    render(<SharePanel boardId={boardId} />);

    // Open the panel with a direct click (avoid userEvent + fake timers issues).
    act(() => {
      screen.getByTestId('share-button').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const dialog = screen.getByTestId('share-dialog');
    expect(dialog).toBeDefined();

    // The link field shows the full link.
    const input = screen.getByTestId('share-link-input') as HTMLInputElement;
    const expectedLink = boardLink(window.location.origin, boardId);
    expect(input.value).toBe(expectedLink);

    // Click Copy link.
    const copyBtn = screen.getByTestId('copy-link-button');
    act(() => {
      copyBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // Let the async writeText promise resolve.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // writeText called with the full link.
    expect(writeText).toHaveBeenCalledWith(expectedLink);

    // "Link copied" is visible.
    expect(copyBtn.textContent).toBe('Link copied ✓');

    // At LINK_COPIED_MS - 1, still visible.
    act(() => {
      vi.advanceTimersByTime(LINK_COPIED_MS - 1);
    });
    expect(copyBtn.textContent).toBe('Link copied ✓');

    // At exactly LINK_COPIED_MS, reverts.
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(copyBtn.textContent).toBe('Copy link');
  });
});

// --- TC-23: writeText rejects → input fully selected, manual-copy message ---
describe('TC-23: SharePanel clipboard rejected', () => {
  it('shows manual-copy message and selects input', async () => {
    const boardId = newBoardId();
    const user = userEvent.setup();

    const writeText = vi.fn().mockRejectedValue(new Error('Permission denied'));
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      writable: true,
      configurable: true,
    });

    render(<SharePanel boardId={boardId} />);

    await user.click(screen.getByTestId('share-button'));
    const copyBtn = screen.getByTestId('copy-link-button');
    await user.click(copyBtn);

    await waitFor(() => {
      expect(screen.getByTestId('manual-copy-message').textContent).toBe(
        'Press Ctrl+C (Cmd+C on Mac) to copy',
      );
    });

    // Input is focused and fully selected.
    const input = screen.getByTestId('share-link-input') as HTMLInputElement;
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
  });
});

// --- TC-24: navigator.clipboard undefined → same as TC-23 ---
describe('TC-24: SharePanel clipboard missing', () => {
  it('shows manual-copy message when clipboard API is missing', async () => {
    const boardId = newBoardId();
    const user = userEvent.setup();

    // Remove clipboard API.
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      writable: true,
      configurable: true,
    });

    render(<SharePanel boardId={boardId} />);

    await user.click(screen.getByTestId('share-button'));
    const copyBtn = screen.getByTestId('copy-link-button');
    await user.click(copyBtn);

    await waitFor(() => {
      expect(screen.getByTestId('manual-copy-message').textContent).toBe(
        'Press Ctrl+C (Cmd+C on Mac) to copy',
      );
    });

    const input = screen.getByTestId('share-link-input') as HTMLInputElement;
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
  });
});

// --- TC-25: Escape closes; outside click closes; focus returns to Share button ---
describe('TC-25: SharePanel close behaviour', () => {
  it('closes on Escape and returns focus to Share button', async () => {
    const boardId = newBoardId();
    const user = userEvent.setup();

    render(<SharePanel boardId={boardId} />);

    const shareBtn = screen.getByTestId('share-button');
    await user.click(shareBtn);
    expect(screen.getByTestId('share-dialog')).toBeDefined();

    // Press Escape.
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByTestId('share-dialog')).toBeNull();
    });
    // Focus returns to Share button.
    expect(shareBtn).toHaveFocus();
  });

  it('closes on outside click and returns focus to Share button', async () => {
    const boardId = newBoardId();
    const user = userEvent.setup();

    render(
      <div>
        <SharePanel boardId={boardId} />
        <button data-testid="outside-btn">Outside</button>
      </div>,
    );

    const shareBtn = screen.getByTestId('share-button');
    await user.click(shareBtn);
    expect(screen.getByTestId('share-dialog')).toBeDefined();

    // Click outside.
    await user.click(screen.getByTestId('outside-btn'));
    await waitFor(() => {
      expect(screen.queryByTestId('share-dialog')).toBeNull();
    });
    // Focus is deferred (setTimeout 0) to avoid conflict with click focus.
    await waitFor(() => {
      expect(shareBtn).toHaveFocus();
    });
  });
});
