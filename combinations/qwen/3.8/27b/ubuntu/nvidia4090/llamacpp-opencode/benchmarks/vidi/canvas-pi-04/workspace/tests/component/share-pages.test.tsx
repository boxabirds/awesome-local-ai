// Story 5, task 6: component tests for the share.pages state machines
// (TC-16 to TC-21). The API client (src/client/api) is mocked; the board
// connector is mocked to a no-op so "board rendered" never opens a real
// WebSocket in jsdom.
//
// TC-16  click Create -> "Creating…" disabled -> navigate to /b/<id>.
// TC-17  create failed (500 and network, 2 runs) -> exact failure message,
//        button enabled, still on / (no navigation).
// TC-18  rate_limited -> exact rate-limit message, button enabled.
// TC-19  /b/bad -> NotFoundPage; checkBoard never called (negative).
// TC-20  404 -> "Opening board…" then NotFoundPage with Create a new board.
// TC-21  unreachable twice then exists -> "Couldn't reach vidi6. Retrying…"
//        -> board; retries after BOARD_CHECK_RETRY_BASE_MS then 2x; 3 calls.

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newBoardId } from '../../src/shared/board-id';
import { BOARD_CHECK_RETRY_BASE_MS } from '../../src/shared/config';
import { App } from '../../src/client/App';
import { BoardPage } from '../../src/client/pages/BoardPage';
import { HomePage } from '../../src/client/pages/HomePage';
import { checkBoard, createBoardRequest } from '../../src/client/api';

vi.mock('../../src/client/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/api')>();
  return {
    ...actual,
    createBoardRequest: vi.fn(),
    checkBoard: vi.fn(),
  };
});

vi.mock('../../src/client/sync/connectBoard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/sync/connectBoard')>();
  return {
    ...actual,
    // No WebSocket in jsdom: the board mounts in the 'connecting' state.
    connectBoard: () => ({ destroy: (): void => undefined }),
  };
});

const VALID_ID = newBoardId();

/** Flush microtasks (mocked API promises) inside act. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('share.pages (TC-16 to TC-21)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('TC-16: click Create -> "Creating…" disabled -> navigate to /b/<id>', async () => {
    window.history.pushState({}, '', '/');
    vi.mocked(createBoardRequest).mockResolvedValue({ kind: 'created', id: VALID_ID });

    render(<HomePage />);
    const button = screen.getByRole('button', { name: 'Create a board' });
    fireEvent.click(button);

    // Idle -> Creating: disabled with the "Creating…" label.
    const creating = screen.getByRole('button', { name: 'Creating…' }) as HTMLButtonElement;
    expect(creating.disabled).toBe(true);

    await flush();
    expect(createBoardRequest).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe(`/b/${VALID_ID}`);
  });

  it('TC-17: create failed (500 and network) -> message, enabled, still on /', async () => {
    // Both 5xx and network errors map to the same `failed` result.
    for (const cause of ['500', 'network'] as const) {
      cleanup();
      window.history.pushState({}, '', '/');
      vi.mocked(createBoardRequest).mockReset();
      vi.mocked(createBoardRequest).mockResolvedValue({ kind: 'failed' });

      render(<HomePage />);
      fireEvent.click(screen.getByRole('button', { name: 'Create a board' }));
      await flush();

      expect(screen.getByRole('alert').textContent, `cause: ${cause}`).toBe(
        "Couldn't create a board. Please try again.",
      );
      const button = screen.getByRole('button', { name: 'Create a board' }) as HTMLButtonElement;
      expect(button.disabled, `cause: ${cause}`).toBe(false);
      expect(window.location.pathname, `cause: ${cause}`).toBe('/');
    }
  });

  it('TC-18: rate_limited -> exact rate-limit message, button enabled', async () => {
    window.history.pushState({}, '', '/');
    vi.mocked(createBoardRequest).mockResolvedValue({ kind: 'rate_limited' });

    render(<HomePage />);
    fireEvent.click(screen.getByRole('button', { name: 'Create a board' }));
    await flush();

    expect(screen.getByRole('alert').textContent).toBe(
      "You're creating boards too quickly. Wait a minute and try again.",
    );
    const button = screen.getByRole('button', { name: 'Create a board' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(window.location.pathname).toBe('/');
  });

  it('TC-19: /b/bad -> NotFoundPage; checkBoard never called', async () => {
    window.history.pushState({}, '', '/b/bad');
    render(<App />);
    await flush();

    expect(screen.getByRole('heading', { name: 'Board not found' })).not.toBeNull();
    expect(checkBoard).not.toHaveBeenCalled();
    expect(createBoardRequest).not.toHaveBeenCalled();
  });

  it('TC-20: 404 -> "Opening board…" then NotFoundPage with Create a new board', async () => {
    window.history.pushState({}, '', `/b/${VALID_ID}`);
    vi.mocked(checkBoard).mockResolvedValue({ kind: 'not_found' });

    render(<BoardPage id={VALID_ID} />);
    // Checking: the loading text is visible before the (mocked) request settles.
    expect(screen.getByText('Opening board…')).not.toBeNull();

    await flush();
    expect(screen.getByRole('heading', { name: 'Board not found' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Create a new board' })).not.toBeNull();
    expect(checkBoard).toHaveBeenCalledWith(VALID_ID);
  });

  it('TC-21: unreachable twice then exists -> board; BASE then 2x backoff; 3 calls', async () => {
    vi.useFakeTimers();
    window.history.pushState({}, '', `/b/${VALID_ID}`);
    let calls = 0;
    vi.mocked(checkBoard).mockImplementation(() => {
      calls += 1;
      return Promise.resolve(calls < 3 ? { kind: 'unreachable' } : { kind: 'exists' });
    });

    render(<BoardPage id={VALID_ID} />);

    // Call 1 settles: unreachable -> "Couldn't reach vidi6. Retrying…".
    await flush();
    expect(screen.getByText("Couldn't reach vidi6. Retrying…")).not.toBeNull();
    expect(checkBoard).toHaveBeenCalledTimes(1);

    // Retry 1 after BOARD_CHECK_RETRY_BASE_MS.
    act(() => {
      vi.advanceTimersByTime(BOARD_CHECK_RETRY_BASE_MS);
    });
    await flush();
    expect(checkBoard).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Couldn't reach vidi6. Retrying…")).not.toBeNull();

    // Retry 2 after 2 * BOARD_CHECK_RETRY_BASE_MS.
    act(() => {
      vi.advanceTimersByTime(2 * BOARD_CHECK_RETRY_BASE_MS);
    });
    await flush();
    expect(checkBoard).toHaveBeenCalledTimes(3);

    // The board mounted (toolbar present, loading texts gone).
    expect(screen.queryByText("Couldn't reach vidi6. Retrying…")).toBeNull();
    expect(screen.queryByText('Opening board…')).toBeNull();
    expect(screen.getByRole('button', { name: 'Sticky note' })).not.toBeNull();
  });
});
