/**
 * Task 6: Component tests for BoardPage (TC-19, TC-20, TC-21).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
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
    let resolveCheck: ((v: { kind: 'not_found' }) => void) | null = null;
    const checkPromise = new Promise<{ kind: 'not_found' }>((resolve) => {
      resolveCheck = resolve;
    });
    mockImpl = (_id: string) => checkPromise;

    render(<BoardPage id="abc123def456ghi789jklm" />);

    // Initial state: checking
    expect(screen.getByText(/Opening board/)).toBeTruthy();

    // Resolve the check response
    resolveCheck!({ kind: 'not_found' });

    // Flush promises so setState triggers re-render
    await act(async () => {});

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
    const resolvers: Array<((result: CheckResponse) => void)> = [];

    mockImpl = (_id: string) => {
      callCount++;
      return new Promise<CheckResponse>((resolve) => {
        resolvers.push(resolve);
      });
    };

    render(<BoardPage id="abc123def456ghi789jklm" />);

    // First check fires immediately via useEffect — resolve it
    resolvers[0]!({ kind: 'unreachable' });

    // Flush promises so setState(unreachable) re-renders
    await act(async () => {});

    expect(callCount).toBe(1);
    expect(screen.getByText(/Couldn't reach vidi6/)).toBeTruthy();

    // BOARD_CHECK_RETRY_BASE_MS = 1000ms for attempt 0 → schedule second call
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(callCount).toBe(2);

    // Resolve second as unreachable
    resolvers[1]!({ kind: 'unreachable' });
    await act(async () => {});

    expect(screen.getByText(/Couldn't reach vidi6/)).toBeTruthy();

    // 2×BOARD_CHECK_RETRY_BASE_MS = 2000ms for attempt 1 → schedule third call
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(callCount).toBe(3);

    // Resolve third as exists → shows board
    resolvers[2]!({ kind: 'exists' });
    await act(async () => {});

    // Should now show the board (from mocked BoardRoot)
    expect(screen.getByTestId('board-root')).toBeTruthy();
  });
});
