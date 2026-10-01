// The client's two calls to the board API (share.pages). Thin, typed fetch
// wrappers that turn the HTTP contract into a small discriminated result, so the
// pages handle outcomes rather than status codes and thrown network errors.
//
// The paths come from `shared/routes` so the address a person opens
// (`/b/<id>`) and the address the client asks about (`/api/boards/<id>`) are
// derived from the same id, unchanged. Everything is same-origin (relative paths):
// the board's link is never aimed at a third-party origin (privacy).
const BOARDS_API = '/api/boards';

/** The outcome of asking the server to create a board. */
export type CreateResponse = { kind: 'created'; id: string } | { kind: 'failed' };

/** The outcome of asking whether a board exists. */
export type CheckResponse = { kind: 'exists' } | { kind: 'not_found' } | { kind: 'unreachable' };

/**
 * Ask the server for a new board. `created` carries its id; anything else — a
 * 500 `create_failed` or a network error that never reached the service — is
 * `failed`, which the Home page shows as a retryable error rather than throwing
 * (share.create_failure).
 */
export async function createBoardRequest(): Promise<CreateResponse> {
  let response: Response;
  try {
    response = await fetch(BOARDS_API, { method: 'POST' });
  } catch {
    return { kind: 'failed' };
  }
  if (response.status !== 201) return { kind: 'failed' };
  const id = await readId(response);
  return id === null ? { kind: 'failed' } : { kind: 'created', id };
}

/**
 * Ask whether a board exists. A 200 is `exists`, a 404 is `not_found`, and a
 * network error or any 5xx is `unreachable` — the state the board page retries on,
 * rather than telling the person their board is gone when the service is only
 * unreachable (share.unreachable).
 */
export async function checkBoard(id: string): Promise<CheckResponse> {
  let response: Response;
  try {
    response = await fetch(`${BOARDS_API}/${encodeURIComponent(id)}`);
  } catch {
    return { kind: 'unreachable' };
  }
  if (response.status === 404) return { kind: 'not_found' };
  if (response.ok) return { kind: 'exists' };
  return { kind: 'unreachable' };
}

/** Pull the `id` out of a JSON response body, or null if it is not there. */
async function readId(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { id?: unknown };
    return typeof body.id === 'string' ? body.id : null;
  } catch {
    return null;
  }
}
