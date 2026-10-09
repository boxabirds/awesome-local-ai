/**
 * Board API client (story 5, share.board_api).
 *
 * Network errors are mapped to results, never thrown: a flaky service must
 * keep the page retryable (share.flaky_service).
 */
export type CreateResponse = { kind: 'created'; id: string } | { kind: 'failed' };

export type CheckResponse = { kind: 'exists' } | { kind: 'not_found' } | { kind: 'unreachable' };

/** POST /api/boards — create a board. Any failure maps to { kind: 'failed' }. */
export async function createBoardRequest(): Promise<CreateResponse> {
  try {
    const res = await fetch('/api/boards', { method: 'POST' });
    if (res.status !== 201) return { kind: 'failed' };
    const body = (await res.json()) as { id?: unknown };
    return typeof body.id === 'string' ? { kind: 'created', id: body.id } : { kind: 'failed' };
  } catch {
    return { kind: 'failed' };
  }
}

/** GET /api/boards/:id — the board page's existence check. */
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
