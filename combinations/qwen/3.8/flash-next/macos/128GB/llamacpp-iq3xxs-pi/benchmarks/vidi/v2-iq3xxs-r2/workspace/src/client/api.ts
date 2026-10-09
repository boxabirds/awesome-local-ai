/**
 * The board API from the client's side (story 5): two calls, and both answer in terms
 * the pages care about rather than in status codes — a person choosing between "this
 * board is not here" and "I could not ask whether it is" is not choosing between a 404
 * and a 503.
 */
import { isValidBoardId } from '../shared/board-id';

/** The only two endpoints the client uses. */
export const BOARDS_API = '/api/boards';

export type CreateBoardResult = { ok: true; id: string } | { ok: false };

/**
 * Ask for a new board. Anything that is not a 201 carrying a well-formed id — a 500, a
 * network error, a body that makes no sense — is the same thing to the person pressing
 * the button, and the home page stays where it is with the button available again
 * (`share.create_failure`).
 */
export async function createBoardRequest(): Promise<CreateBoardResult> {
  try {
    const response = await fetch(BOARDS_API, { method: 'POST' });
    if (response.status !== 201) return { ok: false };
    const body = (await response.json().catch(() => null)) as { id?: unknown } | null;
    const id = body?.id;
    if (typeof id !== 'string' || !isValidBoardId(id)) return { ok: false };
    return { ok: true, id };
  } catch {
    return { ok: false };
  }
}

/**
 * What came back from asking whether a board exists. `unreachable` covers a network
 * error and every status that is not a decided answer: only a 404 says this board is
 * not there, and only a 200 says it is.
 */
export type BoardCheckResult = 'exists' | 'not_found' | 'unreachable';

export async function checkBoard(boardId: string, signal?: AbortSignal): Promise<BoardCheckResult> {
  try {
    const response = await fetch(`${BOARDS_API}/${boardId}`, { signal });
    if (response.status === 200) return 'exists';
    if (response.status === 404) return 'not_found';
    return 'unreachable';
  } catch {
    // An abort on unmount lands here too; the page that asked has gone by then.
    return 'unreachable';
  }
}
