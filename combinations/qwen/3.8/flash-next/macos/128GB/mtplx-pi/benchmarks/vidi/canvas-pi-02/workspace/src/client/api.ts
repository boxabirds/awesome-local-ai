/**
 * The client's two calls to the board API (story 5, task 1.2).
 *
 * Both take a `fetchImpl` seam so the component tests can drive success,
 * failure and slow responses without a network (design "Component"). Neither
 * throws for a 404: a missing board is an answer, not an error, and the caller
 * decides what it looks like. A *thrown* fetch (network down) is surfaced, so
 * the "does this board exist" check can tell "no" from "I couldn't ask".
 */

/** The fetch signature these helpers need — the real `fetch` fits it. */
export type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>;

/** What "does this board exist?" resolved to. */
export type BoardCheck =
  | { status: 'exists'; id: string }
  | { status: 'not_found' }
  /** The request itself failed (offline / 5xx): the caller retries or warns. */
  | { status: 'unavailable' };

/** What "make a board" resolved to. */
export type CreateOutcome =
  | { status: 'created'; id: string }
  | { status: 'rate_limited' }
  | { status: 'failed' };

/**
 * Ask for a new board.
 *
 * The id is made on the server, so this returns the address to open rather
 * than an address it guessed. 201 → the id; 429 → the visitor is creating too
 * quickly; anything else → a plain failure the caller shows as "Could not
 * create a board".
 */
export async function createBoard(
  fetchImpl: FetchImpl = (...args) => fetch(...args),
): Promise<CreateOutcome> {
  let response: Response;
  try {
    response = await fetchImpl('/api/boards', { method: 'POST' });
  } catch {
    return { status: 'failed' };
  }
  if (response.status === 201) {
    try {
      const body = (await response.json()) as { id?: unknown };
      if (typeof body.id === 'string' && body.id.length > 0) {
        return { status: 'created', id: body.id };
      }
    } catch {
      // A 201 without a usable body is as good as a failure.
    }
    return { status: 'failed' };
  }
  if (response.status === 429) return { status: 'rate_limited' };
  return { status: 'failed' };
}

/**
 * Ask whether a board exists.
 *
 * 200 → it does; 404 (or a malformed id) → it does not; a throw or any other
 * status → "unavailable", which the caller retries with a capped backoff
 * rather than treating as a missing board. An unknown board must never be
 * allowed to fall through into a connection attempt.
 */
export async function checkBoard(
  boardId: string,
  fetchImpl: FetchImpl = (...args) => fetch(...args),
): Promise<BoardCheck> {
  let response: Response;
  try {
    response = await fetchImpl(`/api/boards/${encodeURIComponent(boardId)}`);
  } catch {
    return { status: 'unavailable' };
  }
  if (response.status === 200) return { status: 'exists', id: boardId };
  if (response.status === 404) return { status: 'not_found' };
  return { status: 'unavailable' };
}