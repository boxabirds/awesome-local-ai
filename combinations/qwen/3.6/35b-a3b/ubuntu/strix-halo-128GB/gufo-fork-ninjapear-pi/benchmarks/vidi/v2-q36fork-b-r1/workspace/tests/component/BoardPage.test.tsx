/**
 * Task 6: Component tests for BoardPage (TC-19, TC-20, TC-21).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { BoardPage } from '@/client/pages/BoardPage';
import type { CheckResponse } from '@/client/api';

// Mock api.ts — boardId parameter captured in closure
let mockImpl: ((id: string) => Promise<CheckResponse>) | null = null;

vi.mock('@/client/api', () => ({
  checkBoard: (id: string) => {
    if (mockImpl) return mockImpl(id);
    return Promise.resolve({ kind: 'not_found' as const });
  },
}));

// Also mock connectBoard / BoardRoot to avoid WebSocket in jsdom
vi.mock('@/client/board/BoardRoot', () => ({
  BoardRoot: ({ boardId }: { boardId: string }) => <div data-testid="board-root">{boardId}</div>,
}));

vi.mock('@/shared/board-id', () => ({
  isValidBoardId: (id: string) => id.length === 22 && /^[A-Za-z0-9_-]+$/.test(id),
}));

describe('BoardPage', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  // ---- TC-19: malformed board id → NotFoundPage, no API call ----
  it('TC-19: /b/bad → NotFoundPage; checkBoard never called (negative)', () => {
    mockImpl = null;
    render(<BoardPage id="bad" />);

    expect(screen.getByText('Board not found')).toBeTruthy();
    expect(mockImpl).toBeNull();
  });

  // ---- TC-20: not_found → Opening board… then Board not found ----
  it('TC-20: valid id with exists=false → "Opening board…" then NotFoundPage with New board button', async () => {
    const resultPromise = new Promise<{ kind: 'not_found' }>(resolve => {
      setTimeout(() => resolve({ kind: 'not_found' }), 0);
    });
    mockImpl = (_id: string) => resultPromise;

    render(<BoardPage id="abc123def456ghi789jklm" />);

    // Initial state: checking
    expect(screen.getByText(/Opening board/)).toBeTruthy();

    // Resolve the promise via fake timer
    await vi.runAllTimersAsync();

    // After result: not found
    expect(screen.queryByText(/Opening board/)).toBeNull();
    expect(screen.getByText('Board not found')).toBeTruthy();

    // Verify New board button present
    const newBoardBtn = screen.getByRole('button', { name: /New board/i });
    expect(newBoardBtn).toBeTruthy();
  });

  // ---- TC-21: unreachable twice then exists → retry with backoff ----
  it('TC-21: unreachable→unreachable→exists → retry after BASE_MS, then 2×BASE_MS; 3 calls total', async () => {
    let callCount = 0;
    mockImpl = (_id: string) => {
      callCount++;
      if (callCount <= 2) {
        return new Promise(r => setTimeout(() => r({ kind: 'unreachable' as const }), 0));
      }
      return new Promise(r => setTimeout(() => r({ kind: 'exists' as const }), 0));
    };

    render(<BoardPage id="abc123def456ghi789jklm" />);

    // Initial check fires immediately (sync promise chain + setTimeout(0))
    await vi.advanceTimersByTimeAsync(1);

    expect(callCount).toBe(1);
    expect(screen.getByText(/Couldn't reach vidi6/)).toBeTruthy();

    // BOARD_CHECK_RETRY_BASE_MS = 1000 → second call fires
    await vi.advanceTimersByTimeAsync(1000);

    expect(callCount).toBe(2);
    expect(screen.getByText(/Couldn't reach vidi6/)).toBeTruthy();

    // 2×BOARD_CHECK_RETRY_BASE_MS = 1000 → third call fires and returns exists
    await vi.advanceTimersByTimeAsync(1000);

    expect(callCount).toBe(3);

    // Should now show the board (from mocked BoardRoot)
    expect(screen.getByTestId('board-root')).toBeTruthy();
  });
});
