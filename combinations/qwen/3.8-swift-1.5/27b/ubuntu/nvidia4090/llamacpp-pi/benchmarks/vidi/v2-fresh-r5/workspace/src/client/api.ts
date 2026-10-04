/**
 * Typed fetch wrappers for the board API (story 5). All failures are mapped
 * to result kinds — never thrown to the UI.
 */

export type CreateResponse = { kind: 'created'; id: string } | { kind: 'failed' };
export type CheckResponse =
  | { kind: 'exists' }
  | { kind: 'not_found' }
  | { kind: 'unreachable' };

/**
 * POST /api/boards (story 5, share.create). 201 → created; 5xx, other
 * statuses and network errors → `failed` (the page shows the failure
 * message and stays put).
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
 * GET /api/boards/:id (story 5, share.board_api). 200 → exists; 404 →
 * not_found; 5xx and network errors → unreachable (the board page retries
 * with backoff — the link may be fine and the service temporarily down).
 */
export async function checkBoard(id: string): Promise<CheckResponse> {
  try {
    const res = await fetch(`/api/boards/${id}`);
    if (res.status === 200) return { kind: 'exists' };
    if (res.status === 404) return { kind: 'not_found' };
    return { kind: 'unreachable' };
  } catch {
    return { kind: 'unreachable' };
  }
}
