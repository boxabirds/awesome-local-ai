// The client's small HTTP layer for story 5: create a board, and ask whether a
// board exists. Both answers are reported as a *kind* rather than as thrown errors,
// because the pages have to branch on all three outcomes (created / not there / we
// could not ask) and never on an exception type.
//
// There is no retry here: the pages own the cadence (see pages/state.ts), so this
// module says what happened once and stays out of the way.

/** What POST /api/boards answered. */
export type CreateResponse =
  | { kind: 'created'; id: string }
  /** Anything else — 500 `create_failed`, a network failure, a broken body. */
  | { kind: 'failed' };

/** What GET /api/boards/:id answered. */
export type CheckResponse =
  | { kind: 'exists' }
  /** The board was never created (or the id is not a link at all). */
  | { kind: 'not_found' }
  /**
   * We could not get an answer: the network failed, the service is down, or it
   * replied 5xx. Deliberately not `not_found` — a board we could not ask about is
   * never reported as missing (share.not_found).
   */
  | { kind: 'unreachable' };

/** Ask the service for a new board. The only way a board comes into being. */
export async function createBoardRequest(): Promise<CreateResponse> {
  try {
    const response = await fetch('/api/boards', { method: 'POST' });
    if (!response.ok) return { kind: 'failed' };
    const body = (await response.json()) as { id?: unknown };
    return typeof body.id === 'string' && body.id.length > 0
      ? { kind: 'created', id: body.id }
      : { kind: 'failed' };
  } catch {
    return { kind: 'failed' };
  }
}

/**
 * Does this board exist? A 404 is the only answer that means "no"; everything else
 * that is not a 2xx is `unreachable`, including a 500, so a broken service never
 * looks like a missing board.
 */
export async function checkBoard(boardId: string): Promise<CheckResponse> {
  try {
    const response = await fetch(`/api/boards/${encodeURIComponent(boardId)}`);
    if (response.status === 404) return { kind: 'not_found' };
    if (!response.ok) return { kind: 'unreachable' };
    return { kind: 'exists' };
  } catch {
    return { kind: 'unreachable' };
  }
}
