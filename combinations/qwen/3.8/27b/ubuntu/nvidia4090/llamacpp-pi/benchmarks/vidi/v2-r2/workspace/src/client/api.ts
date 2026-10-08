/**
 * Board API client (story 5, share.board_api / share.create /
 * share.not_found / share.unreachable).
 *
 * Two endpoints:
 * - POST /api/boards — create a board. Maps every failure (HTTP 500,
 *   network error, malformed response) to `failed`; the page shows its
 *   error state and the user can retry. The budget for click → opened
 *   board is CREATE_BUDGET_MS (PRD), tracked by callers.
 * - GET /api/boards/:id — existence check. Only a definitive 404 means
 *   not_found; 401/403 are treated as a privacy signal and also map to
 *   not_found (never an error state). Every other status (5xx) and every
 *   network failure means unreachable — the caller retries with backoff.
 *
 * The existence check is the ONLY network call made by a fresh browser on
 * an old link (before any socket is opened).
 */

export type CreateResponse =
  | { kind: 'created'; id: string }
  | { kind: 'failed'; message: string };

export type CheckResponse =
  | { kind: 'exists' }
  | { kind: 'not_found' }
  | { kind: 'unreachable' };

const CREATE_FAILURE_MESSAGE = "Couldn't create a board. Please try again.";

export async function createBoardRequest(): Promise<CreateResponse> {
  try {
    const res = await fetch('/api/boards', { method: 'POST' });
    if (!res.ok) {
      return { kind: 'failed', message: CREATE_FAILURE_MESSAGE };
    }
    const body = (await res.json()) as { id?: unknown };
    if (typeof body.id !== 'string' || body.id.length === 0) {
      return { kind: 'failed', message: CREATE_FAILURE_MESSAGE };
    }
    return { kind: 'created', id: body.id };
  } catch {
    // Network failure (offline, DNS, proxy…) — same recovery as 500.
    return { kind: 'failed', message: CREATE_FAILURE_MESSAGE };
  }
}

export async function checkBoard(id: string): Promise<CheckResponse> {
  try {
    const res = await fetch(`/api/boards/${encodeURIComponent(id)}`, { method: 'GET' });
    if (res.status === 404 || res.status === 401 || res.status === 403) {
      return { kind: 'not_found' };
    }
    if (res.ok) {
      return { kind: 'exists' };
    }
    // 5xx etc.: the service (or a proxy) failed — unreachable, retry.
    return { kind: 'unreachable' };
  } catch {
    return { kind: 'unreachable' };
  }
}
