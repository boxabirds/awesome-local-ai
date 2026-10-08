/**
 * Page component tests (story 5, TC-16, TC-17, TC-19, TC-20, TC-21):
 * the router-driven App with the board API mocked at the module boundary
 * (the y-websocket provider is already faked globally in setup.ts, so a
 * "ready" board renders without any network).
 *
 * Note: `role="alert"` has nameFrom=author, so the error message is
 * asserted by text, not by role+name.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../src/client/App';
import * as api from '../../src/client/api';
import type { CreateResponse } from '../../src/client/api';
import { newBoardId } from '../../src/shared/board-id';
import { BOARD_CHECK_RETRY_BASE_MS } from '../../src/shared/config';

vi.mock('../../src/client/api', () => ({
  createBoardRequest: vi.fn(),
  checkBoard: vi.fn(),
}));

const mockCreate = vi.mocked(api.createBoardRequest);
const mockCheck = vi.mocked(api.checkBoard);

const CREATE_FAILED_MESSAGE = "Couldn't create a board. Please try again.";
const NOT_FOUND_TEXT = 'Check the link, or ask the person who shared it to send it again.';
const RETRYING_TEXT = "Couldn't reach vidi6. Retrying…";

/** Points the jsdom location at `path` and updates the route. */
function setPath(path: string): void {
  window.history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCheck.mockResolvedValue({ kind: 'exists' });
  setPath('/');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('home page (share.create)', () => {
  it('TC-16: click New board → "Creating…" (disabled) → navigate to /b/<id> and render the board', async () => {
    let resolveCreate!: (result: CreateResponse) => void;
    mockCreate.mockImplementation(
      () =>
        new Promise<CreateResponse>((resolve) => {
          resolveCreate = resolve;
        }),
    );
    render(<App />);
    expect(screen.getByText('vidi6')).toBeTruthy();
    expect(screen.getByText('A shared board for thinking together')).toBeTruthy();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'New board' }));
    expect(mockCreate).toHaveBeenCalledTimes(1);

    // creating: the button shows the pending state and is disabled
    const creating = screen.getByRole('button', { name: 'Creating…' }) as HTMLButtonElement;
    expect(creating.disabled).toBe(true);

    const id = newBoardId();
    await act(async () => {
      resolveCreate({ kind: 'created', id });
    });
    await waitFor(() => expect(window.location.pathname).toBe(`/b/${id}`));
    // the board page checks the (mocked-existing) board and renders it
    await screen.findByTestId('app-root');
  });

  it('TC-17 (api 500): error under the button, button re-enabled, still on the home page', async () => {
    // A 500 maps to { kind: 'failed' } in the API client.
    mockCreate.mockResolvedValue({ kind: 'failed', message: CREATE_FAILED_MESSAGE });
    render(<App />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'New board' }));

    await screen.findByText(CREATE_FAILED_MESSAGE);
    expect((screen.getByRole('button', { name: 'New board' }) as HTMLButtonElement).disabled).toBe(false);
    expect(window.location.pathname).toBe('/');
  });

  it('TC-17 (network failure): same recovery as a 500', async () => {
    // A network failure rejects at the request boundary; the page recovers
    // the same way as a 500.
    mockCreate.mockRejectedValue(new Error('offline'));
    render(<App />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'New board' }));

    await screen.findByText(CREATE_FAILED_MESSAGE);
    expect((screen.getByRole('button', { name: 'New board' }) as HTMLButtonElement).disabled).toBe(false);
    expect(window.location.pathname).toBe('/');
  });
});

describe('board page (share.not_found / share.unreachable)', () => {
  it('TC-19: a malformed id renders Board not found immediately without any existence check', async () => {
    setPath('/b/bad');
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Board not found' })).toBeTruthy();
    expect(screen.getByText(NOT_FOUND_TEXT)).toBeTruthy();
    expect(mockCheck).not.toHaveBeenCalled();
  });

  it('TC-20: a 404 check shows "Opening board…" then the Board not found page', async () => {
    const id = newBoardId();
    mockCheck.mockResolvedValue({ kind: 'not_found' });
    setPath(`/b/${id}`);
    render(<App />);

    // while the check is in flight the loading state is shown
    expect(screen.getByText('Opening board…')).toBeTruthy();

    await screen.findByRole('heading', { name: 'Board not found' });
    expect(screen.getByText(NOT_FOUND_TEXT)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New board' })).toBeTruthy();
    expect(screen.getByTestId('back-home').getAttribute('href')).toBe('/');
    expect(mockCheck).toHaveBeenCalledTimes(1);
  });

  it('TC-21: an unreachable service retries with 1s then 2s backoff, then renders the board', async () => {
    vi.useFakeTimers();
    const id = newBoardId();
    let calls = 0;
    mockCheck.mockImplementation(async () => {
      calls += 1;
      return calls < 3 ? { kind: 'unreachable' } : ({ kind: 'exists' } as const);
    });
    setPath(`/b/${id}`);
    render(<App />);

    // first attempt (mount) fails: the retrying state shows.
    await act(async () => {
      await Promise.resolve();
    });
    expect(calls).toBe(1);
    expect(screen.getByText(RETRYING_TEXT)).toBeTruthy();

    // after BOARD_CHECK_RETRY_BASE_MS the second attempt runs…
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BOARD_CHECK_RETRY_BASE_MS);
    });
    expect(calls).toBe(2);
    expect(screen.getByText(RETRYING_TEXT)).toBeTruthy();

    // …and after a doubled delay the third attempt succeeds and the board
    // renders. (Synchronous assertions only: interval-based findBy* never
    // fires under fake timers.)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BOARD_CHECK_RETRY_BASE_MS * 2);
    });
    expect(calls).toBe(3);
    expect(screen.getByTestId('app-root')).toBeTruthy();
    expect(screen.queryByText(RETRYING_TEXT)).toBeNull();
  });
});
