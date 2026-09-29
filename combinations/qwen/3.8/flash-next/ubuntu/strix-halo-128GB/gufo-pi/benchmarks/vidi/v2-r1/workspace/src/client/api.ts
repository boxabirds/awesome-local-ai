/**
 * Typed fetch wrappers for the board API.
 */

export type CreateResponse = { kind: 'created'; id: string } | { kind: 'failed' };
export type CheckResponse = { kind: 'exists' } | { kind: 'not_found' } | { kind: 'unreachable' };

/**
 * POST /api/boards to create a new board.
 * Returns 'created' with the id, or 'failed' on 5xx or network error.
 */
export async function createBoardRequest(): Promise<CreateResponse> {
  try {
    const res = await fetch('/api/boards', { method: 'POST' });
    if (res.status === 201) {
      const body = await res.json() as { id: string };
      return { kind: 'created', id: body.id };
    }
    return { kind: 'failed' };
  } catch {
    return { kind: 'failed' };
  }
}

/**
 * GET /api/boards/:id to check board existence.
 * Returns 'exists' for 200, 'not_found' for 404, 'unreachable' for network error or 5xx.
 */
export async function checkBoard(id: string): Promise<CheckResponse> {
  try {
    const res = await fetch(`/api/boards/${id}`);
    if (res.status === 200) return { kind: 'exists' };
    if (res.status === 404) return { kind: 'not_found' };
    // 5xx or unexpected status → unreachable
    return { kind: 'unreachable' };
  } catch {
    return { kind: 'unreachable' };
  }
}
