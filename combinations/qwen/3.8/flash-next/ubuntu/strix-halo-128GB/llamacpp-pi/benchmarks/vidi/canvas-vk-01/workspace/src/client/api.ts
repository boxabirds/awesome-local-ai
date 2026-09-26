/**
 * Typed fetch wrappers for the board API.
 */

export type CreateResponse =
  | { kind: 'created'; id: string }
  | { kind: 'rate_limited' }
  | { kind: 'failed' };

export type CheckResponse =
  | { kind: 'exists' }
  | { kind: 'not_found' }
  | { kind: 'unreachable' };

/** Create a new board. Network errors → 'failed'. */
export async function createBoardRequest(): Promise<CreateResponse> {
  try {
    const response = await fetch('/api/boards', { method: 'POST' });
    if (response.status === 201) {
      const body = (await response.json()) as { id: string };
      return { kind: 'created', id: body.id };
    }
    if (response.status === 429) {
      return { kind: 'rate_limited' };
    }
    return { kind: 'failed' };
  } catch {
    return { kind: 'failed' };
  }
}

/** Check whether a board exists. Network errors and 5xx → 'unreachable'. */
export async function checkBoard(id: string): Promise<CheckResponse> {
  try {
    const response = await fetch(`/api/boards/${encodeURIComponent(id)}`);
    if (response.status === 200) return { kind: 'exists' };
    if (response.status === 404) return { kind: 'not_found' };
    // 5xx or unexpected
    if (response.status >= 500) return { kind: 'unreachable' };
    return { kind: 'not_found' };
  } catch {
    return { kind: 'unreachable' };
  }
}
