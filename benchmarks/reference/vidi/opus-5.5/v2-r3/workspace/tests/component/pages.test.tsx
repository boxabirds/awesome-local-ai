// Story 5 pages (share.pages) with a mocked api.ts: TC-16, TC-17, TC-19 to TC-21.
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CheckResponse, CreateResponse } from '../../src/client/api';
import { App } from '../../src/client/App';
import { BOARD_CHECK_RETRY_BASE_MS } from '../../src/shared/config';

const api = vi.hoisted(() => ({
  createBoardRequest: vi.fn<() => Promise<CreateResponse>>(),
  checkBoard: vi.fn<(id: string) => Promise<CheckResponse>>(),
}));
vi.mock('../../src/client/api', () => api);

const connected: string[] = [];
vi.mock('../../src/client/sync/connectBoard', () => ({
  connectBoard: (_doc: unknown, boardId: string, onState: (s: string) => void) => {
    connected.push(boardId);
    onState('connecting');
    return { destroy: vi.fn() };
  },
}));

const ID = 'AbCdEfGhIjKlMnOpQr_-09';
const FAILED_MESSAGE = "Couldn't create a board. Please try again.";

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function goTo(path: string) {
  window.history.replaceState(null, '', path);
}

beforeEach(() => {
  api.createBoardRequest.mockReset();
  api.checkBoard.mockReset();
  connected.length = 0;
  goTo('/');
});
afterEach(() => {
  vi.useRealTimers();
  goTo('/');
});

describe('Home page (share.create)', () => {
  it('shows the product name, description and New board; nothing connects', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'vidi6' })).toBeInTheDocument();
    expect(screen.getByText('A shared board for thinking together')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New board' })).toBeEnabled();
    expect(connected).toEqual([]);
    expect(api.checkBoard).not.toHaveBeenCalled();
  });

  it('TC-16: New board → "Creating…" (disabled) → navigates to /b/<id> and opens the board', async () => {
    const created = deferred<CreateResponse>();
    api.createBoardRequest.mockReturnValue(created.promise);
    api.checkBoard.mockResolvedValue({ kind: 'exists' });
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'New board' }));
    const busy = screen.getByRole('button', { name: 'Creating…' });
    expect(busy).toBeDisabled();
    fireEvent.click(busy);
    expect(api.createBoardRequest).toHaveBeenCalledTimes(1);
    await act(async () => created.resolve({ kind: 'created', id: ID }));
    expect(window.location.pathname).toBe(`/b/${ID}`);
    expect(await screen.findByTestId('board-viewport')).toBeInTheDocument();
    expect(connected).toEqual([ID]);
  });

  for (const run of ['500', 'network error']) {
    it(`TC-17 (${run}): failure message, button enabled again, still on /`, async () => {
      // api.ts maps both a 500 and a network error to { kind: 'failed' }.
      const created = deferred<CreateResponse>();
      api.createBoardRequest.mockReturnValue(created.promise);
      render(<App />);
      fireEvent.click(screen.getByRole('button', { name: 'New board' }));
      await act(async () => created.resolve({ kind: 'failed' }));
      expect(screen.getByRole('alert')).toHaveTextContent(FAILED_MESSAGE);
      expect(screen.getByRole('button', { name: 'New board' })).toBeEnabled();
      expect(window.location.pathname).toBe('/');
      expect(screen.getByRole('heading', { name: 'vidi6' })).toBeInTheDocument();
    });
  }

  it('TC-17: a rejected request is handled like a failure', async () => {
    api.createBoardRequest.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<App />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'New board' })));
    expect(screen.getByRole('alert')).toHaveTextContent(FAILED_MESSAGE);
    expect(window.location.pathname).toBe('/');
  });
});

describe('Board page (share.open_link, share.not_found, share.unreachable)', () => {
  it('TC-19: /b/bad → Board not found; checkBoard is never called', () => {
    goTo('/b/bad');
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Board not found' })).toBeInTheDocument();
    expect(api.checkBoard).not.toHaveBeenCalled();
    expect(connected).toEqual([]);
  });

  it('TC-19: other unknown paths → Board not found', () => {
    goTo('/something/else');
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Board not found' })).toBeInTheDocument();
    expect(api.checkBoard).not.toHaveBeenCalled();
  });

  it('TC-20: 404 → "Opening board…" then Board not found with New board; nothing connects', async () => {
    const check = deferred<CheckResponse>();
    api.checkBoard.mockReturnValue(check.promise);
    goTo(`/b/${ID}`);
    render(<App />);
    expect(screen.getByText('Opening board…')).toBeInTheDocument();
    await act(async () => check.resolve({ kind: 'not_found' }));
    expect(screen.getByRole('heading', { name: 'Board not found' })).toBeInTheDocument();
    expect(screen.getByText('Check the link, or ask the person who shared it to send it again.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New board' })).toBeEnabled();
    expect(screen.getByRole('link', { name: /home page/ })).toHaveAttribute('href', '/');
    expect(api.checkBoard).toHaveBeenCalledWith(ID);
    expect(connected).toEqual([]);
    expect(window.location.pathname).toBe(`/b/${ID}`);
  });

  it('TC-20: New board on the not-found page creates a board and opens it', async () => {
    api.checkBoard.mockResolvedValueOnce({ kind: 'not_found' }).mockResolvedValue({ kind: 'exists' });
    api.createBoardRequest.mockResolvedValue({ kind: 'created', id: 'ZyXwVuTsRqPoNmLkJiHg-_' });
    goTo(`/b/${ID}`);
    render(<App />);
    await screen.findByRole('heading', { name: 'Board not found' });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'New board' })));
    expect(window.location.pathname).toBe('/b/ZyXwVuTsRqPoNmLkJiHg-_');
    expect(await screen.findByTestId('board-viewport')).toBeInTheDocument();
    expect(connected).toEqual(['ZyXwVuTsRqPoNmLkJiHg-_']);
  });

  it('the home link on the not-found page returns to Home', async () => {
    goTo('/b/bad');
    render(<App />);
    fireEvent.click(screen.getByRole('link', { name: /home page/ }));
    expect(window.location.pathname).toBe('/');
    expect(screen.getByRole('heading', { name: 'vidi6' })).toBeInTheDocument();
  });

  it('TC-21: unreachable twice, then exists → retry message, retries after base then 2× base, then the board', async () => {
    vi.useFakeTimers();
    api.checkBoard
      .mockResolvedValueOnce({ kind: 'unreachable' })
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue({ kind: 'exists' });
    goTo(`/b/${ID}`);
    render(<App />);
    await act(async () => {});
    expect(screen.getByText("Couldn't reach vidi6. Retrying…")).toBeInTheDocument();
    expect(api.checkBoard).toHaveBeenCalledTimes(1);

    await act(async () => vi.advanceTimersByTimeAsync(BOARD_CHECK_RETRY_BASE_MS - 1));
    expect(api.checkBoard).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(api.checkBoard).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Couldn't reach vidi6. Retrying…")).toBeInTheDocument();

    await act(async () => vi.advanceTimersByTimeAsync(2 * BOARD_CHECK_RETRY_BASE_MS - 1));
    expect(api.checkBoard).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(api.checkBoard).toHaveBeenCalledTimes(3);
    expect(screen.getByTestId('board-viewport')).toBeInTheDocument();
    expect(screen.queryByText("Couldn't reach vidi6. Retrying…")).toBeNull();
    expect(connected).toEqual([ID]);
    expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument();
  });

  it('TC-21: leaving the page cancels the pending retry', async () => {
    vi.useFakeTimers();
    api.checkBoard.mockResolvedValue({ kind: 'unreachable' });
    goTo(`/b/${ID}`);
    const { unmount } = render(<App />);
    await act(async () => {});
    unmount();
    await vi.advanceTimersByTimeAsync(BOARD_CHECK_RETRY_BASE_MS * 10);
    expect(api.checkBoard).toHaveBeenCalledTimes(1);
  });
});
