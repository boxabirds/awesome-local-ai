/**
 * Typed wrappers for the board API (anchor: share.pages). Never throw: network errors
 * become `failed` (create) or `unreachable` (check), so pages only handle states.
 */

export type CreateResponse = { kind: 'created'; id: string } | { kind: 'rate_limited' } | { kind: 'failed' };
export type CheckResponse = { kind: 'exists' } | { kind: 'not_found' } | { kind: 'unreachable' };

const CREATED = 201;
const OK = 200;
const NOT_FOUND = 404;
const TOO_MANY_REQUESTS = 429;

export async function createBoardRequest(): Promise<CreateResponse> {
  try {
    const res = await fetch('/api/boards', { method: 'POST' });
    if (res.status === TOO_MANY_REQUESTS) return { kind: 'rate_limited' };
    if (res.status !== CREATED) return { kind: 'failed' };
    const body = (await res.json()) as { id?: unknown };
    return typeof body.id === 'string' ? { kind: 'created', id: body.id } : { kind: 'failed' };
  } catch {
    return { kind: 'failed' };
  }
}

export async function checkBoard(id: string): Promise<CheckResponse> {
  try {
    const res = await fetch(`/api/boards/${encodeURIComponent(id)}`, { cache: 'no-store' });
    if (res.status === OK) return { kind: 'exists' };
    if (res.status === NOT_FOUND) return { kind: 'not_found' };
    return { kind: 'unreachable' };
  } catch {
    return { kind: 'unreachable' };
  }
}
