import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/client/App';
import { boardPath } from '../../src/client/router';
import { BOARD_CHECK_RETRY_BASE_MS } from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';
import {
  CREATE_FAILED_MESSAGE,
  NOT_FOUND_HEADING,
  NOT_FOUND_MESSAGE,
  OPENING_BOARD_MESSAGE,
  UNREACHABLE_MESSAGE,
} from '../../src/client/pages/state';

/**
 * The pages of story 5, in jsdom (TC-16, TC-17, TC-19, TC-20, TC-21).
 *
 * What is faked here is the *transport*, not the pages: `fetch` is replaced, so the
 * real `api.ts` decisions — 201 versus 500 versus no answer, 200 versus 404 versus no
 * answer — are the ones under test, and the URL each call used is visible. The board
 * itself is mounted for real too, with a `WebSocket` that never opens, because "the
 * board appeared" is part of what these tests have to notice.
 */

type Answer = { status: number; body?: unknown } | { throws: true } | { pending: true };

interface Recorded {
  method: string;
  url: string;
  body: BodyInit | null | undefined;
}

const answers: Answer[] = [];
const requests: Recorded[] = [];
const socketUrls: string[] = [];

/**
 * A socket that never opens. The board page's job ends at "this link is a board, join
 * it"; what happens next is story 3's tests, and a jsdom that connected for real would
 * only make these tests slower and less reproducible.
 */
class SilentSocket {
  binaryType = 'arraybuffer';
  readyState = 0;
  constructor(url: string) {
    socketUrls.push(url);
  }
  addEventListener(): void {}
  removeEventListener(): void {}
  send(): void {}
  close(): void {
    this.readyState = 3;
  }
}

beforeEach(() => {
  answers.length = 0;
  requests.length = 0;
  socketUrls.length = 0;
  vi.stubGlobal(
    'WebSocket',
    class extends SilentSocket {
      constructor(url: string) {
        super(url);
      }
    },
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : String(input);
      requests.push({ method: (init?.method ?? 'GET').toUpperCase(), url, body: init?.body });
      // The last answer repeats: a page that asks more times than it should fails
      // the call-count assertions instead of running out of answers.
      const answer = answers.length > 1 ? (answers.shift() as Answer) : (answers[0] as Answer);
      if (!answer) throw new Error(`no canned answer for ${requests.length}: ${url}`);
      if ('throws' in answer) throw new TypeError('Failed to fetch');
      if ('pending' in answer) return new Promise<Response>(() => undefined);
      return new Response(JSON.stringify(answer.body ?? {}), {
        status: answer.status,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** Render the app at an address, as a person arriving with that link would. */
function renderAt(path: string): void {
  window.history.pushState({}, '', path);
  render(<App />);
}

/** Let queued promises and timers run up to the point a test wants to look at. */
async function settleUi(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

/** Flush the answer of one request, however it was queued. */
async function settleNetwork(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const boardHeading = (): boolean => screen.queryByTestId('board-page-checking') !== null;
const linkInputValue = (): string => (screen.getByTestId('share-link') as HTMLInputElement).value;

describe('home page (TC-16, TC-17)', () => {
  it('TC-16 New board asks the server, waits, and moves the address to what came back', async () => {
    const boardId = newBoardId();
    answers.push({ status: 201, body: { id: boardId } }, { pending: true });
    renderAt('/');

    const button = screen.getByTestId('new-board-button');
    fireEvent.click(button);
    // The button says what it is doing and cannot be pressed again (PRD share.create_more).
    expect(button.textContent).toBe('Creating…');
    expect((button as HTMLButtonElement).disabled).toBe(true);

    await settleUi();

    expect(window.location.pathname).toBe(boardPath(boardId));
    // The home page does not render a board, and neither does the address it sent us
    // to: `BoardPage` is still asking whether that board exists (TC-21 in e2e).
    expect(boardHeading()).toBe(true);
    expect(screen.queryByTestId('board')).toBeNull();

    expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      'POST /api/boards',
      `GET /api/boards/${boardId}`,
    ]);
    // A creation carries nothing: there is nothing to say yet.
    expect(requests[0]!.body).toBeUndefined();
  });

  it('TC-16 a second click while the first is still out does not ask again', async () => {
    answers.push({ pending: true });
    renderAt('/');
    const button = screen.getByTestId('new-board-button');
    fireEvent.click(button);
    fireEvent.click(button); // disabled, and the state machine refuses it as well
    await settleUi();
    expect(requests.filter((r) => r.method === 'POST')).toHaveLength(1);
  });

  for (const [why, answer] of [
    ['the server answered 500', { status: 500 }],
    ['the server could not be reached', { throws: true }],
  ] as const) {
    it(`TC-17 New board when ${why} says so and stays on the home page`, async () => {
      answers.push(answer as Answer);
      renderAt('/');
      const button = screen.getByTestId('new-board-button');
      fireEvent.click(button);
      await settleNetwork();

      expect(screen.getByTestId('create-error').textContent).toBe(CREATE_FAILED_MESSAGE);
      // The button is pressable again — this is a retry, not a dead end.
      expect((screen.getByTestId('new-board-button') as HTMLButtonElement).disabled).toBe(false);
      expect(screen.getByTestId('new-board-button').textContent).toBe('New board');
      // Negative half: the address did not move, and no board was rendered.
      expect(window.location.pathname).toBe('/');
      expect(screen.queryByTestId('board')).toBeNull();
      expect(screen.getByTestId('home-page')).toBeTruthy();
    });
  }

  it('TC-18 no page ever makes a board id: the one from the response is used everywhere', async () => {
    const boardId = newBoardId();
    answers.push({ status: 201, body: { id: boardId } }, { status: 200 }, { status: 200 });
    renderAt('/');

    fireEvent.click(screen.getByTestId('new-board-button'));
    await settleNetwork();

    // One request made the board, and every address the app used afterwards carries
    // the id that came back in it — including the one the panel would show.
    expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      'POST /api/boards',
      `GET /api/boards/${boardId}`,
    ]);
    expect(window.location.pathname).toBe(boardPath(boardId));
    fireEvent.click(screen.getByTestId('share-button'));
    expect(linkInputValue()).toBe(`${window.location.origin}${boardPath(boardId)}`);
    // And every address that names a board names that one board: the only id this run
    // ever had was the one it was given (PRD share.new_board, share.home_page).
    const named = requests
      .filter((r) => r.url.startsWith('/api/boards/'))
      .map((r) => r.url.slice('/api/boards/'.length));
    expect(named.length).toBeGreaterThan(0);
    expect(new Set(named).size).toBe(1);
    expect(named[0]).toBe(boardId);
  });
});

describe('board page (TC-19, TC-20, TC-21)', () => {
  it('TC-19 an address that cannot name a board is answered without any request', async () => {
    renderAt('/b/bad');
    await settleUi();

    expect(screen.getByTestId('not-found-page')).toBeTruthy();
    expect(screen.getByRole('heading', { name: NOT_FOUND_HEADING })).toBeTruthy();
    // Negative: nothing was sent, because the address was never a board address.
    expect(requests).toEqual([]);
    expect(screen.queryByTestId('board')).toBeNull();
  });

  it('TC-20 a link to a board that is not there reports it after saying what it is doing', async () => {
    const boardId = newBoardId();
    answers.push({ status: 404 });
    renderAt(boardPath(boardId));

    // What the person sees while the question is in the air.
    expect(screen.getByTestId('board-page-checking').textContent).toContain(OPENING_BOARD_MESSAGE);
    await settleNetwork();

    expect(screen.getByTestId('not-found-page')).toBeTruthy();
    expect(screen.getByText(NOT_FOUND_MESSAGE)).toBeTruthy();
    // The way out of a dead link is the same action the home page has.
    expect(screen.getByTestId('new-board-button')).toBeTruthy();
    expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual([`GET /api/boards/${boardId}`]);
    expect(screen.queryByTestId('board')).toBeNull();

    // And from there a New board does make a board, on the server and in the bar.
    // (The answers are replaced rather than added to: the queue above is already spent.)
    const created = newBoardId();
    answers.splice(0, answers.length, { status: 201, body: { id: created } }, { pending: true });
    fireEvent.click(screen.getByTestId('new-board-button'));
    await settleUi();
    expect(window.location.pathname).toBe(boardPath(created));
  });

  it('TC-21 a service that does not answer is retried with growing waits, then the board opens', async () => {
    vi.useFakeTimers();
    const boardId = newBoardId();
    answers.push({ throws: true }, { throws: true }, { status: 200 });
    renderAt(boardPath(boardId));

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId('board-page-unreachable').textContent).toContain(UNREACHABLE_MESSAGE);
    expect(requests).toHaveLength(1);
    // Every one of these is a question, never a command: the board page must not be
    // able to create the board it is only trying to open (TC-14).
    expect(requests.every((r) => r.method === 'GET')).toBe(true);

    // First retry after BOARD_CHECK_RETRY_BASE_MS, and not one ms earlier.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BOARD_CHECK_RETRY_BASE_MS - 1);
    });
    expect(requests).toHaveLength(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(requests).toHaveLength(2);

    // Second retry after twice that wait.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BOARD_CHECK_RETRY_BASE_MS * 2 - 1);
    });
    expect(requests).toHaveLength(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(requests).toHaveLength(3);

    // The third answer was yes, so the board is there — no reload, no click.
    expect(screen.queryByTestId('board-page-unreachable')).toBeNull();
    expect(screen.getByTestId('board').getAttribute('data-board-id')).toBe(boardId);
    // …and it joined the room whose link was shared, not another one.
    expect(socketUrls).toHaveLength(1);
    expect(socketUrls[0]).toContain(`/api/rooms/${boardId}`);
  });

  it('TC-21 leaving the board page stops the checking and any retry waiting for it', async () => {
    vi.useFakeTimers();
    answers.push({ throws: true });
    renderAt(boardPath(newBoardId()));
    await act(async () => {
      await Promise.resolve();
    });
    expect(requests).toHaveLength(1);

    // Back to the home page: the pending retry must not keep asking afterwards.
    act(() => {
      window.history.pushState({}, '', '/');
      fireEvent.popState(window);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BOARD_CHECK_RETRY_BASE_MS * 4);
    });
    expect(requests).toHaveLength(1);
    expect(screen.getByTestId('home-page')).toBeTruthy();
  });
});
