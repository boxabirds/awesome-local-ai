import { CREATE_BUDGET_MS } from '../shared/config';

export type CreateResponse =
  | { kind: 'created'; id: string }
  | { kind: 'failed' };

export type CheckResponse =
  | { kind: 'exists' }
  | { kind: 'not_found' }
  | { kind: 'unreachable' };

const API_BASE = ''; // Relative — uses current host

/**
 * POST /api/boards — create a new board.
 * Network errors or 5xx → 'failed'.
 */
export async function createBoardRequest(): Promise<CreateResponse> {
  try {
    const resp = await fetch(`${API_BASE}/api/boards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!resp.ok) {
      return { kind: 'failed' };
    }
    const data = await resp.json() as { id: string };
    return { kind: 'created', id: data.id };
  } catch {
    return { kind: 'failed' };
  }
}

/**
 * GET /api/boards/:id — existence check with retry when unreachable.
 * 200 → 'exists', 404 → 'not_found', network error or 5xx → 'unreachable'.
 */
export async function checkBoard(id: string): Promise<CheckResponse> {
  try {
    const resp = await fetch(`${API_BASE}/api/boards/${encodeURIComponent(id)}`, {
      headers: { 'Accept': 'application/json' },
    });
    if (resp.status === 404) {
      return { kind: 'not_found' };
    }
    if (!resp.ok) {
      return { kind: 'unreachable' };
    }
    return { kind: 'exists' };
  } catch {
    return { kind: 'unreachable' };
  }
}
