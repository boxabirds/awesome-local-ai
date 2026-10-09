import { newBoardId } from '../../../src/shared/board-id';

/**
 * The board API (`POST /api/boards`, `GET /api/boards/:id`) as component tests know it.
 *
 * The stub sits at `fetch`, not at `src/client/api.ts`, on purpose: the real client then
 * still turns a 404 into `not_found` and a 500 into `unreachable`, which is the mapping
 * the pages are built on and which a mocked `api.ts` would leave untested. `calls` is what
 * a test reads to prove a page asked — or, for TC-19, that it never asked.
 */

/** What one existence check answers. */
export type CheckOutcome = 'exists' | 'not_found' | 'unreachable';

interface Reply<T> {
  /** The response the service sends, or no answer at all. */
  readonly outcome: T | 'unreachable';
}

export interface BoardApiStubState {
  /** Default answer to `GET /api/boards/:id`. */
  check: Reply<CheckOutcome>;
  /** Default answer to `POST /api/boards`: a status, and the id it hands back. */
  create: Reply<{ status: number; id: string | null }>;
  /** Every request the app made, in order, as `METHOD /path`. */
  readonly calls: string[];
}

/** The id `POST /api/boards` answers with, refreshed by `resetBoardApiStub`. */
export let createdBoardId = newBoardId();

const boardApi: BoardApiStubState = {
  check: { outcome: 'exists' },
  create: { outcome: { status: 201, id: createdBoardId } },
  calls: [],
};

/** The id `POST /api/boards` is answering with right now (see `resetBoardApiStub`). */
export function currentCreatedBoardId(): string {
  return createdBoardId;
}

/** What the app has asked the stub service so far. */
export function apiCalls(): readonly string[] {
  return boardApi.calls;
}

/** Back to "the service is fine", with the request log empty and a fresh created id. */
export function resetBoardApiStub(): void {
  checkQueue.length = 0;
  createGate = null;
  boardApi.check = { outcome: 'exists' };
  createdBoardId = newBoardId();
  boardApi.create = { outcome: { status: 201, id: createdBoardId } };
  boardApi.calls.length = 0;
}

/** A board that exists / does not / cannot be reached. */
export function stubBoardExists(): void {
  boardApi.check = { outcome: 'exists' };
}
export function stubBoardNotFound(): void {
  boardApi.check = { outcome: 'not_found' };
}
export function stubBoardUnreachable(): void {
  boardApi.check = { outcome: 'unreachable' };
}

/**
 * Answer the next existence checks in order, repeating the last once the list runs out:
 * the way a service comes back is a sequence, not a setting (TC-21 wants two failures and
 * then a success).
 */
export function stubChecks(...outcomes: CheckOutcome[]): void {
  checkQueue.push(...outcomes);
  const last = outcomes[outcomes.length - 1];
  if (last !== undefined) boardApi.check = { outcome: last };
}
const checkQueue: CheckOutcome[] = [];

/** Creation fails the way the Worker says it does (a 500, or a code near enough to one). */
export function stubCreateFailed(status = 500): void {
  boardApi.create = { outcome: { status, id: null } };
}

/** Creation cannot be reached either. */
export function stubCreateUnreachable(): void {
  boardApi.create = { outcome: 'unreachable' };
}

/**
 * Freeze `POST /api/boards` until the test lets it go, so the moment when the button says
 * "Creating…" is a moment a test can actually look at (TC-16).
 */
export function hangCreate(): { release: () => void } {
  let release: () => void = () => {};
  createGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    release: () => {
      const gate = createGate;
      createGate = null;
      gate?.then(() => undefined);
      release();
    },
  };
}
let createGate: Promise<void> | null = null;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** A fetch that never reaches anything, because there is nothing to reach. */
function failFetch(): never {
  throw new TypeError('Failed to fetch: the board service is unreachable in a component test');
}

/**
 * Install the stub. Anything other than the two board endpoints is a mistake in the test,
 * and says so loudly rather than answering with something a test then waits for.
 */
export function installBoardApiStub(): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const target = typeof input === 'object' && 'url' in input ? input.url : String(input);
    const url = new URL(target, window.location.href);
    const method = (init?.method ?? 'GET').toUpperCase();

    if (url.pathname === '/api/boards' && method === 'POST') {
      boardApi.calls.push('POST /api/boards');
      if (createGate !== null) await createGate;
      const outcome = boardApi.create.outcome;
      if (outcome === 'unreachable') failFetch();
      return outcome.status === 201
        ? jsonResponse(201, { id: outcome.id })
        : jsonResponse(outcome.status, { error: 'create_failed' });
    }

    if (url.pathname.startsWith('/api/boards/') && method === 'GET') {
      boardApi.calls.push(`GET ${url.pathname}`);
      const next = checkQueue.shift();
      const outcome = next ?? boardApi.check.outcome;
      if (outcome === 'unreachable') failFetch();
      return outcome === 'exists'
        ? jsonResponse(200, { id: url.pathname.slice('/api/boards/'.length) })
        : jsonResponse(404, { error: 'not_found' });
    }

    throw new Error(`unexpected request from a component test: ${method} ${url.pathname}`);
  }) as typeof fetch;
}

installBoardApiStub();
