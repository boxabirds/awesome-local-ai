/**
 * Story 5: board API client (share.board_api HTTP contract, client side).
 */
export type CreateResponse = { kind: 'created'; id: string } | { kind: 'failed' };
export type CheckResponse =
  | { kind: 'exists' }
  | { kind: 'not_found' }
  | { kind: 'unreachable' };

/**
 * POST /api/boards. Returns 'created' with the id on 201, 'failed' for any
 * other response (500 create_failed, non-201, network error).
 */
export async function createBoardRequest(): Promise<CreateResponse> {
  try {
    const res = await fetch('/api/boards', { method: 'POST' });
    if (res.status === 201) {
      const body = (await res.json()) as { id?: unknown };
      if (typeof body.id === 'string' && body.id.length > 0) {
        return { kind: 'created', id: body.id };
      }
    }
    return { kind: 'failed' };
  } catch {
    return { kind: 'failed' };
  }
}

/**
 * GET /api/boards/:id. 200 → exists, 404 → not_found,
 * network error / other status → unreachable.
 */
export async function checkBoard(id: string): Promise<CheckResponse> {
  try {
    const res = await fetch(`/api/boards/${encodeURIComponent(id)}`);
    if (res.status === 200) return { kind: 'exists' };
    if (res.status === 404) return { kind: 'not_found' };
    return { kind: 'unreachable' };
  } catch {
    return { kind: 'unreachable' };
  }
}
