// The client side of the board API (design "Board creation and existence API").
// Two calls, both tolerant: every failure mode is a value the caller can act on,
// never an exception that escapes into a React render.

import { isValidBoardId } from '../shared/board-id.ts';

export type CreateBoardResult =
  | { ok: true; boardId: string }
  /** The server refused with this status (429 rate limit, 4xx/5xx). */
  | { ok: false; status: number }
  /** The request never got an answer (offline, DNS, abort). */
  | { ok: false; status: 0 };

/**
 * Where one of a board's pictures is uploaded. Board-scoped, because the board is what owns
 * the bytes — the client names the board and never a path to write to.
 */
export function uploadUrl(boardId: string): string {
  return `/api/boards/${encodeURIComponent(boardId)}/assets`;
}

export async function requestNewBoard(): Promise<CreateBoardResult> {
  let response: Response;
  try {
    response = await fetch('/api/boards', { method: 'POST' });
  } catch {
    return { ok: false, status: 0 };
  }
  if (!response.ok) return { ok: false, status: response.status };
  try {
    const body = (await response.json()) as { id?: unknown };
    if (typeof body.id === 'string' && isValidBoardId(body.id)) {
      return { ok: true, boardId: body.id };
    }
  } catch {
    // fall through
  }
  // A 201 without a usable id is a broken answer, not a created board: the
  // client must not navigate anywhere with it.
  return { ok: false, status: response.status };
}

export type BoardCheck =
  /** The board exists: open it. */
  | 'exists'
  /** The board does not exist: this link is not a board. */
  | 'not-found'
  /** No answer (offline, 5xx, timeout): unknown, retry later. */
  | 'unknown';

export async function checkBoard(boardId: string): Promise<BoardCheck> {
  try {
    const response = await fetch(`/api/boards/${encodeURIComponent(boardId)}`);
    if (response.status === 200) return 'exists';
    if (response.status === 404) return 'not-found';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}
