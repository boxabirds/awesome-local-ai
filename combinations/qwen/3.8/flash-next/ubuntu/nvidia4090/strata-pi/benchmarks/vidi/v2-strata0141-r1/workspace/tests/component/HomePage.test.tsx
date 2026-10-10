import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

/**
 * The home page (`share.create`, `share.create_failure`).
 *
 * `src/client/api` is replaced by a recorder here: what the server answers is
 * decided by the integration suite and the e2e suite. What this suite checks is
 * what the page does with the answer - including the one boundary the design
 * names: the New board button is disabled while the create request is in flight.
 */

const BOARD = 'componentboard00000000';

const api = vi.hoisted(() => ({
  createBoardRequest: vi.fn(),
  checkBoard: vi.fn(),
}));

vi.mock('../../src/client/api', () => ({
  createBoardRequest: api.createBoardRequest,
  checkBoard: api.checkBoard,
}));

// The board page mounts the live connection; this suite is about pages, so the
// connection is a no-op stand-in (the real one is covered by integration and e2e).
const sync = vi.hoisted(() => ({
  connectBoard: vi.fn(() => ({
    state: () => 'connected' as const,
    destroy: () => undefined,
  })),
}));

vi.mock('../../src/client/sync/connectBoard', () => ({ connectBoard: sync.connectBoard }));

const { App } = await import('../../src/client/App');

const atHome = () => window.history.replaceState(null, '', '/');

beforeEach(() => {
  api.createBoardRequest.mockReset();
  api.checkBoard.mockReset();
  sync.connectBoard.mockReset();
  atHome();
});

afterEach(() => {
  vi.useRealTimers();
  atHome();
});

describe('the home page (share.create)', () => {
  it('TC-16: New board creates a board and opens it (D1 home create/D3 healthy)', async () => {
    api.createBoardRequest.mockResolvedValue({ kind: 'created', id: BOARD });
    api.checkBoard.mockResolvedValue({ kind: 'exists' });

    render(<App />);
    expect(screen.getByTestId('home-page')).toBeTruthy();
    expect(screen.getByTestId('new-board')).toBeTruthy();

    fireEvent.click(screen.getByTestId('new-board'));

    // The board is reached through its own address, so the address bar is the
    // link a person can copy straight afterwards.
    await waitFor(() => expect(window.location.pathname).toBe(`/b/${BOARD}`));
    expect(await screen.findByTestId('app')).toBeTruthy();
    expect(screen.queryByTestId('home-page')).toBeNull();
    expect(api.createBoardRequest).toHaveBeenCalledTimes(1);
  });

  it('TC-17: a create failure shows the failure message and stays home (error path)', async () => {
    api.createBoardRequest.mockResolvedValue({ kind: 'failed' });

    render(<App />);
    fireEvent.click(screen.getByTestId('new-board'));

    expect(await screen.findByTestId('create-error')).toBeTruthy();
    expect(screen.getByTestId('create-error').textContent).toBe(
      "Couldn't create a board. Please try again.",
    );
    // The page did not move, and the board page was never asked about anything.
    expect(window.location.pathname).toBe('/');
    expect(api.checkBoard).not.toHaveBeenCalled();
    // And the button is usable again: the failure is not a dead end.
    expect(screen.getByTestId<HTMLButtonElement>('new-board').disabled).toBe(false);
  });

  it('TC-16 boundary: the button is disabled while the create request is in flight (boundary "button disabled while POST in flight")', async () => {
    vi.useFakeTimers();
    api.createBoardRequest.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ kind: 'created', id: BOARD }), 500);
        }),
    );
    api.checkBoard.mockResolvedValue({ kind: 'exists' });

    render(<App />);
    const button = screen.getByTestId<HTMLButtonElement>('new-board');
    expect(button.disabled).toBe(false);

    fireEvent.click(button);
    expect(api.createBoardRequest).toHaveBeenCalledTimes(1);

    // Mid-request: no second click, so no second board.
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    expect(button.disabled).toBe(true);
    expect(api.createBoardRequest).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe('/');

    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(window.location.pathname).toBe(`/b/${BOARD}`);
  });
});
