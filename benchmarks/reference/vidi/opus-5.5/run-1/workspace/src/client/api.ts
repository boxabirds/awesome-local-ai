/**
 * Typed wrappers for the board API (story 5). Never throw: every outcome is a value the pages
 * turn into a state.
 */
export type CreateResponse = { kind: 'created'; id: string } | { kind: 'rate_limited' } | { kind: 'failed' };
export type CheckResponse = { kind: 'exists' } | { kind: 'not_found' } | { kind: 'unreachable' };

const HTTP_CREATED = 201;
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const HTTP_TOO_MANY_REQUESTS = 429;

/** POST /api/boards. Network errors, 5xx and unexpected answers → failed. */
export async function createBoardRequest(): Promise<CreateResponse> {
  try {
    const res = await fetch('/api/boards', { method: 'POST' });
    if (res.status === HTTP_TOO_MANY_REQUESTS) return { kind: 'rate_limited' };
    if (res.status !== HTTP_CREATED) return { kind: 'failed' };
    const body = (await res.json()) as { id?: unknown };
    return typeof body.id === 'string' ? { kind: 'created', id: body.id } : { kind: 'failed' };
  } catch {
    return { kind: 'failed' };
  }
}

/** GET /api/boards/:id. Network errors and 5xx (anything but 200/404) → unreachable. */
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
