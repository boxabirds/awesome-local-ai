export type CreateResponse =
  | { kind: 'created'; id: string }
  | { kind: 'failed' };

export type CheckResponse =
  | { kind: 'exists' }
  | { kind: 'not_found' }
  | { kind: 'unreachable' };

/** POST /api/boards to create a new board. Network errors → failed. */
export async function createBoardRequest(): Promise<CreateResponse> {
  try {
    const res = await fetch('/api/boards', { method: 'POST' });
    if (res.status === 201) {
      const data = await res.json() as { id: string };
      return { kind: 'created', id: data.id };
    }
    return { kind: 'failed' };
  } catch {
    return { kind: 'failed' };
  }
}

/** GET /api/boards/:id to check if a board exists. */
export async function checkBoard(id: string): Promise<CheckResponse> {
  try {
    const res = await fetch(`/api/boards/${id}`);
    if (res.status === 200) return { kind: 'exists' };
    if (res.status === 404) return { kind: 'not_found' };
    // 5xx → unreachable
    if (res.status >= 500) return { kind: 'unreachable' };
    // Any other status → unreachable (safe fallback)
    return { kind: 'unreachable' };
  } catch {
    // Network error → unreachable
    return { kind: 'unreachable' };
  }
}
