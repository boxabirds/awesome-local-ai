// Component tests for story 5's pages: what the home page does with a click, and
// what the board page does with an answer about a link.
//
// `api.ts` is mocked, because what is under test is the page's reaction to an answer,
// not the HTTP that produced it (the real `api.ts` against a stubbed `fetch`, and the
// endpoints themselves, are integration's job).
//
// The board page's retries run on fake timers: the backoff is seconds long, and a test
// that waited for it in real time would eventually fail for the wrong reason.

// The mock factory is hoisted above the imports, so the object it builds lives inside
// `vi.hoisted` and is aliased here.
const api = vi.hoisted(() => ({
  createBoardRequest: vi.fn(),
  checkBoard: vi.fn(),
}));

vi.mock('../../src/client/api', () => api);

import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Y from 'yjs';
import App from '../../src/client/App';
import { BoardScreen } from '../../src/client/pages/BoardPage';
import { BOARD_CHECK_RETRY_BASE_MS } from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';
import { retroBoard } from '../fixtures/boards';

/** The answers the service gives, in the shape `api.ts` passes them on. */
const EXISTS = { kind: 'exists' } as const;
const NOT_FOUND = { kind: 'not_found' } as const;
const UNREACHABLE = { kind: 'unreachable' } as const;

/** Look up a test id on the rendered screen. */
const element = (id: string): HTMLElement | null =>
  document.querySelector(`[data-testid="${id}"]`);

/** What a test id says, or `null` when it is not on the screen. */
const text = (id: string): string | null => element(id)?.textContent ?? null;

const present = (id: string): boolean => element(id) !== null;

function button(id: string): HTMLButtonElement {
  const el = element(id);
  if (el === null) throw new Error(`no button ${id}`);
  return el as HTMLButtonElement;
}

/**
 * Run the fake clock, and let React finish what the timers it fired set in motion:
 * a state update made in a promise continuation is rendered on a microtask, which a
 * bare `advanceTimersByTime` would leave unrendered.
 */
async function tick(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Put the window at an address before the app is rendered. */
function at(pathname: string): void {
  window.history.pushState({}, '', pathname);
}

beforeEach(() => {
  at('/');
  api.createBoardRequest.mockReset();
  api.checkBoard.mockReset();
  // A board page that is not the subject of a test should open, not start retrying.
  api.checkBoard.mockResolvedValue(EXISTS);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('home page: New board (TC-16, TC-17)', () => {
  it('TC-16 clicks New board, sees it working, and ends up at the new board', async () => {
    const id = newBoardId();
    // The answer is ours to release, so the state in between is observable.
    let respond!: (value: { kind: 'created'; id: string }) => void;
    api.createBoardRequest.mockReturnValue(
      new Promise<{ kind: 'created'; id: string }>((resolve) => {
        respond = resolve;
      }),
    );

    render(<App />);
    const newBoard = button('new-board');
    expect(newBoard.textContent).toBe('New board');
    expect(newBoard.disabled).toBe(false);

    fireEvent.click(newBoard);

    // While the service is being asked, the button says what it is doing - and
    // cannot be clicked again into making a second board.
    expect(newBoard.disabled).toBe(true);
    expect(newBoard.textContent).toBe('Creating…');
    // The address has not moved yet: it may only name a board that exists.
    expect(window.location.pathname).toBe('/');

    respond({ kind: 'created', id });
    await waitFor(() => expect(window.location.pathname).toBe(`/b/${id}`));
    // And the page that arrives asks whether that board is there, like any other.
    await waitFor(() => expect(api.checkBoard).toHaveBeenCalledWith(id));
  });

  it('TC-17 keeps the person at home when the service answers 500', async () => {
    api.createBoardRequest.mockResolvedValue({ kind: 'failed' });

    render(<App />);
    const newBoard = button('new-board');
    fireEvent.click(newBoard);

    await waitFor(() =>
      expect(text('home-under')).toBe("Couldn't create a board. Please try again."),
    );
    // The click is available again, and the address never moved.
    expect(newBoard.disabled).toBe(false);
    expect(newBoard.textContent).toBe('New board');
    expect(window.location.pathname).toBe('/');
    // Negative: no board was opened, checked or created behind the message.
    expect(api.checkBoard).not.toHaveBeenCalled();
  });

  it('TC-17 keeps the person at home when there is no service to answer', async () => {
    // The other half of TC-17: not a refusal, an absence. `api.ts` turns that into the
    // same `{kind:'failed'}`; a page that only handled a refusal would keep its
    // spinner turning on a network that is gone.
    api.createBoardRequest.mockRejectedValue(new TypeError('Failed to fetch'));

    render(<App />);
    const newBoard = button('new-board');
    fireEvent.click(newBoard);

    await waitFor(() =>
      expect(text('home-under')).toBe("Couldn't create a board. Please try again."),
    );
    expect(newBoard.disabled).toBe(false);
    expect(window.location.pathname).toBe('/');
  });

  it('TC-16 a second click while the first is still in flight makes no second board', async () => {
    // The button is disabled while creating, so the second click cannot even reach the
    // service, and the page is never left holding two answers to compare.
    api.createBoardRequest.mockReturnValue(new Promise(() => undefined));
    render(<App />);
    const newBoard = button('new-board');
    fireEvent.click(newBoard);
    fireEvent.click(newBoard);
    expect(api.createBoardRequest).toHaveBeenCalledTimes(1);
  });
});

describe('board page: what an address may say about itself (TC-19, TC-20, TC-21)', () => {
  it('TC-19 an address that cannot name a board is Board not found, and is never asked', () => {
    at('/b/bad');
    render(<App />);
    expect(text('not-found-heading')).toBe('Board not found');
    expect(text('not-found-detail')).toBe(
      'Check the link, or ask the person who shared it to send it again.',
    );
    // Negative: a malformed id is not a question worth sending.
    expect(api.checkBoard).not.toHaveBeenCalled();
  });

  it('TC-19 a link cut short is Board not found, not an empty board', () => {
    // The accident this story exists for: a truncated link used to open a blank board,
    // which is indistinguishable from one somebody wiped.
    const id = newBoardId();
    at(`/b/${id.slice(0, 21)}`);
    render(<App />);
    expect(present('not-found-page')).toBe(true);
    expect(present('board-viewport')).toBe(false);
    expect(api.checkBoard).not.toHaveBeenCalled();
  });

  it('TC-20 a link the service says is not there opens nothing and says so', async () => {
    const id = newBoardId();
    at(`/b/${id}`);
    api.checkBoard.mockResolvedValue(NOT_FOUND);

    render(<App />);
    // What is shown while the answer is on its way.
    expect(text('checking-message')).toBe('Opening board…');

    await waitFor(() => expect(present('not-found-page')).toBe(true));
    expect(present('board-checking')).toBe(false);
    // The page offers a way forward: the same New board action, and the way home.
    expect(text('not-found-new-board')).toBe('New board');
    expect(button('not-found-new-board').disabled).toBe(false);
    expect(document.querySelector('[data-testid="not-found-home"]')?.getAttribute('href')).toBe('/');    // Negative: opening an unknown link creates nothing.
    expect(api.createBoardRequest).not.toHaveBeenCalled();
    // Negative: and it was asked once. A verdict is not retried.
    expect(api.checkBoard).toHaveBeenCalledTimes(1);
  });

  it('TC-21 a service that cannot be reached retries on a backoff and opens the board when it can', async () => {
    vi.useFakeTimers();
    const id = newBoardId();
    at(`/b/${id}`);
    api.checkBoard
      .mockResolvedValueOnce(UNREACHABLE)
      .mockResolvedValueOnce(UNREACHABLE)
      .mockResolvedValue(EXISTS);

    render(<App />);
    await tick(0);

    // The first no-answer: the page says what it is doing, and does not call it Board
    // not found - a service we cannot reach is not a board that is missing.
    expect(api.checkBoard).toHaveBeenCalledTimes(1);
    expect(text('unreachable-message')).toBe("Couldn't reach vidi6. Retrying…");
    expect(present('not-found-page')).toBe(false);

    // The second: still no answer, and the wait before the next try has doubled.
    await tick(BOARD_CHECK_RETRY_BASE_MS - 1);
    expect(api.checkBoard).toHaveBeenCalledTimes(1);
    await tick(1);
    expect(api.checkBoard).toHaveBeenCalledTimes(2);

    // The third answers, and the board opens with nobody reloading the page.
    await tick(BOARD_CHECK_RETRY_BASE_MS * 2);
    expect(api.checkBoard).toHaveBeenCalledTimes(3);
    expect(present('board-viewport')).toBe(true);
    // A board reached by its link is a board you can share, with no sign-in between.
    expect(text('share-button')).toBe('Share');

    // Negative: no polling once a board is open.
    await tick(BOARD_CHECK_RETRY_BASE_MS * 10);
    expect(api.checkBoard).toHaveBeenCalledTimes(3);
  });

  it('TC-21 leaving the page stops the retrying', async () => {
    vi.useFakeTimers();
    at(`/b/${newBoardId()}`);
    api.checkBoard.mockResolvedValue(UNREACHABLE);

    const { unmount } = render(<App />);
    await tick(0);
    expect(api.checkBoard).toHaveBeenCalledTimes(1);

    unmount();
    // Negative: a page nobody is looking at asks nobody.
    await tick(BOARD_CHECK_RETRY_BASE_MS * 5);
    expect(api.checkBoard).toHaveBeenCalledTimes(1);
  });

  it('TC-21 a service that comes back to say the board is not there is believed', async () => {
    // `unreachable` is a reason to try again; `not_found` is an answer. A page that
    // cannot tell them apart keeps polling a board that will never arrive.
    vi.useFakeTimers();
    const id = newBoardId();
    at(`/b/${id}`);
    api.checkBoard.mockResolvedValueOnce(UNREACHABLE).mockResolvedValue(NOT_FOUND);

    render(<App />);
    await tick(0);
    await tick(BOARD_CHECK_RETRY_BASE_MS);
    expect(present('not-found-page')).toBe(true);

    await tick(BOARD_CHECK_RETRY_BASE_MS * 10);
    expect(api.checkBoard).toHaveBeenCalledTimes(2);
  });

  it('TC-20 New board on the Board not found page makes a board like the home page does', async () => {
    const id = newBoardId();
    at(`/b/${newBoardId()}`);
    api.checkBoard.mockResolvedValue(NOT_FOUND);
    api.createBoardRequest.mockResolvedValue({ kind: 'created', id });

    render(<App />);
    await waitFor(() => expect(present('not-found-page')).toBe(true));
    fireEvent.click(button('not-found-new-board'));

    await waitFor(() => expect(window.location.pathname).toBe(`/b/${id}`));
  });
});

describe('board screen: the board itself, which story 5 does not change', () => {
  it('renders a document handed to it, with no address to check and no link to share', () => {
    const doc: Y.Doc = retroBoard().doc;
    render(<BoardScreen doc={doc} />);
    expect(present('board-viewport')).toBe(true);
    // A board with no address of its own has nothing to share.
    expect(present('share-button')).toBe(false);
    expect(api.checkBoard).not.toHaveBeenCalled();
  });
});
