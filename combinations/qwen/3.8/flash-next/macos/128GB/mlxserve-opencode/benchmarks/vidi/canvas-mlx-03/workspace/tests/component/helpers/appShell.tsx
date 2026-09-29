// Shared setup for story 5's component tests: drive the app by URL and answer its
// API calls without a network.
//
// The URL is the entry point in this story, so these tests put the app at a path
// (`atPath`) and render the real `App` — the same component `main.tsx` mounts — so
// what is asserted is the route the visitor lands on, not a component picked by the
// test. Every fetch the app makes is answered by `answerBoardApi`, whose handlers
// are declared per test; anything unhandled is a test bug and throws loudly rather
// than silently looking like a service outage.

import { vi } from 'vitest';
import App from '../../../src/client/App.tsx';
import { newBoardId } from '../../../src/shared/board-id.ts';

export interface ApiResponse {
  /** Omitted when there is no answer at all (`networkError`). */
  status?: number;
  body?: unknown;
  /** Reject instead of answering, the way a network failure looks. */
  networkError?: boolean;
}

/** A handler answers either right away or later, so in-flight states are testable. */
export type BoardApiHandler = (method: string, url: string) => ApiResponse | Promise<ApiResponse>;

/** A `Response`-shaped object with only what `src/client/api.ts` reads. */
async function reply(source: ApiResponse | Promise<ApiResponse>): Promise<unknown> {
  const response = await source;
  if (response.networkError) return Promise.reject(new TypeError('Failed to fetch'));
  const status = response.status ?? 0;
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => response.body,
  };
}

/**
 * Install a fetch mock. Returns the mock so tests can count calls and change
 * answers mid-test.
 */
export function mockBoardApi(handler: BoardApiHandler) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    if (url.startsWith('/api/')) return reply(await handler(method, url));
    throw new Error(`component test: unexpected fetch ${method} ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Put the jsdom document at a path, the way the router reads it. */
export function atPath(path: string): void {
  window.history.replaceState({}, '', path);
}

/** A board id the router will accept as a board path. */
export function boardPathOf(id = newBoardId()): string {
  return `/b/${id}`;
}

/** Let queued promise callbacks run (the app's checks are all async). */
export async function settle(times = 8): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

export { App };
