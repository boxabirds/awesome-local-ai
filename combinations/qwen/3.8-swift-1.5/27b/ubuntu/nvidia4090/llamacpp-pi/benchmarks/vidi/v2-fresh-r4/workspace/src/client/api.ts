/**
 * Typed fetch wrappers for the board API.
 */

export type CreateResponse = { kind: 'created'; id: string } | { kind: 'failed' };
export type CheckResponse = { kind: 'exists' } | { kind: 'not_found' } | { kind: 'unreachable' };

/**
 * POST /api/boards — create a new board.
 * Network errors and 5xx → failed.
 */
export async function createBoardRequest(): Promise<CreateResponse> {
  try {
    const res = await fetch('/api/boards', { method: 'POST' });
    if (res.status === 201) {
      const body = (await res.json()) as { id: string };
      return { kind: 'created', id: body.id };
    }
    return { kind: 'failed' };
  } catch {
    return { kind: 'failed' };
  }
}

/**
 * GET /api/boards/:id — check if a board exists.
 * 200 → exists, 404 → not_found, network error or 5xx → unreachable.
 */
export async function checkBoard(id: string): Promise<CheckResponse> {
  try {
    const res = await fetch(`/api/boards/${id}`);
    if (res.status === 200) {
      return { kind: 'exists' };
    }
    if (res.status === 404) {
      return { kind: 'not_found' };
    }
    // 5xx or other → unreachable
    return { kind: 'unreachable' };
  } catch {
    return { kind: 'unreachable' };
  }
}
