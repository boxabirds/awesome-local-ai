export type CreateResponse =
  | { kind: 'created'; id: string }
  | { kind: 'rate_limited' }
  | { kind: 'failed' };

export type CheckResponse =
  | { kind: 'exists' }
  | { kind: 'not_found' }
  | { kind: 'unreachable' };

/**
 * POST /api/boards to create a new board.
 * Network errors → failed.
 */
export async function createBoardRequest(): Promise<CreateResponse> {
  try {
    const res = await fetch('/api/boards', { method: 'POST' });
    if (res.ok && res.status === 201) {
      const body = await res.json();
      return { kind: 'created', id: (body as { id: string }).id };
    }
    if (res.status === 429) {
      return { kind: 'rate_limited' };
    }
    return { kind: 'failed' };
  } catch {
    return { kind: 'failed' };
  }
}

/**
 * GET /api/boards/:id to check board existence.
 * Network errors and 5xx → unreachable.
 */
export async function checkBoard(id: string): Promise<CheckResponse> {
  try {
    const res = await fetch(`/api/boards/${encodeURIComponent(id)}`);
    if (res.status === 200) return { kind: 'exists' };
    if (res.status === 404) return { kind: 'not_found' };
    // 5xx or other error
    return { kind: 'unreachable' };
  } catch {
    return { kind: 'unreachable' };
  }
}
