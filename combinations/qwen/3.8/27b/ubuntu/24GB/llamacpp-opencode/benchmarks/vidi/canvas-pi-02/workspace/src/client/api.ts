/**
 * Typed fetch wrappers for the board API (story 5, share.pages).
 *
 * All network errors are caught and mapped to the appropriate response
 * kind — they are never thrown to the caller.
 */

export type CreateResponse =
  | { kind: 'created'; id: string }
  | { kind: 'rate_limited' }
  | { kind: 'failed' };

export type CheckResponse =
  | { kind: 'exists' }
  | { kind: 'not_found' }
  | { kind: 'unreachable' };

/**
 * POST /api/boards → create a new board.
 * 201 → created; 429 → rate_limited; anything else → failed.
 */
export async function createBoardRequest(): Promise<CreateResponse> {
  try {
    const res = await fetch('/api/boards', { method: 'POST' });
    if (res.status === 201) {
      const body = (await res.json()) as { id: string };
      return { kind: 'created', id: body.id };
    }
    if (res.status === 429) {
      return { kind: 'rate_limited' };
    }
    return { kind: 'failed' };
  } catch {
    return { kind: 'failed' };
  }
}

/**
 * GET /api/boards/:id → check if a board exists.
 * 200 → exists; 404 → not_found; network error or 5xx → unreachable.
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
    // 5xx or any other non-200/404 status
    return { kind: 'unreachable' };
  } catch {
    return { kind: 'unreachable' };
  }
}
