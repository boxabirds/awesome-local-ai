// Story 5: board API client (share.pages / share.board_api).

export type CreateBoardResult =
  | { kind: 'created'; id: string }
  | { kind: 'rate_limited' }
  | { kind: 'failed' };

/**
 * POST /api/boards. `created` on 201, `rate_limited` on 429, `failed` on
 * any other status (5xx) or a network error.
 */
export async function createBoardRequest(): Promise<CreateBoardResult> {
  try {
    const res = await fetch('/api/boards', { method: 'POST' });
    if (res.status === 201) {
      const body = (await res.json()) as { id: string };
      return { kind: 'created', id: body.id };
    }
    if (res.status === 429) {
      return { kind: 'rate_limited' };
    }
    return { kind: 'failed' };
  } catch {
    return { kind: 'failed' };
  }
}

export type BoardCheckResult =
  | { kind: 'exists' }
  | { kind: 'not_found' }
  | { kind: 'unreachable' };

/**
 * GET /api/boards/<id>. `exists` on 200, `not_found` on 404, `unreachable`
 * on any other status (5xx) or a network error.
 */
export async function checkBoard(id: string): Promise<BoardCheckResult> {
  try {
    const res = await fetch(`/api/boards/${encodeURIComponent(id)}`);
    if (res.status === 200) {
      return { kind: 'exists' };
    }
    if (res.status === 404) {
      return { kind: 'not_found' };
    }
    return { kind: 'unreachable' };
  } catch {
    return { kind: 'unreachable' };
  }
}
