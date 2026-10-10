// Typed fetch wrappers for the board API (story 5). Network errors and 5xx
// are collapsed into a kind so callers handle outcomes, not exceptions:
// createBoardRequest -> 'failed' on any problem; checkBoard -> 'unreachable'
// on a network error or a 5xx, 'not_found' only on a definite 404.
export type CreateResponse = { kind: 'created'; id: string } | { kind: 'failed' };
export type CheckResponse =
  | { kind: 'exists' }
  | { kind: 'not_found' }
  | { kind: 'unreachable' };

export async function createBoardRequest(): Promise<CreateResponse> {
  try {
    const response = await fetch('/api/boards', { method: 'POST' });
    if (response.status === 201) {
      const body = (await response.json()) as { id?: unknown };
      if (typeof body.id === 'string') return { kind: 'created', id: body.id };
    }
    return { kind: 'failed' };
  } catch {
    return { kind: 'failed' };
  }
}

export async function checkBoard(id: string): Promise<CheckResponse> {
  try {
    const response = await fetch(`/api/boards/${encodeURIComponent(id)}`);
    if (response.status === 200) return { kind: 'exists' };
    if (response.status === 404) return { kind: 'not_found' };
    return { kind: 'unreachable' };
  } catch {
    return { kind: 'unreachable' };
  }
}
