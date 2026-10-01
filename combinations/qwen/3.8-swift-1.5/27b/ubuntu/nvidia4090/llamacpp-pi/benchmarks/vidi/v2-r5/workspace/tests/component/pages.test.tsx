// @vitest-environment jsdom
// tests/component/pages.test.tsx
// Component tests for Home, Board, and NotFound pages (TC-16, TC-17, TC-19 to TC-21).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { HomePage } from '../../src/client/pages/HomePage';
import { BoardPage } from '../../src/client/pages/BoardPage';
import { newBoardId } from '../../src/shared/board-id';
import { BOARD_CHECK_RETRY_BASE_MS } from '../../src/shared/config';

// Mock the api module
vi.mock('../../src/client/api', () => ({
  createBoardRequest: vi.fn(),
  checkBoard: vi.fn(),
}));

// Mock the router module
vi.mock('../../src/client/router', () => ({
  navigate: vi.fn(),
  useRoute: vi.fn(),
}));

// Mock BoardContent to avoid needing the full board setup
vi.mock('../../src/client/pages/BoardContent', () => ({
  BoardContent: ({ boardId }: { boardId: string }) => (
    <div data-testid="board-content">Board {boardId}</div>
  ),
}));

// Mock SharePanel
vi.mock('../../src/client/share/SharePanel', () => ({
  SharePanel: ({ boardId }: { boardId: string }) => (
    <div data-testid="share-panel">Share {boardId}</div>
  ),
}));

import { createBoardRequest, checkBoard } from '../../src/client/api';
import { navigate } from '../../src/client/router';

const mockCreate = vi.mocked(createBoardRequest);
const mockCheck = vi.mocked(checkBoard);
const mockNavigate = vi.mocked(navigate);

// Helper to flush microtasks
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('share.pages: Home page (TC-16, TC-17)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  // TC-16: click New board → "Creating…" disabled → navigate to /b/<id>
  it('TC-16: New board creates and navigates', async () => {
    mockCreate.mockResolvedValue({ kind: 'created', id: 'testboardid1234567890ab' });

    render(<HomePage />);

    const btn = screen.getByRole('button', { name: 'New board' });
    expect((btn as HTMLButtonElement).disabled).toBe(false);

    act(() => {
      fireEvent.click(btn);
    });

    // Button should show "Creating…" and be disabled
    const creatingBtn = screen.getByRole('button', { name: 'Creating…' });
    expect((creatingBtn as HTMLButtonElement).disabled).toBe(true);

    // Wait for navigation
    await flush();
    expect(mockNavigate).toHaveBeenCalledWith('/b/testboardid1234567890ab');
  });

  // TC-17: api failed → exact failure message, button enabled, still on /
  it('TC-17a: creation failure (500) shows message and re-enables button', async () => {
    mockCreate.mockResolvedValue({ kind: 'failed' });

    render(<HomePage />);

    const btn = screen.getByRole('button', { name: 'New board' });
    act(() => {
      fireEvent.click(btn);
    });

    await flush();

    expect(screen.getByText("Couldn't create a board. Please try again.")).toBeTruthy();

    // Button should be enabled again
    const reEnabledBtn = screen.getByRole('button', { name: 'New board' });
    expect((reEnabledBtn as HTMLButtonElement).disabled).toBe(false);

    // Should NOT have navigated
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('TC-17b: creation failure (network error) shows message and re-enables button', async () => {
    mockCreate.mockResolvedValue({ kind: 'failed' });

    render(<HomePage />);

    const btn = screen.getByRole('button', { name: 'New board' });
    act(() => {
      fireEvent.click(btn);
    });

    await flush();

    expect(screen.getByText("Couldn't create a board. Please try again.")).toBeTruthy();

    const reEnabledBtn = screen.getByRole('button', { name: 'New board' });
    expect((reEnabledBtn as HTMLButtonElement).disabled).toBe(false);
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

describe('share.pages: Board page (TC-19, TC-20, TC-21)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  // TC-19: /b/bad → NotFoundPage; checkBoard not called
  it('TC-19: malformed id shows NotFoundPage without API call', async () => {
    render(<BoardPage id="bad" />);
    await flush();

    expect(screen.getByText('Board not found')).toBeTruthy();
    expect(mockCheck).not.toHaveBeenCalled();
  });

  // TC-20: not_found → "Opening board…" then NotFoundPage with New board button
  it('TC-20: unknown valid id shows checking then not found', async () => {
    const validId = newBoardId();
    mockCheck.mockResolvedValue({ kind: 'not_found' });

    const { unmount } = render(<BoardPage id={validId} />);

    // Should show "Opening board…" initially (synchronous render)
    expect(screen.getByText('Opening board…')).toBeTruthy();

    // Flush the async check
    await flush();

    expect(screen.getByText('Board not found')).toBeTruthy();

    // Should have a New board button
    expect(screen.getByRole('button', { name: 'New board' })).toBeTruthy();

    unmount();
  });

  // TC-21: unreachable twice then exists → retry message → board; 3 calls total
  it('TC-21: unreachable then unreachable then exists → board renders', async () => {
    vi.useFakeTimers();
    const validId = newBoardId();
    let callCount = 0;
    mockCheck.mockImplementation(() => {
      callCount++;
      if (callCount <= 2) {
        return Promise.resolve({ kind: 'unreachable' as const });
      }
      return Promise.resolve({ kind: 'exists' as const });
    });

    const { unmount } = render(<BoardPage id={validId} />);

    // Should show "Opening board…" initially
    expect(screen.getByText('Opening board…')).toBeTruthy();

    // First check completes → unreachable
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText("Couldn't reach vidi6. Retrying…")).toBeTruthy();
    expect(callCount).toBe(1);

    // Advance by BOARD_CHECK_RETRY_BASE_MS (1000ms) for first retry
    act(() => {
      vi.advanceTimersByTime(BOARD_CHECK_RETRY_BASE_MS);
    });

    // Second check completes → unreachable again
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(callCount).toBe(2);

    // Advance by 2 * BOARD_CHECK_RETRY_BASE_MS (2000ms) for second retry
    act(() => {
      vi.advanceTimersByTime(BOARD_CHECK_RETRY_BASE_MS * 2);
    });

    // Third check completes → exists
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId('board-content')).toBeTruthy();
    expect(callCount).toBe(3);

    unmount();
    vi.useRealTimers();
  });
});
