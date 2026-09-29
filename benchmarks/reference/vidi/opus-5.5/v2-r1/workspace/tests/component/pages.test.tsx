// share.pages: Home, Board and Board not found page state machines with a mocked api.ts.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newBoardId } from '../../src/shared/board-id';
import { BOARD_CHECK_RETRY_BASE_MS } from '../../src/shared/config';

vi.mock('../../src/client/api', () => ({
  createBoardRequest: vi.fn(),
  checkBoard: vi.fn(),
}));
// The stories 1–4 board is not under test here: a marker stands in for it.
vi.mock('../../src/client/App', () => ({
  App: (props: { boardId?: string }) => <div data-testid="board">{props.boardId}</div>,
}));

const api = await import('../../src/client/api');
const { HomePage } = await import('../../src/client/pages/HomePage');
const { BoardPage } = await import('../../src/client/pages/BoardPage');
const { nextBoardPageState, retryDelayMs } = await import('../../src/client/pages/state');

const createBoardRequest = vi.mocked(api.createBoardRequest);
const checkBoard = vi.mocked(api.checkBoard);

/** Lets resolved promises (mocked API answers) reach React. */
async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  createBoardRequest.mockReset();
  checkBoard.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('HomePage', () => {
  it('shows the product name, the one-line description and New board', () => {
    render(<HomePage />);
    expect(screen.getByRole('heading', { name: 'vidi6' })).toBeTruthy();
    expect(screen.getByText('A shared board for thinking together')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New board' })).toBeTruthy();
  });

  it('TC-16 New board shows Creating… (disabled), then opens /b/<id>', async () => {
    const id = newBoardId();
    const answer = deferred<{ kind: 'created'; id: string }>();
    createBoardRequest.mockReturnValue(answer.promise);
    render(<HomePage />);

    fireEvent.click(screen.getByRole('button', { name: 'New board' }));
    const busy = screen.getByRole('button', { name: 'Creating…' }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    // A second click while creating does not create a second board.
    fireEvent.click(busy);
    expect(createBoardRequest).toHaveBeenCalledTimes(1);

    answer.resolve({ kind: 'created', id });
    await flush();
    expect(window.location.pathname).toBe(`/b/${id}`);
  });

  it.each([
    ['a 500 answer', () => Promise.resolve({ kind: 'failed' as const })],
    ['a network error', () => Promise.reject(new TypeError('Failed to fetch'))],
  ])('TC-17 %s: the message shows, the button is available again, still on /', async (_l, answer) => {
    createBoardRequest.mockImplementation(answer);
    render(<HomePage />);
    fireEvent.click(screen.getByRole('button', { name: 'New board' }));
    await flush();

    expect(screen.getByRole('alert').textContent).toBe("Couldn't create a board. Please try again.");
    const button = screen.getByRole('button', { name: 'New board' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(window.location.pathname).toBe('/');

    // Clicking again tries again.
    createBoardRequest.mockResolvedValue({ kind: 'created', id: newBoardId() });
    fireEvent.click(button);
    expect(createBoardRequest).toHaveBeenCalledTimes(2);
    await flush();
  });
});

describe('BoardPage', () => {
  it.each([
    ['too short', 'bad'],
    ['21 characters', newBoardId().slice(1)],
    ['23 characters', `${newBoardId()}A`],
    ['a slash', `${newBoardId().slice(0, 21)}/`],
  ])('TC-19 a malformed id (%s) is Board not found without asking the service', (_l, id) => {
    render(<BoardPage id={id} />);
    expect(screen.getByRole('heading', { name: 'Board not found' })).toBeTruthy();
    expect(checkBoard).not.toHaveBeenCalled();
    expect(screen.queryByTestId('board')).toBeNull();
  });

  it('TC-20 an unknown id: Opening board…, then Board not found with New board', async () => {
    const answer = deferred<{ kind: 'not_found' }>();
    checkBoard.mockReturnValue(answer.promise);
    const id = newBoardId();
    render(<BoardPage id={id} />);
    expect(screen.getByText('Opening board…')).toBeTruthy();
    expect(checkBoard).toHaveBeenCalledWith(id);

    answer.resolve({ kind: 'not_found' });
    await flush();
    expect(screen.getByRole('heading', { name: 'Board not found' })).toBeTruthy();
    expect(
      screen.getByText('Check the link, or ask the person who shared it to send it again.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New board' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /home page/ }).getAttribute('href')).toBe('/');
    expect(screen.queryByTestId('board')).toBeNull();
    expect(createBoardRequest).not.toHaveBeenCalled();
  });

  it('TC-21 unreachable twice then found: retry message, backoff 1× then 2×, board opens (3 calls)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    checkBoard
      .mockResolvedValueOnce({ kind: 'unreachable' })
      .mockResolvedValueOnce({ kind: 'unreachable' })
      .mockResolvedValueOnce({ kind: 'exists' });
    const id = newBoardId();
    render(<BoardPage id={id} />);
    await flush();
    expect(screen.getByText("Couldn't reach vidi6. Retrying…")).toBeTruthy();
    expect(checkBoard).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(BOARD_CHECK_RETRY_BASE_MS - 1));
    expect(checkBoard).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(1));
    expect(checkBoard).toHaveBeenCalledTimes(2);
    await flush();
    expect(screen.getByText("Couldn't reach vidi6. Retrying…")).toBeTruthy();

    act(() => vi.advanceTimersByTime(2 * BOARD_CHECK_RETRY_BASE_MS - 1));
    expect(checkBoard).toHaveBeenCalledTimes(2);
    act(() => vi.advanceTimersByTime(1));
    expect(checkBoard).toHaveBeenCalledTimes(3);
    await flush();

    expect(screen.getByTestId('board').textContent).toBe(id);
    expect(screen.getByRole('button', { name: 'Share' })).toBeTruthy();
    expect(screen.queryByText("Couldn't reach vidi6. Retrying…")).toBeNull();
    act(() => vi.advanceTimersByTime(60_000));
    expect(checkBoard).toHaveBeenCalledTimes(3);
  });

  it('stops retrying when the page is left', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    checkBoard.mockResolvedValue({ kind: 'unreachable' });
    const { unmount } = render(<BoardPage id={newBoardId()} />);
    await flush();
    unmount();
    act(() => vi.advanceTimersByTime(60_000));
    expect(checkBoard).toHaveBeenCalledTimes(1);
  });
});

describe('nextBoardPageState', () => {
  const id = newBoardId();
  it('maps each check answer', () => {
    expect(nextBoardPageState({ kind: 'checking' }, { kind: 'exists' }, 1, id)).toEqual({
      kind: 'ready',
      boardId: id,
    });
    expect(nextBoardPageState({ kind: 'checking' }, { kind: 'not_found' }, 1, id)).toEqual({
      kind: 'not_found',
    });
    expect(nextBoardPageState({ kind: 'checking' }, { kind: 'unreachable' }, 3, id)).toEqual({
      kind: 'unreachable',
      attempt: 3,
      nextRetryMs: 4 * BOARD_CHECK_RETRY_BASE_MS,
    });
  });

  it('caps the backoff at RECONNECT_MAX_BACKOFF_MS', async () => {
    const { RECONNECT_MAX_BACKOFF_MS } = await import('../../src/shared/config');
    expect(retryDelayMs(1)).toBe(BOARD_CHECK_RETRY_BASE_MS);
    expect(retryDelayMs(2)).toBe(2 * BOARD_CHECK_RETRY_BASE_MS);
    expect(retryDelayMs(50)).toBe(RECONNECT_MAX_BACKOFF_MS);
  });
});

describe('router', () => {
  it('maps / to home, /b/:id to a board and anything else to not found', async () => {
    const { routeFor } = await import('../../src/client/router');
    const id = newBoardId();
    expect(routeFor('/')).toEqual({ name: 'home' });
    expect(routeFor(`/b/${id}`)).toEqual({ name: 'board', id });
    expect(routeFor(`/b/${id}/`)).toEqual({ name: 'board', id });
    expect(routeFor('/b/bad')).toEqual({ name: 'board', id: 'bad' }); // BoardPage rejects it
    expect(routeFor(`/b/${id}/extra`)).toEqual({ name: 'not_found' });
    expect(routeFor('/about')).toEqual({ name: 'not_found' });
    expect(routeFor('/b/%E0%A4%A')).toEqual({ name: 'not_found' });
  });
});
