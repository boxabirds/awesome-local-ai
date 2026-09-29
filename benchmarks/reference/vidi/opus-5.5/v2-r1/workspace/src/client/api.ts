// Typed wrappers for the board API (src/worker/index.ts).
import { isValidBoardId } from '../shared/board-id';

export type CreateResponse = { kind: 'created'; id: string } | { kind: 'failed' };
export type CheckResponse = { kind: 'exists' } | { kind: 'not_found' } | { kind: 'unreachable' };

/** POST /api/boards. A 5xx, an unexpected answer or a network error is `failed`. */
export async function createBoardRequest(): Promise<CreateResponse> {
  try {
    const res = await fetch('/api/boards', { method: 'POST' });
    if (res.status !== 201) return { kind: 'failed' };
    const body = (await res.json()) as { id?: unknown };
    if (typeof body.id !== 'string' || !isValidBoardId(body.id)) return { kind: 'failed' };
    return { kind: 'created', id: body.id };
  } catch {
    return { kind: 'failed' };
  }
}

/** GET /api/boards/:id. 404 is `not_found`; a network error or any other answer is `unreachable`. */
export async function checkBoard(id: string): Promise<CheckResponse> {
  try {
    const res = await fetch(`/api/boards/${encodeURIComponent(id)}`, { cache: 'no-store' });
    if (res.status === 200) return { kind: 'exists' };
    if (res.status === 404) return { kind: 'not_found' };
    return { kind: 'unreachable' };
  } catch {
    return { kind: 'unreachable' };
  }
}
