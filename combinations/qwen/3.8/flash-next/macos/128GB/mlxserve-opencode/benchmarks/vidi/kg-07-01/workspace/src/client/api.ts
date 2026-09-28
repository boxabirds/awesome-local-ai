// Typed wrappers for the board API (src/worker/index.ts). They never throw: every outcome is a value.

export type CreateResponse = { kind: 'created'; id: string } | { kind: 'rate_limited' } | { kind: 'failed' };
export type CheckResponse = { kind: 'exists' } | { kind: 'not_found' } | { kind: 'unreachable' };

/** POST /api/boards. Network errors and unexpected answers are `failed`. */
export async function createBoardRequest(): Promise<CreateResponse> {
  try {
    const res = await fetch('/api/boards', { method: 'POST' });
    if (res.status === 201) {
      const body = (await res.json()) as { id?: unknown };
      if (typeof body.id === 'string') return { kind: 'created', id: body.id };
      return { kind: 'failed' };
    }
    if (res.status === 429) return { kind: 'rate_limited' };
    return { kind: 'failed' };
  } catch {
    return { kind: 'failed' };
  }
}

/** GET /api/boards/:id. Network errors and 5xx (anything but 200/404) are `unreachable`. */
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
