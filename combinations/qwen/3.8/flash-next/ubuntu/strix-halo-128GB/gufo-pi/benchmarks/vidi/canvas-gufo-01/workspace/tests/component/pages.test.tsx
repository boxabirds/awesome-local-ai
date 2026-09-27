// Pages: home, board, not-found. APIs and the board canvas are mocked; these
// tests pin the exact PRD copy and the state machines around them.
// TC-16 .. TC-21 from spec/stories/005-share-a-board-with-others-using-a-link/design.md

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from '../../src/client/App';
import { BoardPage } from '../../src/client/pages/BoardPage';
import { NotFoundPage } from '../../src/client/pages/NotFoundPage';
import type { CheckResponse, CreateResponse } from '../../src/client/api';

const createBoardRequest = vi.fn(async (): Promise<CreateResponse> => ({ kind: 'failed' }));
const checkBoard = vi.fn(async (_id: string): Promise<CheckResponse> => ({ status: 'exists' }));

vi.mock('../../src/client/api', () => ({
  createBoardRequest: () => createBoardRequest(),
  checkBoard: (id: string) => checkBoard(id),
}));

vi.mock('../../src/client/board/BoardWorkspace', () => ({
  BoardWorkspace: ({ boardId }: { boardId: string }) => (
    <div data-testid="board-workspace">board {boardId}</div>
  ),
}));

const VALID_ID = 'Ab3dEf6hIjKlMnOpQrStUv';

function setPath(path: string): void {
  window.history.replaceState({}, '', path);
}

beforeEach(() => {
  setPath('/');
  createBoardRequest.mockReset();
  checkBoard.mockReset();
  createBoardRequest.mockResolvedValue({ kind: 'failed' });
  checkBoard.mockResolvedValue({ status: 'exists' });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('home page', () => {
  it('TC-16 shows the name, the one sentence and one call to action', () => {
    setPath('/');
    render(<App />);
    expect(screen.getByRole('heading', { name: 'vidi6' })).toBeInTheDocument();
    expect(screen.getByText('A shared board for thinking together')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create a board' })).toBeEnabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // Nothing else on the first screen.
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  // Design runs this twice: the service answering 500, and the network failing
  // outright. Both arrive here as one shape ("failed") from the api module.
  for (const [label, failure] of [
    ['service failure (500)', () => createBoardRequest.mockResolvedValue({ kind: 'failed' })],
    ['network error', () => createBoardRequest.mockRejectedValue(new TypeError('Failed to fetch'))],
  ] as const) {
    it(`TC-17 shows the failure copy after a ${label} and re-enables the button`, async () => {
      failure();
      render(<App />);
      const button = screen.getByRole('button', { name: 'Create a board' });
      fireEvent.click(button);
      expect(button).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Creating…' })).toBeInTheDocument();

      await waitFor(() =>
        expect(
          screen.getByRole('alert'),
        ).toHaveTextContent("Couldn't create a board. Please try again."),
      );
      expect(screen.getByRole('button', { name: 'Create a board' })).toBeEnabled();
      expect(window.location.pathname).toBe('/');
    });
  }

  it('TC-18 shows the rate-limit copy when the service says 429', async () => {
    createBoardRequest.mockResolvedValue({ kind: 'rate_limited' });
    render(<App />);
    screen.getByRole('button', { name: 'Create a board' }).click();
    await waitFor(() =>
      expect(
        screen.getByText("You're creating boards too quickly. Wait a minute and try again."),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Create a board' })).toBeEnabled();
  });

  it('TC-16 navigates to the new board link on success', async () => {
    createBoardRequest.mockResolvedValue({ kind: 'created', id: VALID_ID });
    checkBoard.mockResolvedValue({ status: 'exists' });
    render(<App />);
    screen.getByRole('button', { name: 'Create a board' }).click();
    await waitFor(() => expect(window.location.pathname).toBe(`/b/${VALID_ID}`));
    await waitFor(() => expect(screen.getByTestId('board-workspace')).toBeInTheDocument());
  });
});

describe('board page', () => {
  it('TC-20 shows the loading state, then the board', async () => {
    let release: (value: CheckResponse) => void = () => undefined;
    checkBoard.mockReturnValue(
      new Promise<CheckResponse>((resolveFn) => {
        release = resolveFn;
      }),
    );
    render(<BoardPage id={VALID_ID} />);
    expect(screen.getByRole('status')).toHaveTextContent('Opening board…');
    expect(screen.queryByTestId('board-workspace')).not.toBeInTheDocument();

    release({ status: 'exists' });
    await waitFor(() => expect(screen.getByTestId('board-workspace')).toBeInTheDocument());
    expect(screen.getByTestId('board-workspace')).toHaveTextContent(`board ${VALID_ID}`);
    expect(checkBoard).toHaveBeenCalledWith(VALID_ID);
  });

  it('TC-19 renders not-found for a malformed code without probing the API', async () => {
    for (const bad of ['bad', '', 'x'.repeat(23), 'short', 'has spaces here!!']) {
      const view = render(<BoardPage id={bad} />);
      expect(screen.getByRole('heading', { name: 'Board not found' })).toBeInTheDocument();
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      view.unmount();
    }
    await Promise.resolve();
    expect(checkBoard).not.toHaveBeenCalled();
  });

  it('TC-21 retries an unreachable service with exponential backoff', async () => {
    vi.useFakeTimers();
    checkBoard
      .mockResolvedValueOnce({ status: 'unreachable' })
      .mockResolvedValueOnce({ status: 'unreachable' })
      .mockResolvedValue({ status: 'exists' });

    render(<BoardPage id={VALID_ID} />);
    await act(async () => {
      vi.advanceTimersByTime(0);
    });
    expect(checkBoard).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent("Couldn't reach vidi6. Retrying…");

    await act(async () => {
      vi.advanceTimersByTime(999);
    });
    expect(checkBoard).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(checkBoard).toHaveBeenCalledTimes(2);

    // Second wait is doubled: nothing before 2000ms.
    await act(async () => {
      vi.advanceTimersByTime(1999);
    });
    expect(checkBoard).toHaveBeenCalledTimes(2);
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(checkBoard).toHaveBeenCalledTimes(3);

    await act(async () => {
      vi.advanceTimersByTime(0);
    });
    expect(screen.getByTestId('board-workspace')).toBeInTheDocument();
  });

  it('shows not-found when the service reports 404', async () => {
    checkBoard.mockResolvedValue({ status: 'not_found' });
    render(<BoardPage id={VALID_ID} />);
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Board not found' })).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('board-workspace')).not.toBeInTheDocument();
  });
});

describe('not-found page', () => {
  it('TC-20 explains the dead link and creates a board at a new address', async () => {
    render(<NotFoundPage />);
    expect(screen.getByRole('heading', { name: 'Board not found' })).toBeInTheDocument();
    expect(
      screen.getByText('Check the link, or ask the person who shared it to send it again.'),
    ).toBeInTheDocument();

    setPath(`/b/${'zz'.repeat(11)}`);
    createBoardRequest.mockResolvedValue({ kind: 'created', id: VALID_ID });
    checkBoard.mockResolvedValue({ status: 'exists' });
    render(<App />);
    const button = screen.getByRole('button', { name: 'Create a new board' });
    button.click();
    await waitFor(() => expect(window.location.pathname).toBe(`/b/${VALID_ID}`));
    await waitFor(() => expect(screen.getByTestId('board-workspace')).toBeInTheDocument());
  });
});
