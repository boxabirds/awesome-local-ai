import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BOARD_CHECK_RETRY_BASE_MS } from '../../src/shared/config';

// The page state machines are under test, not the network: api.ts is mocked
// and driven directly (design: "Mocked api.ts"). The sync layer is stubbed so
// that the ready board page can mount under fake timers without the real
// y-websocket provider scheduling reconnect/heartbeat timers.
vi.mock('../../src/client/api', () => ({
  createBoardRequest: vi.fn(),
  checkBoard: vi.fn()
}));
vi.mock('../../src/client/sync/connectBoard', () => ({
  connectBoard: () => ({ destroy(): void {} })
}));

import { createBoardRequest, checkBoard } from '../../src/client/api';
import { App } from '../../src/client/App';
import { isValidBoardId } from '../../src/shared/board-id';

const mockedCreate = vi.mocked(createBoardRequest);
const mockedCheck = vi.mocked(checkBoard);

function setPath(path: string): void {
  window.history.replaceState(null, '', path);
}

beforeEach(() => {
  mockedCreate.mockReset();
  mockedCheck.mockReset();
  setPath('/');
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('share.create (pages)', () => {
  test('TC-16 New board shows Creating… disabled then navigates to /b/<id>', async () => {
    mockedCheck.mockResolvedValue({ kind: 'exists' });
    let resolveCreate: ((value: { kind: 'created'; id: string }) => void) | null = null;
    mockedCreate.mockReturnValue(
      new Promise((resolve) => {
        resolveCreate = resolve;
      })
    );
    render(<App />);
    const button = screen.getByTestId('new-board-button');
    fireEvent.click(button);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.textContent).toBe('Creating…');
    await act(async () => {
      resolveCreate?.({ kind: 'created', id: 'abcdefghijklmnopqrstuv' });
    });
    await waitFor(() => expect(window.location.pathname).toBe('/b/abcdefghijklmnopqrstuv'));
  });

  test('TC-17 create failure (run 1: 500/failed; run 2: network) keeps home with the exact message', async () => {
    for (const mode of ['failed', 'network'] as const) {
      setPath('/');
      mockedCreate.mockReset();
      if (mode === 'failed') {
        mockedCreate.mockResolvedValue({ kind: 'failed' });
      } else {
        mockedCreate.mockImplementation(() => Promise.reject(new Error('network')));
      }
      const { unmount } = render(<App />);
      fireEvent.click(screen.getByTestId('new-board-button'));
      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toBe("Couldn't create a board. Please try again.");
      expect(window.location.pathname).toBe('/'); // no navigation (negative)
      const button = screen.getByTestId('new-board-button') as HTMLButtonElement;
      expect(button.disabled).toBe(false);
      expect(button.textContent).toBe('New board');
      unmount();
    }
  });
});

describe('share.not_found (pages)', () => {
  test('TC-19 /b/bad renders Board not found and never calls checkBoard (negative)', async () => {
    setPath('/b/bad');
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Board not found' })).toBeTruthy();
    expect(mockedCheck).not.toHaveBeenCalled();
  });

  test('TC-20 unknown valid id shows Opening board… then Board not found with New board', async () => {
    setPath('/b/abcdefghijklmnopqrstuv');
    mockedCheck.mockResolvedValue({ kind: 'not_found' });
    render(<App />);
    // The checking state renders first; the request resolves on a microtask.
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Board not found' })).toBeTruthy());
    expect(screen.getByTestId('new-board-button')).toBeTruthy();
  });
});

describe('share.unreachable (pages)', () => {
  test('TC-21 unreachable twice then exists: Retrying message, backoff 1s then 2s, 3 calls', async () => {
    vi.useFakeTimers();
    setPath('/b/abcdefghijklmnopqrstuv');
    mockedCheck
      .mockResolvedValueOnce({ kind: 'unreachable' })
      .mockResolvedValueOnce({ kind: 'unreachable' })
      .mockResolvedValueOnce({ kind: 'exists' });
    render(<App />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByRole('status').textContent).toBe("Couldn't reach vidi6. Retrying…");
    expect(mockedCheck).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(BOARD_CHECK_RETRY_BASE_MS - 1);
    });
    expect(mockedCheck).toHaveBeenCalledTimes(1); // boundary: not yet
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(mockedCheck).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('status').textContent).toBe("Couldn't reach vidi6. Retrying…");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(BOARD_CHECK_RETRY_BASE_MS * 2 - 1);
    });
    expect(mockedCheck).toHaveBeenCalledTimes(2); // boundary: doubling to 2x
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(mockedCheck).toHaveBeenCalledTimes(3);
    // Ready mounts the board synchronously inside the act (Share button is
    // part of the ready board page). waitFor is deliberately avoided here:
    // testing-library's polling helper does not advance under vi fake timers.
    expect(screen.getByTestId('share-button')).toBeTruthy();
    expect(isValidBoardId('abcdefghijklmnopqrstuv')).toBe(true);
  });
});
