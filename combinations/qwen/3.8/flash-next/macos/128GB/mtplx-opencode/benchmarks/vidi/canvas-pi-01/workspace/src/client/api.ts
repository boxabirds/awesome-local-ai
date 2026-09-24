/**
 * Story 5 · typed fetch wrappers for the board API (design "Board creation and
 * existence API" / "Home, board and not-found pages").
 *
 * Two facts drive the whole client story: "make me a board" and "does this
 * board exist?". Both are answered here so the pages deal in *outcomes*, never
 * in status codes, and so a network failure is a value (`failed` /
 * `unreachable`) rather than an exception the UI has to remember to catch.
 *
 * The mapping is deliberately lossy in one direction only: `5xx` on a check is
 * `unreachable` (the service might come back, so retrying is right), `404` is
 * `not_found` (retrying cannot help). A create that returns `201` but a body we
 * cannot read is treated as a failure rather than trusted.
 */

export type CreateResponse =
  | { kind: 'created'; id: string }
  | { kind: 'rate_limited' }
  | { kind: 'failed' };

export type CheckResponse =
  | { kind: 'exists' }
  | { kind: 'not_found' }
  | { kind: 'unreachable' };

/** The board endpoint, relative to the page so dev / preview / prod all agree. */
export const BOARDS_ENDPOINT = '/api/boards';

/**
 * Ask the Worker for a fresh board. Network errors and every unexpected status
 * collapse into `failed`; only `429` means "wait", which is what the home page
 * needs to show the rate-limit copy instead of the failure copy.
 */
export async function createBoardRequest(): Promise<CreateResponse> {
  let response: Response;
  try {
    response = await fetch(BOARDS_ENDPOINT, { method: 'POST' });
  } catch {
    return { kind: 'failed' };
  }

  if (response.status === 429) return { kind: 'rate_limited' };
  if (response.status !== 201) return { kind: 'failed' };

  try {
    const body = (await response.json()) as { id?: unknown };
    return typeof body.id === 'string' && body.id.length > 0
      ? { kind: 'created', id: body.id }
      : { kind: 'failed' };
  } catch {
    return { kind: 'failed' };
  }
}

/**
 * Does board `id` exist? `200` → yes, `404` → no, anything else (including a
 * thrown fetch) → `unreachable`, which the board page retries with backoff
 * instead of telling the visitor their link is wrong (PRD share.unreachable).
 */
export async function checkBoard(id: string): Promise<CheckResponse> {
  let response: Response;
  try {
    response = await fetch(`${BOARDS_ENDPOINT}/${encodeURIComponent(id)}`);
  } catch {
    return { kind: 'unreachable' };
  }
  if (response.status === 200) return { kind: 'exists' };
  if (response.status === 404) return { kind: 'not_found' };
  return { kind: 'unreachable' };
}
