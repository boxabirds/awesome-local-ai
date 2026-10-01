// The client's side of the board API (see `src/worker/index.ts` for the server).
//
// Two calls, and the whole of their job is to turn an HTTP outcome into one of a
// few answers the pages can act on. The distinction they keep is the one the PRD
// cares about:
//
//   - `not_found` is an answer about the *board* - it does not exist, and nothing
//     will be created at that address. That is what the Board not found page may
//     say, and it may only be said when the service actually said so.
//   - `unreachable` is an answer about the *service* - a network failure or a 5xx,
//     including the Worker's own 500 when a storage read made the question
//     unanswerable. Retrying is the right response, so it is what the page does.
//   - `failed` says nothing about why creation did not happen. There is nothing
//     useful a person could do with a reason, and nothing to retry against.
//
// Nothing here throws: a page that has to catch an exception ends up showing a
// stack where it should have shown a message.

/** `POST /api/boards`. */
export type CreateResponse = { kind: 'created'; id: string } | { kind: 'failed' };

/** `GET /api/boards/:id`. */
export type CheckResponse =
  | { kind: 'exists' }
  | { kind: 'not_found' }
  | { kind: 'unreachable' };

const BOARDS_URL = '/api/boards';

/** Ask the service for a board of its own. */
export async function createBoardRequest(): Promise<CreateResponse> {
  try {
    const response = await fetch(BOARDS_URL, { method: 'POST' });
    if (!response.ok) return { kind: 'failed' };
    const body: unknown = await response.json();
    const id =
      body !== null && typeof body === 'object' && typeof (body as { id?: unknown }).id === 'string'
        ? (body as { id: string }).id
        : null;
    // A 201 whose body does not name a board is not a board: navigating to
    // `/b/null` or `/b/undefined` would be worse than saying it failed.
    return id === null || id === '' ? { kind: 'failed' } : { kind: 'created', id };
  } catch {
    // No response at all: the service, or the link to it, is not there.
    return { kind: 'failed' };
  }
}

/** Ask whether the board behind this link exists. Writes nothing, wherever it lands. */
export async function checkBoard(id: string): Promise<CheckResponse> {
  try {
    const response = await fetch(`${BOARDS_URL}/${encodeURIComponent(id)}`);
    if (response.ok) return { kind: 'exists' };
    if (response.status === 404) return { kind: 'not_found' };
    return { kind: 'unreachable' };
  } catch {
    return { kind: 'unreachable' };
  }
}
