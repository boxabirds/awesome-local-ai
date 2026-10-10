import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

/**
 * The board page (`share.open_link`, `share.not_found`, `share.legacy_boards`).
 *
 * The page's whole job is to decide what the server's answer means, so the API
 * client is a recorder here and every run is a question about the answer:
 *
 *   malformed id    no request at all, Board not found
 *   unreachable     the retrying message, retried with delay, forever
 *   200             the board, with the Share panel on it
 *   404             Board not found
 */

const BOARD = 'componentboard00000000';
const LEGACY_BOARD = 'legacy0000000000000000';

const api = vi.hoisted(() => ({
  createBoardRequest: vi.fn(),
  checkBoard: vi.fn(),
}));

vi.mock('../../src/client/api', () => ({
  createBoardRequest: api.createBoardRequest,
  checkBoard: api.checkBoard,
}));

const sync = vi.hoisted(() => ({
  connectBoard: vi.fn(() => ({
    state: () => 'connected' as const,
    destroy: () => undefined,
  })),
}));

vi.mock('../../src/client/sync/connectBoard', () => ({ connectBoard: sync.connectBoard }));

const { App } = await import('../../src/client/App');
const { boardCheckRetryDelayMs } = await import('../../src/client/pages/state');

const at = (path: string) => window.history.replaceState(null, '', path);

beforeEach(() => {
  api.createBoardRequest.mockReset();
  api.checkBoard.mockReset();
  sync.connectBoard.mockReset();
  at('/');
});

afterEach(() => {
  vi.useRealTimers();
  at('/');
});

describe('the board page (share.open_link, share.not_found)', () => {
  it('TC-19: /b/bad is Board not found and never asks the server (D2 malformed id, negative)', async () => {
    at('/b/bad');
    render(<App />);

    expect(await screen.findByTestId('not-found-page')).toBeTruthy();
    expect(screen.getByTestId('not-found-page').textContent).toContain('Board not found');
    expect(api.checkBoard).not.toHaveBeenCalled();

    // A link back out of the dead end, and a way to start over.
    fireEvent.click(screen.getByTestId('home-link'));
    expect(window.location.pathname).toBe('/');
    expect(screen.getByTestId('home-page')).toBeTruthy();
  });

  it('TC-19: an unknown but well-formed id is asked about once, then refused (D2 unknown valid id)', async () => {
    api.checkBoard.mockResolvedValue({ kind: 'not_found' });
    at(`/b/${BOARD}`);
    render(<App />);

    expect(await screen.findByTestId('not-found-page')).toBeTruthy();
    expect(api.checkBoard).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe(`/b/${BOARD}`);
  });

  it('TC-20: unreachable shows the retrying message, then the board when the service comes back (D3 service down/recovered)', async () => {
    vi.useFakeTimers();
    api.checkBoard.mockResolvedValueOnce({ kind: 'unreachable' });
    api.checkBoard.mockResolvedValueOnce({ kind: 'exists' });

    at(`/b/${BOARD}`);
    render(<App />);

    await act(async () => {
      await Promise.resolve();
    });
    const checking = screen.getByTestId('board-checking');
    expect(checking.textContent).toContain("Couldn't reach vidi6. Retrying…");
    expect(api.checkBoard).toHaveBeenCalledTimes(1);

    // The retry waits: nothing new is asked before the delay has passed.
    await act(async () => {
      vi.advanceTimersByTime(999);
    });
    expect(api.checkBoard).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(api.checkBoard).toHaveBeenCalledTimes(2);

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId('app')).toBeTruthy();
    expect(screen.queryByTestId('board-checking')).toBeNull();
  });

  it('TC-21: unreachable is retried with delay, and a board that never answers stays on the retrying page (D3 down for 10s)', async () => {
    vi.useFakeTimers();
    api.checkBoard.mockResolvedValue({ kind: 'unreachable' });

    at(`/b/${BOARD}`);
    const view = render(<App />);

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId('board-checking').getAttribute('data-check-state')).toBe('unreachable');
    expect(api.checkBoard).toHaveBeenCalledTimes(1);

    // 1s, then 2s, then 4s - the delays the design names.
    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(api.checkBoard).toHaveBeenCalledTimes(2);

    await act(async () => {
      vi.advanceTimersByTime(2_000);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(api.checkBoard).toHaveBeenCalledTimes(3);

    await act(async () => {
      vi.advanceTimersByTime(4_000);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(api.checkBoard).toHaveBeenCalledTimes(4);

    // Still the same page, still retrying, nothing half-shown.
    expect(screen.getByTestId('board-checking').getAttribute('data-check-state')).toBe('unreachable');
    expect(screen.queryByTestId('app')).toBeNull();

    // The delay keeps doubling only up to its cap.
    expect(boardCheckRetryDelayMs(1)).toBe(1_000);
    expect(boardCheckRetryDelayMs(2)).toBe(2_000);
    expect(boardCheckRetryDelayMs(3)).toBe(4_000);
    expect(boardCheckRetryDelayMs(4)).toBe(8_000);
    expect(boardCheckRetryDelayMs(9)).toBe(8_000);

    // Leaving the page stops the asking.
    view.unmount();
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect(api.checkBoard).toHaveBeenCalledTimes(4);
  });

  it('TC-21: a 404 is never retried (negative)', async () => {
    vi.useFakeTimers();
    api.checkBoard.mockResolvedValue({ kind: 'not_found' });

    at(`/b/${BOARD}`);
    render(<App />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(api.checkBoard).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect(api.checkBoard).toHaveBeenCalledTimes(1);
  });

  it('TC-24: the board page connects the board it was given (D1 WebSocket connect)', async () => {
    api.checkBoard.mockResolvedValue({ kind: 'exists' });
    at(`/b/${BOARD}`);
    render(<App />);

    expect(await screen.findByTestId('app')).toBeTruthy();
    expect(sync.connectBoard).toHaveBeenCalledTimes(1);
    const [doc, boardId, options] = sync.connectBoard.mock.calls[0] as unknown as [
      unknown,
      string,
      { onState?: unknown; provider?: unknown },
    ];
    expect(boardId).toBe(BOARD);
    expect(doc).toBeTruthy();
    // Production wiring: the page reports state, and the real connection is built
    // by `connectBoard` itself rather than being handed to it.
    expect(typeof options.onState).toBe('function');
    expect(options.provider).toBeUndefined();
  });

  it('TC-25: a legacy board - one that was never created through the API - still opens, with Share on it (D2 legacy, negative)', async () => {
    api.checkBoard.mockResolvedValue({ kind: 'exists' });
    at(`/b/${LEGACY_BOARD}`);
    render(<App />);

    expect(await screen.findByTestId('app')).toBeTruthy();
    expect(screen.getByTestId('share-button')).toBeTruthy();
    expect(api.checkBoard).toHaveBeenCalledWith(LEGACY_BOARD);
  });

  it('TC-19: an unrelated path is Board not found too (D1 unmatched path)', async () => {
    at('/nowhere');
    render(<App />);
    expect(await screen.findByTestId('not-found-page')).toBeTruthy();
    expect(api.checkBoard).not.toHaveBeenCalled();
  });
});
