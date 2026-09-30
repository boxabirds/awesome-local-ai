// Typed fetch wrappers for the board API (story 5).
export type CreateResponse = { kind: 'created'; id: string } | { kind: 'failed' };
export type CheckResponse = { kind: 'exists' } | { kind: 'not_found' } | { kind: 'unreachable' };

const HTTP_CREATED = 201;
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;

/** POST /api/boards. Any error, including network errors, → failed. */
export async function createBoardRequest(): Promise<CreateResponse> {
  try {
    const res = await fetch('/api/boards', { method: 'POST' });
    if (res.status !== HTTP_CREATED) return { kind: 'failed' };
    const body = (await res.json()) as { id?: unknown };
    return typeof body.id === 'string' ? { kind: 'created', id: body.id } : { kind: 'failed' };
  } catch {
    return { kind: 'failed' };
  }
}

/** GET /api/boards/:id. 404 → not_found; network errors and anything else (5xx) → unreachable. */
export async function checkBoard(id: string): Promise<CheckResponse> {
  try {
    const res = await fetch(`/api/boards/${encodeURIComponent(id)}`, { cache: 'no-store' });
    if (res.status === HTTP_OK) return { kind: 'exists' };
    if (res.status === HTTP_NOT_FOUND) return { kind: 'not_found' };
    return { kind: 'unreachable' };
  } catch {
    return { kind: 'unreachable' };
  }
}
