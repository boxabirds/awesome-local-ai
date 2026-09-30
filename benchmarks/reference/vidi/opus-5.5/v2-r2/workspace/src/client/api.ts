// Typed wrappers for the board API (share.board_api).

export type CreateResponse = { kind: 'created'; id: string } | { kind: 'failed' };
export type CheckResponse = { kind: 'exists' } | { kind: 'not_found' } | { kind: 'unreachable' };

/** POST /api/boards. Any error (5xx, network, unexpected body) → failed. */
export async function createBoardRequest(): Promise<CreateResponse> {
  try {
    const response = await fetch('/api/boards', { method: 'POST', headers: { Accept: 'application/json' } });
    if (response.status !== 201) return { kind: 'failed' };
    const body = (await response.json()) as { id?: unknown };
    return typeof body.id === 'string' ? { kind: 'created', id: body.id } : { kind: 'failed' };
  } catch {
    return { kind: 'failed' };
  }
}

/** GET /api/boards/:id. 404 → not_found; network errors and 5xx (and anything unexpected) → unreachable. */
export async function checkBoard(id: string): Promise<CheckResponse> {
  try {
    const response = await fetch(`/api/boards/${encodeURIComponent(id)}`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (response.status === 200) return { kind: 'exists' };
    if (response.status === 404) return { kind: 'not_found' };
    return { kind: 'unreachable' };
  } catch {
    return { kind: 'unreachable' };
  }
}
