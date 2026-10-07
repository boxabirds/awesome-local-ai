/**
 * The board API, as the client sees it (story 5, `share.pages`).
 *
 * Two calls, both deliberately unable to throw: the pages below show a person what
 * happened ("Couldn't create a board", "Couldn't reach vidi6. Retrying…"), so a
 * network failure is a *result*, never an exception that escapes to the UI.
 */

/** `POST /api/boards`. A network error is `failed`, exactly like a 500. */
export type CreateResponse = { kind: 'created'; id: string } | { kind: 'failed' };
/** `GET /api/boards/:id`. A network error or a 5xx is `unreachable`, not "gone". */
export type CheckResponse = { kind: 'exists' } | { kind: 'not_found' } | { kind: 'unreachable' };

const BOARDS_ENDPOINT = '/api/boards';

/**
 * Ask for a new board. Only a 201 with a usable id counts as created; everything
 * else — 500, a proxy error page, a connection that never completed — is `failed`,
 * which keeps the person on the home page with the button available again
 * (PRD share.create_failure).
 */
export async function createBoardRequest(): Promise<CreateResponse> {
  try {
    const response = await fetch(BOARDS_ENDPOINT, { method: 'POST' });
    if (response.status !== 201) return { kind: 'failed' };
    const body = (await response.json()) as { id?: unknown };
    return typeof body.id === 'string' && body.id.length > 0
      ? { kind: 'created', id: body.id }
      : { kind: 'failed' };
  } catch {
    return { kind: 'failed' }; // no service, no answer: the same honest outcome
  }
}

/**
 * Ask whether a board exists at this address.
 *
 * A 404 means it does not. Anything else that goes wrong — DNS, a dropped
 * connection, a 500 — means we cannot tell, and saying "not found" would be a lie
 * that buries someone's work (PRD share.unreachable).
 */
export async function checkBoard(id: string): Promise<CheckResponse> {
  try {
    const response = await fetch(`${BOARDS_ENDPOINT}/${encodeURIComponent(id)}`);
    if (response.status === 200) return { kind: 'exists' };
    if (response.status === 404) return { kind: 'not_found' };
    return { kind: 'unreachable' };
  } catch {
    return { kind: 'unreachable' };
  }
}
