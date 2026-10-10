import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { newBoardId } from '../../src/shared/board-id';
import { BOARD_CHECK_RETRY_BASE_MS } from '../../src/shared/config';

// Pages are tested against the mocked api (design: page state machines, not
// the network). connectBoard is stubbed so the ready state renders the board
// UI without a real websocket in jsdom.
const api = vi.hoisted(() => ({
  createBoardRequest: vi.fn(),
  checkBoard: vi.fn()
}));
vi.mock('../../src/client/api', () => api);
vi.mock('../../src/client/sync/connectBoard', () => ({
  connectBoard: () => ({
    provider: {},
    status: () => 'connected',
    subscribe: () => () => {},
    destroy: () => {}
  })
}));

const { HomePage } = await import('../../src/client/pages/HomePage');
const { BoardPage } = await import('../../src/client/pages/BoardPage');

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  window.history.replaceState(null, '', '/');
});

describe('HomePage create (TC-16, TC-17)', () => {
  it('TC-16 click shows Creating… disabled then navigates to /b/<id>', async () => {
    const pending = deferred<{ kind: 'created'; id: string }>();
    api.createBoardRequest.mockReturnValue(pending.promise);
    const pushState = vi.spyOn(window.history, 'pushState');

    render(<HomePage />);
    const button = screen.getByRole('button', { name: 'New board' });
    fireEvent.click(button);

    expect(button).toBeDisabled();
    expect(button).toHaveTextContent('Creating…');
    expect(pushState).not.toHaveBeenCalled();

    pending.resolve({ kind: 'created', id: 'abcdefghijklmnopqrstuv' });
    await waitFor(() =>
      expect(pushState).toHaveBeenCalledWith(null, '', '/b/abcdefghijklmnopqrstuv')
    );
  });

  it.each([
    ['500 response', () => api.createBoardRequest.mockResolvedValue({ kind: 'failed' })],
    ['network error', () => api.createBoardRequest.mockRejectedValue(new Error('offline'))]
  ])('TC-17 (%s) explains the failure, stays on / and re-enables the button', async (_label, setup) => {
    setup();
    const pushState = vi.spyOn(window.history, 'pushState');

    render(<HomePage />);
    const button = screen.getByRole('button', { name: 'New board' });
    fireEvent.click(button);

    await waitFor(() =>
      expect(
        screen.getByText("Couldn't create a board. Please try again.")
      ).toBeInTheDocument()
    );
    expect(button).toBeEnabled();
    expect(pushState).not.toHaveBeenCalled();
  });
});

describe('BoardPage existence check (TC-19 to TC-21)', () => {
  it('TC-19 a malformed id shows Board not found with no request', () => {
    render(<BoardPage id="bad" />);
    expect(api.checkBoard).not.toHaveBeenCalled();
    expect(screen.getByText('Board not found')).toBeInTheDocument();
  });

  it('TC-20 an unknown valid id shows Opening board… then Board not found', async () => {
    const id = newBoardId();
    const pending = deferred<{ kind: 'not_found' }>();
    api.checkBoard.mockReturnValue(pending.promise);

    render(<BoardPage id={id} />);
    expect(screen.getByText('Opening board…')).toBeInTheDocument();
    expect(api.checkBoard).toHaveBeenCalledWith(id);

    pending.resolve({ kind: 'not_found' });
    await waitFor(() => expect(screen.getByText('Board not found')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'New board' })).toBeInTheDocument();
  });

  it('TC-21 retries with backoff when unreachable, then renders the board', async () => {
    vi.useFakeTimers();
    const id = newBoardId();
    api.checkBoard
      .mockResolvedValueOnce({ kind: 'unreachable' })
      .mockResolvedValueOnce({ kind: 'unreachable' })
      .mockResolvedValueOnce({ kind: 'exists' });

    render(<BoardPage id={id} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(api.checkBoard).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Couldn't reach vidi6. Retrying…")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(BOARD_CHECK_RETRY_BASE_MS);
    });
    expect(api.checkBoard).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2 * BOARD_CHECK_RETRY_BASE_MS);
    });
    expect(api.checkBoard).toHaveBeenCalledTimes(3);

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId('board-viewport')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument();
  });
});
