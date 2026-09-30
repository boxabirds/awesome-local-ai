import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { BoardPage } from '@client/pages/BoardPage';
import { nextBoardPageState } from '@client/pages/state';
import * as api from '@client/api';
import { BOARD_CHECK_RETRY_BASE_MS, RECONNECT_MAX_BACKOFF_MS } from '@shared/config';

vi.mock('@client/api');
vi.mock('@client/App', () => ({
  Board: ({ boardId }: { boardId: string }) => (
    <div data-testid="board-ui">{boardId}</div>
  ),
}));
vi.mock('@client/share/SharePanel', () => ({
  SharePanel: () => <div data-testid="share-panel" />,
}));

const VALID = 'abcdefghij0123456789AB'; // 22 chars, valid

beforeEach(() => {
  vi.mocked(api.checkBoard).mockReset();
});

// TC-19: BoardPage shows "Opening board…" while checking; not_found for 404;
// ready (board + share) for 200.
describe('TC-19: BoardPage check states', () => {
  it('shows Opening board… while the check is pending', () => {
    vi.mocked(api.checkBoard).mockImplementation(() => new Promise(() => {}));
    render(<BoardPage id={VALID} />);
    expect(screen.getByText('Opening board…')).toBeInTheDocument();
    expect(screen.queryByTestId('board-ui')).not.toBeInTheDocument();
  });

  it('renders Board not found on a not_found result', async () => {
    vi.mocked(api.checkBoard).mockResolvedValue({ kind: 'not_found' });
    render(<BoardPage id={VALID} />);
    await waitFor(() => expect(screen.getByText('Board not found')).toBeInTheDocument());
    expect(screen.queryByTestId('board-ui')).not.toBeInTheDocument();
  });

  it('mounts the board and Share panel on an exists result', async () => {
    vi.mocked(api.checkBoard).mockResolvedValue({ kind: 'exists' });
    render(<BoardPage id={VALID} />);
    await waitFor(() => expect(screen.getByTestId('board-ui')).toBeInTheDocument());
    expect(screen.getByTestId('share-panel')).toBeInTheDocument();
    expect(screen.getByTestId('board-ui')).toHaveTextContent(VALID);
  });
});

// TC-20: state transitions (nextBoardPageState) + component retry with growing delay.
describe('TC-20: board page retry', () => {
  it('nextBoardPageState: exists -> ready, not_found -> not_found, unreachable -> capped backoff', () => {
    expect(nextBoardPageState({ kind: 'checking' }, { kind: 'exists' }, 0, VALID)).toEqual({
      kind: 'ready',
      boardId: VALID,
    });
    expect(nextBoardPageState({ kind: 'checking' }, { kind: 'not_found' }, 0, VALID)).toEqual({
      kind: 'not_found',
    });

    const a1 = nextBoardPageState(
      { kind: 'unreachable', attempt: 0, nextRetryMs: 0 },
      { kind: 'unreachable' },
      1,
      VALID,
    );
    expect(a1.kind).toBe('unreachable');
    expect(a1.kind === 'unreachable' && a1.nextRetryMs).toBe(BOARD_CHECK_RETRY_BASE_MS);

    const a2 = nextBoardPageState(
      { kind: 'unreachable', attempt: 1, nextRetryMs: 0 },
      { kind: 'unreachable' },
      2,
      VALID,
    );
    expect(a2.kind === 'unreachable' && a2.nextRetryMs).toBe(BOARD_CHECK_RETRY_BASE_MS * 2);

    // The retry delay is capped at RECONNECT_MAX_BACKOFF_MS.
    const big = nextBoardPageState(
      { kind: 'unreachable', attempt: 0, nextRetryMs: 0 },
      { kind: 'unreachable' },
      50,
      VALID,
    );
    expect(big.kind === 'unreachable' && big.nextRetryMs).toBe(RECONNECT_MAX_BACKOFF_MS);
  });

  it('retries with growing delay and mounts once the service returns exists', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(api.checkBoard)
        .mockResolvedValueOnce({ kind: 'unreachable' })
        .mockResolvedValueOnce({ kind: 'unreachable' })
        .mockResolvedValue({ kind: 'exists' });

      render(<BoardPage id={VALID} />);
      // First check is unreachable -> retry message.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByText("Couldn't reach vidi6. Retrying…")).toBeInTheDocument();
      expect(api.checkBoard).toHaveBeenCalledTimes(1);

      // After the first backoff (base*2) it retries -> still unreachable.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(BOARD_CHECK_RETRY_BASE_MS * 2);
      });
      expect(api.checkBoard).toHaveBeenCalledTimes(2);

      // After the second backoff (base*4) it retries -> exists -> board mounts.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(BOARD_CHECK_RETRY_BASE_MS * 4);
      });
      expect(api.checkBoard).toHaveBeenCalledTimes(3);
      expect(screen.getByTestId('board-ui')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

// TC-23: malformed id -> Board not found with no request to /api/boards/<id>.
describe('TC-23: malformed id shows not found without a request', () => {
  it('does not call checkBoard for a malformed id', () => {
    render(<BoardPage id={'bad!'} />);
    expect(screen.getByText('Board not found')).toBeInTheDocument();
    expect(api.checkBoard).not.toHaveBeenCalled();
  });
});
