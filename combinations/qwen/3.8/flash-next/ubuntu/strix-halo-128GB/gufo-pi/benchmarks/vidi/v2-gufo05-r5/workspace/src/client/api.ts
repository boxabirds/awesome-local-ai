/**
 * Typed fetch wrappers for the board API.
 *
 * Network errors and 5xx are mapped to `failed`/`unreachable` so callers handle
 * them as page states, never as thrown exceptions.
 */
export type CreateResponse = { kind: 'created'; id: string } | { kind: 'failed' };
export type CheckResponse =
  | { kind: 'exists' }
  | { kind: 'not_found' }
  | { kind: 'unreachable' };

/**
 * Requests board creation. Returns `{ kind: 'created', id }` on 201,
 * `{ kind: 'failed' }` on any other response or network error.
 */
export async function createBoardRequest(): Promise<CreateResponse> {
  try {
    const response = await fetch('/api/boards', { method: 'POST' });
    if (response.status === 201) {
      const body = (await response.json()) as { id: string };
      return { kind: 'created', id: body.id };
    }
    return { kind: 'failed' };
  } catch {
    return { kind: 'failed' };
  }
}

/**
 * Checks whether a board exists. Returns:
 * - `{ kind: 'exists' }` on 200
 * - `{ kind: 'not_found' }` on 404
 * - `{ kind: 'unreachable' }` on network error or 5xx
 */
export async function checkBoard(id: string): Promise<CheckResponse> {
  try {
    const response = await fetch(`/api/boards/${encodeURIComponent(id)}`);
    if (response.status === 200) return { kind: 'exists' };
    if (response.status === 404) return { kind: 'not_found' };
    // 5xx or unexpected status → unreachable
    return { kind: 'unreachable' };
  } catch {
    return { kind: 'unreachable' };
  }
}
