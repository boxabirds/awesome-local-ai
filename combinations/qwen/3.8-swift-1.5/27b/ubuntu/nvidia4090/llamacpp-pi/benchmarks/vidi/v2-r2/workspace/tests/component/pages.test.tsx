import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { newBoardId } from '../../src/shared/board-id';
import { BOARD_CHECK_RETRY_BASE_MS } from '../../src/shared/config';
import type { CheckResponse } from '../../src/client/api';
import App from '../../src/client/App';

/* ------------------------------------------------------------------ */
/* Mocks: the API (network) and the Board UI (WebSocket)               */
/* ------------------------------------------------------------------ */

vi.mock('../../src/client/api', () => ({
  createBoardRequest: vi.fn(),
  checkBoard: vi.fn(),
}));

vi.mock('../../src/client/board/Board', () => ({
  Board: (props: { boardId: string }) => (
    <div data-testid="board-stub" data-board-id={props.boardId} />
  ),
}));

import { createBoardRequest, checkBoard } from '../../src/client/api';

const mockCreate = createBoardRequest as ReturnType<typeof vi.fn>;
const mockCheck = checkBoard as ReturnType<typeof vi.fn>;

function goto(path: string) {
  window.history.pushState(null, '', path);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  goto('/');
});

describe('Pages (story 5, ui-component)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheck.mockResolvedValue({ kind: 'exists' } satisfies CheckResponse);
  });

  it('TC-16: New board click → "Creating…" disabled → navigates to /b/<id> with the created id', async () => {
    const id = newBoardId();
    // Controllable promise so the in-flight state is observable.
    let resolveCreate: (v: { kind: 'created'; id: string }) => void = () => {};
    mockCreate.mockImplementationOnce(
      () =>
        new Promise<{ kind: 'created'; id: string }>((resolve) => {
          resolveCreate = resolve;
        })
    );

    goto('/');
    render(<App />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'New board' }));

    // While the request is in flight: "Creating…" and disabled.
    const creating = screen.getByRole('button', { name: 'Creating…' });
    expect(creating).toBeDisabled();

    await act(async () => {
      resolveCreate({ kind: 'created', id });
    });
    await waitFor(() => expect(window.location.pathname).toBe(`/b/${id}`));
    // The board renders for the created id.
    expect(screen.getByTestId('board-stub')).toHaveAttribute('data-board-id', id);
  });

  it.each([
    ['500 from the server', { kind: 'failed' as const }],
    ['network failure', { kind: 'failed' as const }],
  ])('TC-17: %s → the message is shown, the button stays enabled, the user stays on /', async (_label, failure) => {
    mockCreate.mockResolvedValueOnce(failure);

    goto('/');
    render(<App />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'New board' }));

    expect(await screen.findByText("Couldn't create a board. Please try again.")).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'New board' });
    expect(button).not.toBeDisabled();
    expect(window.location.pathname).toBe('/');
  });

  it('TC-19: /b/bad (malformed) → "Board not found", no existence request is made', async () => {
    goto('/b/bad');
    render(<App />);

    expect(await screen.findByText('Board not found')).toBeInTheDocument();
    expect(mockCheck).not.toHaveBeenCalled();
  });

  it('TC-20: 404 → "Opening board…" then "Board not found" with a working New board button', async () => {
    const id = newBoardId();
    let resolveCheck: (v: CheckResponse) => void = () => {};
    mockCheck.mockImplementationOnce(
      () =>
        new Promise<CheckResponse>((resolve) => {
          resolveCheck = resolve;
        })
    );
    mockCreate.mockResolvedValueOnce({ kind: 'created', id: newBoardId() });

    goto(`/b/${id}`);
    render(<App />);

    expect(await screen.findByText('Opening board…')).toBeInTheDocument();
    resolveCheck({ kind: 'not_found' });

    expect(await screen.findByText('Board not found')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'New board' });
    expect(button).not.toBeDisabled();
  });

  it('TC-21: unreachable twice then exists → retry message both times, board on success, exactly 3 calls', async () => {
    vi.useFakeTimers();
    const id = newBoardId();
    mockCheck
      .mockResolvedValueOnce({ kind: 'unreachable' } satisfies CheckResponse)
      .mockResolvedValueOnce({ kind: 'unreachable' } satisfies CheckResponse)
      .mockResolvedValueOnce({ kind: 'exists' } satisfies CheckResponse);

    goto(`/b/${id}`);
    render(<App />);

    // First check completes (microtasks only).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("Couldn't reach vidi6. Retrying…")).toBeInTheDocument();
    expect(mockCheck).toHaveBeenCalledTimes(1);

    // First backoff: BOARD_CHECK_RETRY_BASE_MS.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BOARD_CHECK_RETRY_BASE_MS);
    });
    expect(mockCheck).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Couldn't reach vidi6. Retrying…")).toBeInTheDocument();

    // Second backoff: doubled.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BOARD_CHECK_RETRY_BASE_MS * 2);
    });
    expect(mockCheck).toHaveBeenCalledTimes(3);

    // The board renders (no reload happened — same render tree, same id).
    expect(screen.getByTestId('board-stub')).toHaveAttribute('data-board-id', id);
    expect(window.location.pathname).toBe(`/b/${id}`);
  });
});
