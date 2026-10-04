/**
 * The pages story 5 puts between an address and a board (share.pages).
 *
 * The API is stubbed at the one place it is real — `fetch` — rather than at
 * `api.ts`, because half of what these pages have to get right is what a status code
 * means: 404 is "this board does not exist", 500 is "we cannot tell yet", and mixing
 * those two up is the difference between an honest "Board not found" and a board that
 * is quietly thrown away at an address where nobody created one (share.not_found).
 *
 * There is no server here, and the tests do not need one: what is under test is which
 * page a given answer produces, how long a retry waits, and that a failed request
 * leaves the person where they were with the button working.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import App from '../../src/client/App';
import { boardPath } from '../../src/client/router';
import { BOARD_CHECK_RETRY_BASE_MS } from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';

/** What the stubbed transport does next. A rejected promise is a dead connection. */
type Handler = (url: string, method: string) => Response | Promise<Response>;

let requests: string[] = [];
let handler: Handler = () => new Response('{}', { status: 500 });

beforeEach(() => {
  window.history.pushState({}, '', '/');
  requests = [];
  handler = () => new Response('{}', { status: 500 });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : String(input);
      requests.push(url);
      return handler(url, init?.method ?? 'GET');
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Let the page finish what a request started, and optionally pass some time. The
 * request itself is a promise, so this is the smallest thing that makes the next
 * assertion about "what the person sees now" honest.
 */
async function settle(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function offline(): Promise<never> {
  return Promise.reject(new TypeError('Failed to fetch'));
}

it('TC-16: New board says Creating… and then opens the board it made', async () => {
  const id = newBoardId();
  let created!: () => void;
  handler = (url) =>
    url.endsWith('/api/boards')
      ? new Promise<Response>((resolve) => {
          created = () => resolve(jsonResponse({ id }, 201));
        })
      : jsonResponse({ exists: true }, 200);

  render(<App />);
  const button = screen.getByTestId('new-board-button') as HTMLButtonElement;
  fireEvent.click(button);

  // The button is busy and cannot be pressed twice: two requests would mean two
  // boards, one of which the person never sees.
  expect(button.disabled).toBe(true);
  expect(button.textContent).toBe('Creating…');
  expect(requests.filter((url) => url.endsWith('/api/boards'))).toHaveLength(1);

  await act(async () => {
    created();
  });
  await settle();

  expect(window.location.pathname).toBe(boardPath(id));
  expect(screen.getByTestId('board-viewport')).not.toBeNull();
});

for (const [label, fail] of [
  ['a 500 from the API', () => new Response('{}', { status: 500 })],
  ['no connection at all', offline],
] as [string, () => Response | Promise<Response>][]) {
  it(`TC-17: a New board that fails (${label}) says so and stays put`, async () => {
    // Only the create is tried: a failure must not send the page off looking for a
    // board that was never made.
    handler = (_url, method) => {
      expect(method).toBe('POST');
      return fail();
    };

    render(<App />);
    const button = screen.getByTestId('new-board-button') as HTMLButtonElement;
    fireEvent.click(button);
    await settle();

    expect(screen.getByTestId('create-error')?.textContent).toContain("Couldn't create a board. Please try again.");
    // Nothing was opened, and nothing else was tried.
    expect(window.location.pathname).toBe('/');
    expect(requests.filter((url) => url.includes('/api/boards/'))).toHaveLength(0);

    // The button works again: the failure asks for a retry, it does not end the visit.
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe('New board');

    // Second run: this time it goes through.
    const id = newBoardId();
    handler = (_url, method) =>
      method === 'POST' ? jsonResponse({ id }, 201) : jsonResponse({ exists: true }, 200);
    fireEvent.click(button);
    await settle();
    expect(screen.queryByTestId('create-error')).toBeNull();
    expect(window.location.pathname).toBe(boardPath(id));
  });
}

it('TC-19: an address that is not a board code never asks the server', () => {
  window.history.pushState({}, '', '/b/bad');
  render(<App />);

  expect(screen.getByTestId('not-found-page')?.textContent).toContain('Board not found');
  // The negative half: a malformed code cannot name a board, so no request goes out
  // to find out.
  expect(requests).toEqual([]);
});

it('TC-20: an unknown code checks, then says Board not found', async () => {
  const id = newBoardId();
  handler = () => jsonResponse({ error: 'not_found' }, 404);
  window.history.pushState({}, '', boardPath(id));

  render(<App />);
  expect(screen.getByTestId('board-opening')?.textContent).toContain('Opening board…');

  await settle();
  expect(screen.getByTestId('not-found-page')?.textContent).toContain('Board not found');
  // The way out the person can actually take from here.
  expect(screen.getByTestId('new-board-button')).not.toBeNull();
  // And the page did not go and create the board to make the message go away.
  expect(requests.filter((url) => url.endsWith('/api/boards'))).toHaveLength(0);
});

it('TC-21: an unreachable service is retried with a growing delay, then opens', async () => {
  const id = newBoardId();
  let checks = 0;
  handler = () => {
    checks += 1;
    return checks <= 2 ? offline() : jsonResponse({ exists: true }, 200);
  };
  window.history.pushState({}, '', boardPath(id));

  render(<App />);
  await settle();
  expect(checks).toBe(1);
  expect(screen.getByTestId('board-unreachable')?.textContent).toContain("Couldn't reach vidi6. Retrying…");

  // The first retry waits BOARD_CHECK_RETRY_BASE_MS — and not a moment before.
  await settle(BOARD_CHECK_RETRY_BASE_MS - 1);
  expect(checks).toBe(1);
  await settle(1);
  expect(checks).toBe(2);
  expect(screen.getByTestId('board-unreachable')).not.toBeNull();

  // The second wait is twice as long, and then the answer arrives: the board opens
  // without the person reloading, which is the whole point of waiting rather than
  // giving up.
  await settle(BOARD_CHECK_RETRY_BASE_MS * 2 - 1);
  expect(checks).toBe(2);
  await settle(1);
  expect(checks).toBe(3);
  expect(screen.queryByTestId('board-unreachable')).toBeNull();
  expect(screen.getByTestId('board-viewport')).not.toBeNull();
});
