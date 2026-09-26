import { isValidBoardId } from '@/shared/board-id';

/**
 * The client's board API (story 5, share.board_api). Deliberately thin: one
 * existence check and one creation, both plain fetch.
 */

export type CheckResult = { kind: 'exists' } | { kind: 'not_found' } | { kind: 'unreachable' };

/**
 * `GET /api/boards/:id`. Invalid ids never hit the network (the client can
 * decide locally); a network error is `unreachable` (the board may exist —
 * the caller retries) while 404 is a definitive `not_found`.
 */
export async function checkBoard(id: string): Promise<CheckResult> {
  if (!isValidBoardId(id)) return { kind: 'not_found' };
  let res: Response;
  try {
    res = await fetch(`/api/boards/${id}`);
  } catch {
    return { kind: 'unreachable' };
  }
  if (res.status === 200) return { kind: 'exists' };
  if (res.status === 404) return { kind: 'not_found' };
  return { kind: 'unreachable' };
}

export type CreateResponse =
  | { kind: 'created'; id: string }
  | { kind: 'failed' }
  | { kind: 'rate_limited' };

/**
 * `POST /api/boards`. 201 → the new board id; 429 → rate limited; anything
 * else (or a network error) → failed (the caller shows one message for
 * both, share.create: "Couldn't create a board. Please try again.").
 */
export async function createBoardRequest(): Promise<CreateResponse> {
  let res: Response;
  try {
    res = await fetch('/api/boards', { method: 'POST' });
  } catch {
    return { kind: 'failed' };
  }
  if (res.status === 201) {
    const body = (await res.json().catch(() => null)) as { id?: string } | null;
    if (body && typeof body.id === 'string') return { kind: 'created', id: body.id };
    return { kind: 'failed' };
  }
  if (res.status === 429) return { kind: 'rate_limited' };
  return { kind: 'failed' };
}
