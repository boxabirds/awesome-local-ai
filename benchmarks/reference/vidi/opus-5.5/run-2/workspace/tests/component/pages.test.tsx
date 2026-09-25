/**
 * Home, Board and Board not found pages (share.pages, TC-16 to TC-21) with a mocked api.ts.
 * The real stories 1–4 board mounts in Ready; only its y-websocket provider is replaced, so
 * the test sees which room the board joins without opening a socket.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Routes } from '../../src/client/App';
import { checkBoard, createBoardRequest, type CheckResponse, type CreateResponse } from '../../src/client/api';
import { newBoardId } from '../../src/shared/board-id';
import { BOARD_CHECK_RETRY_BASE_MS } from '../../src/shared/config';

vi.mock('../../src/client/api', () => ({ createBoardRequest: vi.fn(), checkBoard: vi.fn() }));
const rooms = vi.hoisted(() => [] as string[]);
vi.mock('y-websocket', () => ({
  WebsocketProvider: class {
    constructor(_url: string, room: string) {
      rooms.push(room);
    }
    on(): void {}
    destroy(): void {}
  },
}));

const create = vi.mocked(createBoardRequest);
const check = vi.mocked(checkBoard);

const FAILED = "Couldn't create a board. Please try again.";
const RATE_LIMITED = "You're creating boards too quickly. Wait a minute and try again.";
const UNREACHABLE = "Couldn't reach vidi6. Retrying…";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function at(path: string): void {
  window.history.replaceState(null, '', path);
}

/** Lets resolved mock promises reach React. */
async function flush(): Promise<void> {
  await act(async () => {});
}

/** The board is open (stories 1–4 UI with the Share button) and joined room `id`. */
function expectBoard(id: string): void {
  expect(screen.getByTestId('board-viewport')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument();
  expect(rooms).toEqual([id]);
}

function expectNoBoard(): void {
  expect(screen.queryByTestId('board-viewport')).toBeNull();
  expect(rooms).toEqual([]);
}

beforeEach(() => {
  rooms.length = 0;
  create.mockReset();
  check.mockReset();
  at('/');
});

afterEach(() => at('/'));

describe('HomePage (share.create)', () => {
  it('shows the product name, the description and Create a board', () => {
    render(<Routes />);
    expect(screen.getByRole('heading', { name: 'vidi6' })).toBeInTheDocument();
    expect(screen.getByText('A shared board for thinking together')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create a board' })).toBeEnabled();
  });

  it('TC-16 Creating… while the request runs, then the new board opens', async () => {
    const id = newBoardId();
    const pending = deferred<CreateResponse>();
    create.mockReturnValue(pending.promise);
    check.mockResolvedValue({ kind: 'exists' });
    render(<Routes />);
    fireEvent.click(screen.getByRole('button', { name: 'Create a board' }));
    const busy = screen.getByRole('button', { name: 'Creating…' });
    expect(busy).toBeDisabled();
    fireEvent.click(busy);
    expect(create).toHaveBeenCalledTimes(1);

    await act(async () => pending.resolve({ kind: 'created', id }));
    expect(window.location.pathname).toBe(`/b/${id}`);
    await flush();
    expect(check).toHaveBeenCalledWith(id);
    expectBoard(id);
  });

  it.each([
    ['service error (500)', { kind: 'failed' } as CreateResponse],
    ['network error', { kind: 'failed' } as CreateResponse],
  ])('TC-17 %s: failure message, button enabled, still home', async (_label, response) => {
    create.mockResolvedValue(response);
    render(<Routes />);
    fireEvent.click(screen.getByRole('button', { name: 'Create a board' }));
    await flush();
    expect(screen.getByRole('alert')).toHaveTextContent(FAILED);
    expect(screen.getByRole('button', { name: 'Create a board' })).toBeEnabled();
    expect(window.location.pathname).toBe('/');
    expect(check).not.toHaveBeenCalled();
  });

  it('TC-18 rate limited: the rate-limit message, button enabled', async () => {
    create.mockResolvedValue({ kind: 'rate_limited' });
    render(<Routes />);
    fireEvent.click(screen.getByRole('button', { name: 'Create a board' }));
    await flush();
    expect(screen.getByRole('alert')).toHaveTextContent(RATE_LIMITED);
    expect(screen.getByRole('button', { name: 'Create a board' })).toBeEnabled();
    expect(window.location.pathname).toBe('/');

    // Clicking again clears the message while creating.
    const pending = deferred<CreateResponse>();
    create.mockReturnValue(pending.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Create a board' }));
    expect(screen.getByRole('alert')).toBeEmptyDOMElement();
    await act(async () => pending.resolve({ kind: 'failed' }));
    expect(screen.getByRole('alert')).toHaveTextContent(FAILED);
  });
});

describe('BoardPage and NotFoundPage (share.open_link, share.not_found, share.unreachable)', () => {
  it('TC-19 a malformed id is Board not found without any request', async () => {
    at('/b/bad');
    render(<Routes />);
    expect(screen.getByRole('heading', { name: 'Board not found' })).toBeInTheDocument();
    await flush();
    expect(check).not.toHaveBeenCalled();
    expectNoBoard();
  });

  it('any other address is Board not found', () => {
    at('/somewhere/else');
    render(<Routes />);
    expect(screen.getByRole('heading', { name: 'Board not found' })).toBeInTheDocument();
  });

  it('TC-20 an unknown board: Opening board… then Board not found with Create a new board', async () => {
    const id = newBoardId();
    const pending = deferred<CheckResponse>();
    check.mockReturnValue(pending.promise);
    at(`/b/${id}`);
    render(<Routes />);
    expect(screen.getByRole('status')).toHaveTextContent('Opening board…');
    await act(async () => pending.resolve({ kind: 'not_found' }));
    expect(screen.getByRole('heading', { name: 'Board not found' })).toBeInTheDocument();
    expect(screen.getByText('Check the link, or ask the person who shared it to send it again.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to the home page' })).toHaveAttribute('href', '/');
    expectNoBoard();
    expect(window.location.pathname).toBe(`/b/${id}`); // nothing created at this address

    // Create a new board reuses the home page's create action.
    const fresh = newBoardId();
    create.mockResolvedValue({ kind: 'created', id: fresh });
    check.mockResolvedValue({ kind: 'exists' });
    fireEvent.click(screen.getByRole('button', { name: 'Create a new board' }));
    await flush();
    await flush();
    expect(window.location.pathname).toBe(`/b/${fresh}`);
    expectBoard(fresh);
  });

  it('the home link on Board not found goes home', () => {
    at('/b/bad');
    render(<Routes />);
    fireEvent.click(screen.getByRole('link', { name: 'Go to the home page' }));
    expect(window.location.pathname).toBe('/');
    expect(screen.getByRole('button', { name: 'Create a board' })).toBeInTheDocument();
  });

  it('TC-21 unreachable twice, then the board opens: retries after BASE then 2 x BASE', async () => {
    vi.useFakeTimers();
    const id = newBoardId();
    check
      .mockResolvedValueOnce({ kind: 'unreachable' })
      .mockResolvedValueOnce({ kind: 'unreachable' })
      .mockResolvedValueOnce({ kind: 'exists' });
    at(`/b/${id}`);
    render(<Routes />);
    await flush();
    expect(check).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent(UNREACHABLE);

    await act(async () => vi.advanceTimersByTime(BOARD_CHECK_RETRY_BASE_MS - 1));
    expect(check).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTime(1));
    expect(check).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('status')).toHaveTextContent(UNREACHABLE);

    await act(async () => vi.advanceTimersByTime(2 * BOARD_CHECK_RETRY_BASE_MS - 1));
    expect(check).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTime(1));
    expect(check).toHaveBeenCalledTimes(3);
    expectBoard(id);
    expect(screen.queryByText(UNREACHABLE)).toBeNull();
  });

  it('a rejected check counts as unreachable, and leaving the page stops retrying', async () => {
    vi.useFakeTimers();
    check.mockRejectedValue(new Error('offline'));
    at(`/b/${newBoardId()}`);
    const { unmount } = render(<Routes />);
    await flush();
    expect(screen.getByRole('status')).toHaveTextContent(UNREACHABLE);
    unmount();
    await act(async () => vi.advanceTimersByTime(60_000));
    expect(check).toHaveBeenCalledTimes(1);
  });
});
