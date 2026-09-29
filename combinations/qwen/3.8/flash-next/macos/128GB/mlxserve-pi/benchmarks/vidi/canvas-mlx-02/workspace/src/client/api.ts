// The two things the client can ask the server about boards, written so that
// every way an answer can fail has a name. A visitor who is told to wait, a
// visitor the server refused, and a visitor whose request never got an answer are
// three different experiences and must not be collapsed into one (PRD
// share.rate_limit, PRD share.create).
import { BOARD_ID_PATTERN } from '../shared/board-id.ts';

/** What `POST /api/boards` was able to say. */
export type CreateBoardResult =
  | { kind: 'created'; boardId: string }
  | { kind: 'rate_limited' }
  | { kind: 'failed' }
  /** the request never got a usable answer: no fetch, no JSON, a broken body */
  | { kind: 'unreachable' };

/** What `GET /api/boards/:id` was able to say. */
export type BoardCheckResult =
  | { kind: 'exists' }
  | { kind: 'missing' }
  | { kind: 'unknown' };

const BOARDS_ENDPOINT = '/api/boards';

/**
 * Ask for a board. A 201 whose body is not a code is treated as the failure it
 * is: a link the client cannot trust is not a board it can hand to a visitor, so
 * the response body is parsed, not assumed (design: `await res.json()` before
 * anything is shown).
 */
export async function createBoardRequest(): Promise<CreateBoardResult> {
  let res: Response;
  try {
    res = await fetch(BOARDS_ENDPOINT, { method: 'POST' });
  } catch {
    return { kind: 'unreachable' };
  }
  if (res.status === 429) return { kind: 'rate_limited' };
  if (res.status !== 201) return { kind: 'failed' };

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { kind: 'unreachable' };
  }
  const id = (body as { id?: unknown } | null)?.id;
  if (typeof id !== 'string' || !BOARD_ID_PATTERN.test(id)) return { kind: 'unreachable' };
  return { kind: 'created', boardId: id };
}

/**
 * Ask whether a code is anybody's board. Anything that is not a clear yes or a
 * clear no is `unknown`, which is what keeps a server that is having a bad minute
 * from telling a visitor their board is gone.
 */
export async function checkBoardRequest(boardId: string): Promise<BoardCheckResult> {
  if (!BOARD_ID_PATTERN.test(boardId)) return { kind: 'missing' };
  let res: Response;
  try {
    res = await fetch(`${BOARDS_ENDPOINT}/${boardId}`);
  } catch {
    return { kind: 'unknown' };
  }
  if (res.status === 200) return { kind: 'exists' };
  if (res.status === 404) return { kind: 'missing' };
  return { kind: 'unknown' };
}
