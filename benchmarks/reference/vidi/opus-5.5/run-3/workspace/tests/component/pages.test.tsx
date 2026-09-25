import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Root } from '../../src/client/App';
import { BoardPage } from '../../src/client/pages/BoardPage';
import { checkBoard, createBoardRequest, type CheckResponse, type CreateResponse } from '../../src/client/api';
import { newBoardId } from '../../src/shared/board-id';
import { BOARD_CHECK_RETRY_BASE_MS } from '../../src/shared/config';

vi.mock('../../src/client/api', () => ({ createBoardRequest: vi.fn(), checkBoard: vi.fn() }));
// The board itself (stories 1–4) mounts in Ready; its live connection is not under test here.
vi.mock('../../src/client/sync/connectBoard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/client/sync/connectBoard')>()),
  connectBoard: vi.fn(() => ({ destroy: () => undefined })),
}));

const create = vi.mocked(createBoardRequest);
const check = vi.mocked(checkBoard);

const FAILED = "Couldn't create a board. Please try again.";
const RATE_LIMITED = "You're creating boards too quickly. Wait a minute and try again.";
const UNREACHABLE = "Couldn't reach vidi6. Retrying…";

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function at(path: string) {
  window.history.replaceState(null, '', path);
}

const flush = () => act(async () => {});

beforeEach(() => {
  create.mockReset();
  check.mockReset();
  check.mockImplementation(() => new Promise<CheckResponse>(() => undefined));
});

afterEach(() => at('/'));

describe('share.pages: home', () => {
  it('shows the product name, the description and Create a board', () => {
    at('/');
    render(<Root />);
    expect(screen.getByRole('heading', { name: 'vidi6' })).toBeInTheDocument();
    expect(screen.getByText('A shared board for thinking together')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create a board' })).toBeEnabled();
  });

  it('TC-16 Create a board shows Creating… (disabled), then opens the new board', async () => {
    at('/');
    const pending = deferred<CreateResponse>();
    create.mockReturnValue(pending.promise);
    render(<Root />);
    fireEvent.click(screen.getByRole('button', { name: 'Create a board' }));
    const busy = screen.getByRole('button', { name: 'Creating…' });
    expect(busy).toBeDisabled();
    fireEvent.click(busy);
    expect(create).toHaveBeenCalledTimes(1);

    const id = newBoardId();
    await act(async () => pending.resolve({ kind: 'created', id }));
    expect(window.location.pathname).toBe(`/b/${id}`);
    expect(screen.getByText('Opening board…')).toBeInTheDocument();
    expect(check).toHaveBeenCalledWith(id);
  });

  it.each([
    ['500 from the service', { kind: 'failed' } as CreateResponse],
    ['a network error', null],
  ])('TC-17 creation failing (%s) keeps the person on the home page with a message', async (_label, response) => {
    at('/');
    if (response) create.mockResolvedValue(response);
    else create.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<Root />);
    fireEvent.click(screen.getByRole('button', { name: 'Create a board' }));
    await flush();
    expect(screen.getByRole('alert')).toHaveTextContent(FAILED);
    expect(screen.getByRole('button', { name: 'Create a board' })).toBeEnabled();
    expect(window.location.pathname).toBe('/');
  });

  it('TC-18 creating too quickly shows the rate-limit message; the button is available again', async () => {
    at('/');
    create.mockResolvedValue({ kind: 'rate_limited' });
    render(<Root />);
    fireEvent.click(screen.getByRole('button', { name: 'Create a board' }));
    await flush();
    expect(screen.getByRole('alert')).toHaveTextContent(RATE_LIMITED);
    expect(screen.getByRole('button', { name: 'Create a board' })).toBeEnabled();
    expect(window.location.pathname).toBe('/');
  });
});

describe('share.pages: opening a link', () => {
  it('TC-19 a malformed id is Board not found without asking the service', () => {
    at('/b/bad');
    render(<Root />);
    expect(screen.getByRole('heading', { name: 'Board not found' })).toBeInTheDocument();
    expect(screen.getByText('Check the link, or ask the person who shared it to send it again.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create a new board' })).toBeEnabled();
    expect(screen.getByRole('link', { name: 'Go to the home page' })).toHaveAttribute('href', '/');
    expect(check).not.toHaveBeenCalled();
  });

  it('any other address is Board not found too', () => {
    at('/somewhere/else');
    render(<Root />);
    expect(screen.getByRole('heading', { name: 'Board not found' })).toBeInTheDocument();
    expect(check).not.toHaveBeenCalled();
  });

  it('TC-20 an unknown id shows Opening board…, then Board not found with Create a new board', async () => {
    const id = newBoardId();
    at(`/b/${id}`);
    const pending = deferred<CheckResponse>();
    check.mockReturnValue(pending.promise);
    render(<Root />);
    expect(screen.getByText('Opening board…')).toBeInTheDocument();
    expect(screen.queryByTestId('board-viewport')).not.toBeInTheDocument();
    await act(async () => pending.resolve({ kind: 'not_found' }));
    expect(screen.getByRole('heading', { name: 'Board not found' })).toBeInTheDocument();
    expect(screen.queryByTestId('board-viewport')).not.toBeInTheDocument();

    // Create a new board is the home page's create action.
    const created = newBoardId();
    create.mockResolvedValue({ kind: 'created', id: created });
    fireEvent.click(screen.getByRole('button', { name: 'Create a new board' }));
    await flush();
    expect(window.location.pathname).toBe(`/b/${created}`);
  });

  it('the home link on Board not found goes home', () => {
    at('/b/bad');
    render(<Root />);
    fireEvent.click(screen.getByRole('link', { name: 'Go to the home page' }));
    expect(window.location.pathname).toBe('/');
    expect(screen.getByRole('button', { name: 'Create a board' })).toBeInTheDocument();
  });

  it('TC-21 unreachable twice, then the board opens: retries after the base delay, then twice that', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const id = newBoardId();
    check
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ kind: 'unreachable' })
      .mockResolvedValue({ kind: 'exists' });
    render(<BoardPage id={id} />);
    await flush();
    expect(screen.getByText(UNREACHABLE)).toBeInTheDocument();
    expect(check).toHaveBeenCalledTimes(1);

    await act(() => vi.advanceTimersByTimeAsync(BOARD_CHECK_RETRY_BASE_MS - 1));
    expect(check).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(check).toHaveBeenCalledTimes(2);
    expect(screen.getByText(UNREACHABLE)).toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(2 * BOARD_CHECK_RETRY_BASE_MS - 1));
    expect(check).toHaveBeenCalledTimes(2);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(check).toHaveBeenCalledTimes(3);
    expect(screen.getByTestId('board-viewport')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument();
    expect(screen.queryByText(UNREACHABLE)).not.toBeInTheDocument();
  });

  it('retry timers stop when the page goes away', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    check.mockResolvedValue({ kind: 'unreachable' });
    const { unmount } = render(<BoardPage id={newBoardId()} />);
    await flush();
    unmount();
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(check).toHaveBeenCalledTimes(1);
  });
});
