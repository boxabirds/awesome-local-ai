/**
 * The browser's typed wrappers around the board API (story 5, `share.pages`).
 *
 * Two calls, each reduced to a small closed set of outcomes so the pages can be
 * state machines rather than `try`/`catch` soup: a create either yields a board
 * or failed; a check either says the board exists, says it does not, or says the
 * service could not be reached. Network errors are folded into those outcomes —
 * they are never thrown to the caller.
 */

export type CreateResponse = { kind: 'created'; id: string } | { kind: 'failed' };

export type CheckResponse =
  | { kind: 'exists' }
  | { kind: 'not_found' }
  | { kind: 'unreachable' };

/** Ask the service for a new board. A non-201 or a network error is `failed`. */
export async function createBoardRequest(): Promise<CreateResponse> {
  try {
    const response = await fetch('/api/boards', { method: 'POST' });
    if (response.status === 201) {
      const body = (await response.json()) as { id?: unknown };
      if (typeof body.id === 'string') return { kind: 'created', id: body.id };
    }
    return { kind: 'failed' };
  } catch {
    return { kind: 'failed' };
  }
}

/**
 * Does this board exist?
 *
 * `200` exists, `404` not found; a network error or a server-side `5xx` is
 * `unreachable`, which the board page retries automatically (share.unreachable).
 */
export async function checkBoard(id: string): Promise<CheckResponse> {
  try {
    const response = await fetch(`/api/boards/${encodeURIComponent(id)}`);
    if (response.status === 200) return { kind: 'exists' };
    if (response.status === 404) return { kind: 'not_found' };
    if (response.status >= 500) return { kind: 'unreachable' };
    // Any other 4xx the server might answer is treated as not-found: nothing a
    // person can act on except that there is no board here.
    return { kind: 'not_found' };
  } catch {
    return { kind: 'unreachable' };
  }
}
