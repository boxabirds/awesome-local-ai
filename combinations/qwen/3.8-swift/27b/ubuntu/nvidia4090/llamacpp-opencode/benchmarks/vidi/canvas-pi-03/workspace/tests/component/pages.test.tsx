/**
 * Story 5: page state-machine component tests (share.create, share.open_link,
 * share.not_found). checkBoard / createBoardRequest are mocked per test
 * (setup.ts defaults both to success); the board URL is pushed per test.
 *
 * TC-16: home page renders name, description and the Create a board action.
 * TC-17: create success → disabled "Creating…" → navigate → board mounts.
 * TC-18: create 429 → rate-limit message, button re-enabled, retry works.
 * TC-19: create 5xx → generic failure message, button re-enabled, retry works.
 * TC-20: /b/<valid> + 404 → Board not found page.
 * TC-21: /b/<malformed> → Board not found WITHOUT a checkBoard request.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { App } from 'src/client/App';
import { checkBoard, createBoardRequest } from 'src/client/api';
import { boardReady, advanceUntil } from './ready';

const VALID_ID = 'abcdefghijklmnopqrstuv';

beforeEach(() => {
  vi.mocked(checkBoard).mockReset();
  vi.mocked(checkBoard).mockResolvedValue({ kind: 'exists' });
  vi.mocked(createBoardRequest).mockReset();
  // Created ids must be valid board codes (22 base64url chars) — the board
  // page treats malformed ids as not-found without a request.
  vi.mocked(createBoardRequest).mockResolvedValue({ kind: 'created', id: 'aaaaaaaaaaaaaaaaaaaaaa' });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('share.create (home page)', () => {
  it('TC-16: / renders the product name, description and the Create a board button', () => {
    window.history.pushState({}, '', '/');
    render(<App />);
    expect(screen.getByRole('heading', { name: 'vidi6' })).toBeTruthy();
    expect(screen.getByText('A shared board for thinking together')).toBeTruthy();
    const button = screen.getByRole('button', { name: 'Create a board' });
    expect(button).toBeEnabled();
  });

  it('TC-17: create success → disabled "Creating…" → navigates to /b/<id> and the board mounts', async () => {
    window.history.pushState({}, '', '/');
    render(<App />);
    const button = screen.getByRole('button', { name: 'Create a board' });
    fireEvent.click(button);
    // While the request is in flight: disabled + Creating…
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent('Creating…');
    // The mocked 201 resolves → navigation to the new board, which exists.
    await boardReady();
    expect(window.location.pathname).toBe('/b/aaaaaaaaaaaaaaaaaaaaaa');
    expect(vi.mocked(createBoardRequest)).toHaveBeenCalledTimes(1);
  });

  it('TC-18: create 429 → rate-limit message, button re-enabled; retry succeeds', async () => {
    window.history.pushState({}, '', '/');
    vi.mocked(createBoardRequest)
      .mockResolvedValueOnce({ kind: 'rate_limited' })
      .mockResolvedValueOnce({ kind: 'created', id: 'bbbbbbbbbbbbbbbbbbbbbb' });
    render(<App />);
    const button = screen.getByRole('button', { name: 'Create a board' });
    fireEvent.click(button);
    await screen.findByText(/too quickly/i);
    expect(button).toBeEnabled();
    // Retry succeeds and navigates.
    fireEvent.click(button);
    await boardReady();
    expect(window.location.pathname).toBe('/b/bbbbbbbbbbbbbbbbbbbbbb');
  });

  it('TC-19: create 5xx → generic failure message, button re-enabled; retry succeeds', async () => {
    window.history.pushState({}, '', '/');
    vi.mocked(createBoardRequest)
      .mockResolvedValueOnce({ kind: 'failed' })
      .mockResolvedValueOnce({ kind: 'created', id: 'cccccccccccccccccccccc' });
    render(<App />);
    const button = screen.getByRole('button', { name: 'Create a board' });
    fireEvent.click(button);
    await screen.findByText("Couldn't create a board. Please try again.");
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await boardReady();
    expect(window.location.pathname).toBe('/b/cccccccccccccccccccccc');
  });
});

describe('share.open_link / share.not_found (board page)', () => {
  it('TC-20: /b/<valid> + 404 → the Board not found page', async () => {
    vi.mocked(checkBoard).mockResolvedValueOnce({ kind: 'not_found' });
    window.history.pushState({}, '', `/b/${VALID_ID}`);
    render(<App />);
    await screen.findByRole('heading', { name: 'Board not found' });
    expect(screen.getByRole('button', { name: 'Create a new board' })).toBeTruthy();
  });

  it('TC-21: /b/<malformed> → Board not found without any existence request', async () => {
    window.history.pushState({}, '', '/b/bad!id');
    render(<App />);
    await screen.findByRole('heading', { name: 'Board not found' });
    expect(vi.mocked(checkBoard)).not.toHaveBeenCalled();
  });

  it('share.unreachable: /b/<valid> + 5xx → "Couldn\u2019t reach vidi6. Retrying…" then recovers on retry', async () => {
    vi.useFakeTimers();
    vi.mocked(checkBoard)
      .mockResolvedValueOnce({ kind: 'unreachable' })
      .mockResolvedValueOnce({ kind: 'exists' });
    window.history.pushState({}, '', `/b/${VALID_ID}`);
    render(<App />);
    // findBy* cannot poll under fake timers: advance time until the state
    // (and React's re-render) is visible.
    await advanceUntil(
      () => screen.queryByText("Couldn't reach vidi6. Retrying…"),
      vi,
    );
    // Backoff: BOARD_CHECK_RETRY_BASE_MS = 1000 → the retry succeeds and the
    // board mounts.
    await advanceUntil(() => screen.queryByTestId('board-viewport'), vi);
    vi.useRealTimers();
  });

  it('share.open_link happy path: /b/<valid> + 200 → the board mounts (with Share button)', async () => {
    window.history.pushState({}, '', `/b/${VALID_ID}`);
    render(<App />);
    await boardReady();
    expect(screen.getByTestId('share-button')).toBeTruthy();
    expect(vi.mocked(checkBoard)).toHaveBeenCalledWith(VALID_ID);
  });
});
