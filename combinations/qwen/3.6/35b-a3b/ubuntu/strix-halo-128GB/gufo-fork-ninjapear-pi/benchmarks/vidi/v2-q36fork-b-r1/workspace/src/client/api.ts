/**
 * API client — typed fetch wrappers for board API.
 * Story 5 — share a board with others using a link.
 */

export type CreateResponse =
  | { kind: 'created'; id: string }
  | { kind: 'failed' };

export type CheckResponse =
  | { kind: 'exists' }
  | { kind: 'not_found' }
  | { kind: 'unreachable' };

const BASE = ''; // relative to current origin

/**
 * POST /api/boards → creates a new board.
 * Network errors or 5xx → 'failed'.
 */
export async function createBoardRequest(): Promise<CreateResponse> {
  try {
    const resp = await fetch(`${BASE}/api/boards`, { method: 'POST' });
    if (resp.ok) {
      const body: { id: string } = await resp.json() as { id: string };
      return { kind: 'created', id: body.id };
    }
    return { kind: 'failed' };
  } catch {
    return { kind: 'failed' };
  }
}

/**
 * GET /api/boards/:id → checks if board exists.
 * 200 → 'exists'; 404 → 'not_found'; network/5xx → 'unreachable'.
 */
export async function checkBoard(id: string): Promise<CheckResponse> {
  try {
    const resp = await fetch(`${BASE}/api/boards/${id}`);
    if (resp.ok) {
      return { kind: 'exists' };
    }
    if (resp.status === 404) {
      return { kind: 'not_found' };
    }
    return { kind: 'unreachable' };
  } catch {
    return { kind: 'unreachable' };
  }
}
