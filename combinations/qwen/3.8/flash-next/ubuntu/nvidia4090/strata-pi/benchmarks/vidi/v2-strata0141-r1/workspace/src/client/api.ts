import { BOARD_API_PREFIX } from '../shared/config';
import { isValidBoardId } from '../shared/board-id';

/**
 * The client's half of the board API (`share.create`, `share.not_found`).
 *
 * Both calls answer with one of three kinds, because from the browser's seat a
 * failure has two shapes: the server answered "no" (which is a fact about the
 * board) and the server never answered (which is a fact about the network, and
 * gets retried).
 */

export type CreateResult =
  /** 201: the server made a board and named it. */
  | { kind: 'created'; id: string }
  /** Anything else: 405/500, or no answer at all. */
  | { kind: 'failed' };

export type CheckResult =
  /** 200: this board exists. */
  | { kind: 'exists' }
  /** 404: the server knows this address and there is nothing behind it. */
  | { kind: 'not_found' }
  /** 5xx, or a fetch that never completed: unknown, so it is worth asking again. */
  | { kind: 'unreachable' };

/** Ask the server for a new board. */
export async function createBoardRequest(): Promise<CreateResult> {
  try {
    const response = await fetch(BOARD_API_PREFIX, { method: 'POST' });
    if (!response.ok) {
      return { kind: 'failed' };
    }
    const body = (await response.json()) as { id?: unknown };
    if (typeof body.id !== 'string' || !isValidBoardId(body.id)) {
      // An answer that does not name a usable board is not a created board.
      return { kind: 'failed' };
    }
    return { kind: 'created', id: body.id };
  } catch {
    return { kind: 'failed' };
  }
}

/** Ask the server whether this board exists. Read-only, so it is safe to retry. */
export async function checkBoard(boardId: string): Promise<CheckResult> {
  try {
    const response = await fetch(`${BOARD_API_PREFIX}/${boardId}`);
    if (response.status === 200) {
      return { kind: 'exists' };
    }
    if (response.status === 404) {
      return { kind: 'not_found' };
    }
    if (response.status >= 500) {
      return { kind: 'unreachable' };
    }
    // Some other answer to a well-formed id: treat it as nothing behind the link.
    return { kind: 'not_found' };
  } catch {
    return { kind: 'unreachable' };
  }
}
