import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newBoardId } from '../../src/shared/board-id';
import { BOARD_CHECK_RETRY_BASE_MS } from '../../src/shared/config';
import type { CheckResponse, CreateResponse } from '../../src/client/api';

const api = vi.hoisted(() => ({ createBoardRequest: vi.fn(), checkBoard: vi.fn() }));
vi.mock('../../src/client/api', () => api);

import { App } from '../../src/client/App';
import { HomePage } from '../../src/client/pages/HomePage';
import { nextBoardPageState } from '../../src/client/pages/state';

const FAILED = "Couldn't create a board. Please try again.";

function visit(path: string) {
  history.replaceState(null, '', path);
  return render(<App />);
}

beforeEach(() => { api.createBoardRequest.mockReset(); api.checkBoard.mockReset(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('Home page (share.create, share.create_failure)', () => {
  it('shows the product, description and New board', () => {
    visit('/');
    expect(screen.getByRole('heading', { name: 'vidi6' })).toBeTruthy();
    expect(screen.getByText('A shared board for thinking together')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New board' })).toBeTruthy();
  });

  it('TC-16 click → Creating… (disabled) → navigates to /b/<id>', async () => {
    const id = newBoardId();
    let resolve!: (r: CreateResponse) => void;
    api.createBoardRequest.mockReturnValue(new Promise<CreateResponse>((r) => { resolve = r; }));
    api.checkBoard.mockResolvedValue({ kind: 'exists' });
    visit('/');
    await userEvent.click(screen.getByRole('button', { name: 'New board' }));
    const busy = screen.getByRole('button', { name: 'Creating…' }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    await act(async () => { resolve({ kind: 'created', id }); });
    expect(location.pathname).toBe(`/b/${id}`);
    expect(await screen.findByRole('button', { name: 'Share' })).toBeTruthy();
  });

  it.each([['500', { kind: 'failed' } as CreateResponse], ['network error', { kind: 'failed' } as CreateResponse]])(
    'TC-17 failure (%s) → message, button enabled, still on /', async (_label, response) => {
      api.createBoardRequest.mockResolvedValue(response);
      visit('/');
      await userEvent.click(screen.getByRole('button', { name: 'New board' }));
      expect(await screen.findByText(FAILED)).toBeTruthy();
      expect((screen.getByRole('button', { name: 'New board' }) as HTMLButtonElement).disabled).toBe(false);
      expect(location.pathname).toBe('/');
    },
  );

  it('a second attempt after failure can succeed', async () => {
    const id = newBoardId();
    api.createBoardRequest.mockResolvedValueOnce({ kind: 'failed' }).mockResolvedValueOnce({ kind: 'created', id });
    api.checkBoard.mockResolvedValue({ kind: 'exists' });
    visit('/');
    await userEvent.click(screen.getByRole('button', { name: 'New board' }));
    await userEvent.click(await screen.findByRole('button', { name: 'New board' }));
    await screen.findByRole('button', { name: 'Share' });
    expect(location.pathname).toBe(`/b/${id}`);
  });

  it('HomePage renders standalone', () => {
    render(<HomePage />);
    expect(screen.getByRole('button', { name: 'New board' })).toBeTruthy();
  });
});

describe('Board page (share.open_link, share.not_found, share.unreachable)', () => {
  it('TC-19 malformed id → Board not found, no request', () => {
    visit('/b/bad');
    expect(screen.getByRole('heading', { name: 'Board not found' })).toBeTruthy();
    expect(api.checkBoard).not.toHaveBeenCalled();
  });

  it('unknown route → Board not found', () => {
    visit('/nowhere');
    expect(screen.getByRole('heading', { name: 'Board not found' })).toBeTruthy();
  });

  it('TC-20 not_found → Opening board… then Board not found with New board and home link', async () => {
    let resolve!: (r: CheckResponse) => void;
    api.checkBoard.mockReturnValue(new Promise<CheckResponse>((r) => { resolve = r; }));
    visit(`/b/${newBoardId()}`);
    expect(screen.getByText('Opening board…')).toBeTruthy();
    await act(async () => { resolve({ kind: 'not_found' }); });
    expect(screen.getByRole('heading', { name: 'Board not found' })).toBeTruthy();
    expect(screen.getByText('Check the link, or ask the person who shared it to send it again.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New board' })).toBeTruthy();
    expect(screen.getByRole('link').getAttribute('href')).toBe('/');
    expect(api.createBoardRequest).not.toHaveBeenCalled();
  });

  it('TC-21 unreachable twice then exists: retries after base then 2x, 3 calls', async () => {
    vi.useFakeTimers();
    api.checkBoard
      .mockResolvedValueOnce({ kind: 'unreachable' })
      .mockResolvedValueOnce({ kind: 'unreachable' })
      .mockResolvedValueOnce({ kind: 'exists' });
    visit(`/b/${newBoardId()}`);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByText("Couldn't reach vidi6. Retrying…")).toBeTruthy();
    expect(api.checkBoard).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(BOARD_CHECK_RETRY_BASE_MS - 1); });
    expect(api.checkBoard).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(api.checkBoard).toHaveBeenCalledTimes(2);

    await act(async () => { await vi.advanceTimersByTimeAsync(BOARD_CHECK_RETRY_BASE_MS * 2 - 1); });
    expect(api.checkBoard).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(api.checkBoard).toHaveBeenCalledTimes(3);
    expect(screen.queryByText("Couldn't reach vidi6. Retrying…")).toBeNull();
    expect(screen.getByRole('button', { name: 'Share' })).toBeTruthy();
  });

  it('retry timers are cleared on unmount', async () => {
    vi.useFakeTimers();
    api.checkBoard.mockResolvedValue({ kind: 'unreachable' });
    const view = visit(`/b/${newBoardId()}`);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    view.unmount();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(api.checkBoard).toHaveBeenCalledTimes(1);
  });
});

describe('nextBoardPageState', () => {
  it('caps the retry delay at RECONNECT_MAX_BACKOFF_MS', () => {
    const s = nextBoardPageState({ kind: 'checking' }, { kind: 'unreachable' }, 20);
    expect(s).toEqual({ kind: 'unreachable', attempt: 20, nextRetryMs: 10_000 });
    expect(nextBoardPageState({ kind: 'checking' }, { kind: 'unreachable' }, 1)).toMatchObject({ nextRetryMs: 1000 });
    expect(nextBoardPageState({ kind: 'checking' }, { kind: 'not_found' }, 1)).toEqual({ kind: 'not_found' });
  });
});
