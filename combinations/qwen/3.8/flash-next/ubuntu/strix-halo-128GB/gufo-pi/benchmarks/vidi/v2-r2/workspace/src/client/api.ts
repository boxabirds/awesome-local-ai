// Typed fetch wrappers for the board API (story 5).

export type CreateResponse =
  | { kind: 'created'; id: string }
  | { kind: 'failed' };

export type CheckResponse =
  | { kind: 'exists' }
  | { kind: 'not_found' }
  | { kind: 'unreachable' };

/**
 * POST /api/boards. Any non-201 response or a network error maps to `failed`
 * (share.create_failure): the caller keeps the person on the home page.
 */
export async function createBoardRequest(): Promise<CreateResponse> {
  try {
    const res = await fetch('/api/boards', { method: 'POST' });
    if (res.status === 201) {
      const data = (await res.json().catch(() => null)) as { id?: unknown } | null;
      if (data && typeof data.id === 'string' && data.id.length > 0) {
        return { kind: 'created', id: data.id };
      }
      return { kind: 'failed' };
    }
    return { kind: 'failed' };
  } catch {
    return { kind: 'failed' };
  }
}

/**
 * GET /api/boards/:id. 200 -> exists, 404 -> not_found, and network errors or
 * any 5xx -> unreachable so the caller can retry (share.unreachable).
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
