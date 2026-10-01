import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newBoardId } from '../../src/shared/board-id';
import { BOARD_CHECK_RETRY_BASE_MS } from '../../src/shared/config';
import { App } from '../../src/client/App';
import * as api from '../../src/client/api';
import { BoardPage } from '../../src/client/pages/BoardPage';
import { HomePage } from '../../src/client/pages/HomePage';

vi.mock('../../src/client/api', () => ({ createBoardRequest: vi.fn(), checkBoard: vi.fn() }));
// The board UI itself is covered elsewhere; here it only has to appear.
vi.mock('../../src/client/board/BoardApp', () => ({
  ConnectedBoard: ({ boardId }: { boardId: string }) => <div data-testid="board">{boardId}</div>,
  BoardApp: () => null,
  canEdit: () => true,
}));

const createBoardRequest = vi.mocked(api.createBoardRequest);
const checkBoard = vi.mocked(api.checkBoard);

beforeEach(() => {
  vi.clearAllMocks();
  history.replaceState(null, '', '/');
});
afterEach(() => { vi.useRealTimers(); });

describe('HomePage', () => {
  it('shows the product name, tagline and New board', () => {
    render(<HomePage />);
    expect(screen.getByRole('heading', { name: 'vidi6' })).toBeTruthy();
    expect(screen.getByText('A shared board for thinking together')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New board' })).toBeTruthy();
  });

  it('TC-16: click shows Creating… (disabled), then navigates to /b/<id>', async () => {
    const id = newBoardId();
    let resolve!: (r: api.CreateResponse) => void;
    createBoardRequest.mockReturnValue(new Promise((r) => { resolve = r; }));
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'New board' }));
    const busy = screen.getByRole('button', { name: 'Creating…' }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    expect(location.pathname).toBe('/');
    checkBoard.mockResolvedValue({ kind: 'exists' });
    await act(async () => { resolve({ kind: 'created', id }); });
    expect(location.pathname).toBe(`/b/${id}`);
    expect(await screen.findByTestId('board')).toBeTruthy();
  });

  for (const [name, result] of [['500', { kind: 'failed' }], ['network error', { kind: 'failed' }]] as const) {
    it(`TC-17: ${name} → message, button enabled, still on /`, async () => {
      createBoardRequest.mockResolvedValue(result);
      render(<HomePage />);
      fireEvent.click(screen.getByRole('button', { name: 'New board' }));
      expect(await screen.findByText("Couldn't create a board. Please try again.")).toBeTruthy();
      expect((screen.getByRole('button', { name: 'New board' }) as HTMLButtonElement).disabled).toBe(false);
      expect(location.pathname).toBe('/');
    });
  }
});

describe('BoardPage', () => {
  it('TC-19: a malformed id shows Board not found and never calls the API', () => {
    render(<BoardPage id="bad" />);
    expect(screen.getByRole('heading', { name: 'Board not found' })).toBeTruthy();
    expect(checkBoard).not.toHaveBeenCalled();
  });

  it('TC-20: not_found → Opening board… then Board not found with New board', async () => {
    let resolve!: (r: api.CheckResponse) => void;
    checkBoard.mockReturnValue(new Promise((r) => { resolve = r; }));
    render(<BoardPage id={newBoardId()} />);
    expect(screen.getByText('Opening board…')).toBeTruthy();
    await act(async () => { resolve({ kind: 'not_found' }); });
    expect(screen.getByRole('heading', { name: 'Board not found' })).toBeTruthy();
    expect(screen.getByText('Check the link, or ask the person who shared it to send it again.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New board' })).toBeTruthy();
    expect(screen.getByRole('link')).toBeTruthy();
  });

  it('TC-21: unreachable twice then exists → retry message, backoff 1x then 2x, board', async () => {
    vi.useFakeTimers();
    checkBoard
      .mockResolvedValueOnce({ kind: 'unreachable' })
      .mockResolvedValueOnce({ kind: 'unreachable' })
      .mockResolvedValueOnce({ kind: 'exists' });
    const id = newBoardId();
    render(<BoardPage id={id} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByText("Couldn't reach vidi6. Retrying…")).toBeTruthy();
    expect(checkBoard).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(BOARD_CHECK_RETRY_BASE_MS - 1); });
    expect(checkBoard).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(checkBoard).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Couldn't reach vidi6. Retrying…")).toBeTruthy();

    await act(async () => { await vi.advanceTimersByTimeAsync(2 * BOARD_CHECK_RETRY_BASE_MS - 1); });
    expect(checkBoard).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(checkBoard).toHaveBeenCalledTimes(3);
    expect(screen.getByTestId('board').textContent).toBe(id);
    expect(screen.getByRole('button', { name: 'Share' })).toBeTruthy();
  });

  it('clears the retry timer on unmount', async () => {
    vi.useFakeTimers();
    checkBoard.mockResolvedValue({ kind: 'unreachable' });
    const view = render(<BoardPage id={newBoardId()} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    view.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(checkBoard).toHaveBeenCalledTimes(1);
  });
});
