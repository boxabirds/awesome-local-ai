// Board API client (spec: share.board_api HTTP table).
//
// createBoardRequest(): 201 → created(id); 429 → rate_limited; anything else
// (5xx, non-201, network) → failed. checkBoard(id): 200 → exists; 404 →
// not_found; network/5xx → unreachable. Malformed ids are not_found without
// any request (the server would 404 them too — the client saves the round
// trip and the negative is asserted in TC-19).

import { isValidBoardId } from '../shared/board-id';

export type CreateResult =
  | { status: 'created'; id: string }
  | { status: 'rate_limited' }
  | { status: 'failed' };

export type CheckResult =
  | { status: 'exists' }
  | { status: 'not_found' }
  | { status: 'unreachable' };

export async function createBoardRequest(): Promise<CreateResult> {
  let res: Response;
  try {
    res = await fetch('/api/boards', { method: 'POST' });
  } catch {
    return { status: 'failed' };
  }
  if (res.status === 201) {
    const body = (await res.json()) as { id?: unknown };
    if (typeof body.id === 'string' && isValidBoardId(body.id)) {
      return { status: 'created', id: body.id };
    }
    return { status: 'failed' };
  }
  if (res.status === 429) return { status: 'rate_limited' };
  return { status: 'failed' };
}

export async function checkBoard(id: string): Promise<CheckResult> {
  if (!isValidBoardId(id)) return { status: 'not_found' };
  let res: Response;
  try {
    res = await fetch(`/api/boards/${encodeURIComponent(id)}`);
  } catch {
    return { status: 'unreachable' };
  }
  if (res.status === 200) return { status: 'exists' };
  if (res.status === 404) return { status: 'not_found' };
  return { status: 'unreachable' };
}
