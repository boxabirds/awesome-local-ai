import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOARD_CHECK_RETRY_BASE_MS } from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';

vi.mock('../../src/client/api', () => ({ createBoardRequest: vi.fn(), checkBoard: vi.fn() }));
vi.mock('../../src/client/App', () => ({ App: ({ boardId }: { boardId?: string }) => <div data-testid="board">{boardId}</div> }));

import { checkBoard, createBoardRequest } from '../../src/client/api';
import { Root } from '../../src/client/Root';
import { BoardPage } from '../../src/client/pages/BoardPage';
import { HomePage } from '../../src/client/pages/HomePage';

const create = vi.mocked(createBoardRequest);
const check = vi.mocked(checkBoard);

beforeEach(() => {
  history.replaceState(null, '', '/');
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe('HomePage', () => {
  it('shows the product name, tagline and New board', () => {
    render(<HomePage />);
    expect(screen.getByRole('heading', { name: 'vidi6' })).toBeTruthy();
    expect(screen.getByText('A shared board for thinking together')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New board' })).toBeTruthy();
  });

  it('TC-16: click shows Creating… disabled, then navigates to /b/<id>', async () => {
    let resolve!: (v: { kind: 'created'; id: string }) => void;
    create.mockReturnValue(new Promise((r) => (resolve = r)));
    const id = newBoardId();
    render(<Root />);
    fireEvent.click(screen.getByRole('button', { name: 'New board' }));
    const busy = screen.getByRole('button', { name: 'Creating…' }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    check.mockReturnValue(new Promise(() => {}));
    await act(async () => resolve({ kind: 'created', id }));
    expect(location.pathname).toBe(`/b/${id}`);
    expect(screen.getByText('Opening board…')).toBeTruthy();
  });

  it('TC-17: failed creation (500 and network error) keeps the person on / with the button enabled', async () => {
    for (let run = 0; run < 2; run++) {
      create.mockResolvedValue({ kind: 'failed' }); // api.ts maps both 5xx and network errors to failed
      const { unmount } = render(<Root />);
      fireEvent.click(screen.getByRole('button', { name: 'New board' }));
      expect(await screen.findByText("Couldn't create a board. Please try again.")).toBeTruthy();
      expect((screen.getByRole('button', { name: 'New board' }) as HTMLButtonElement).disabled).toBe(false);
      expect(location.pathname).toBe('/');
      unmount();
    }
  });
});

describe('BoardPage', () => {
  it('TC-19: a malformed id shows Board not found without a request', () => {
    render(<BoardPage id="bad" />);
    expect(screen.getByRole('heading', { name: 'Board not found' })).toBeTruthy();
    expect(screen.getByText('Check the link, or ask the person who shared it to send it again.')).toBeTruthy();
    expect(check).not.toHaveBeenCalled();
  });

  it('TC-20: not_found shows Opening board… then Board not found with New board', async () => {
    check.mockResolvedValue({ kind: 'not_found' });
    render(<BoardPage id={newBoardId()} />);
    expect(screen.getByText('Opening board…')).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Board not found' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New board' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /home/i })).toBeTruthy();
    expect(create).not.toHaveBeenCalled();
  });

  it('opens the board and the Share button when the board exists', async () => {
    const id = newBoardId();
    check.mockResolvedValue({ kind: 'exists' });
    render(<BoardPage id={id} />);
    expect((await screen.findByTestId('board')).textContent).toBe(id);
    expect(screen.getByRole('button', { name: 'Share' })).toBeTruthy();
  });

  it('TC-21: unreachable twice then exists retries after the base delay, then 2x', async () => {
    vi.useFakeTimers();
    check
      .mockResolvedValueOnce({ kind: 'unreachable' })
      .mockResolvedValueOnce({ kind: 'unreachable' })
      .mockResolvedValueOnce({ kind: 'exists' });
    const id = newBoardId();
    render(<BoardPage id={id} />);
    await act(async () => {});
    expect(screen.getByText("Couldn't reach vidi6. Retrying…")).toBeTruthy();
    expect(check).toHaveBeenCalledTimes(1);

    await act(async () => void vi.advanceTimersByTime(BOARD_CHECK_RETRY_BASE_MS - 1));
    expect(check).toHaveBeenCalledTimes(1);
    await act(async () => void vi.advanceTimersByTime(1));
    expect(check).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Couldn't reach vidi6. Retrying…")).toBeTruthy();

    await act(async () => void vi.advanceTimersByTime(2 * BOARD_CHECK_RETRY_BASE_MS - 1));
    expect(check).toHaveBeenCalledTimes(2);
    await act(async () => void vi.advanceTimersByTime(1));
    expect(check).toHaveBeenCalledTimes(3);
    expect(screen.getByTestId('board').textContent).toBe(id);
  });

  it('clears the retry timer on unmount', async () => {
    vi.useFakeTimers();
    check.mockResolvedValue({ kind: 'unreachable' });
    const { unmount } = render(<BoardPage id={newBoardId()} />);
    await act(async () => {});
    unmount();
    await act(async () => void vi.advanceTimersByTime(60_000));
    expect(check).toHaveBeenCalledTimes(1);
  });
});
