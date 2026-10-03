/**
 * Typed fetch wrappers for the board API (story 5, share.pages).
 *
 * Network errors are mapped to states, never thrown to the UI:
 * - createBoardRequest: 201 → created; anything else or a network error → failed
 * - checkBoard: 200 → exists; 404 → not_found; 5xx or a network error → unreachable
 */

export type CreateResponse = { kind: 'created'; id: string } | { kind: 'failed' };
export type CheckResponse =
  | { kind: 'exists' }
  | { kind: 'not_found' }
  | { kind: 'unreachable' };

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
