/**
 * The two questions worth asking the server before drawing anything (`share.*`).
 *
 * Both are `fetch` calls to our own Worker, and both answer in ways that matter to the
 * page: "yes", "no", and "the server did not say". Collapsing the third into the second is
 * the mistake this module exists to prevent — it would tell a person in a tunnel that their
 * board had been deleted (`share.open_link` versus `share.unreachable`).
 *
 * The shapes are unions on `kind` rather than thrown errors because a failed request is
 * not exceptional here: it is the normal case a page has to render.
 */

import { BOARD_ID_PATTERN, isValidBoardId } from '../shared/board-id';

/** What `POST /api/boards` came back as. Network failure is a failure, not a third thing:
 * from the Home page both mean "stay here, say so, let them click again". */
export type CreateResponse = { kind: 'created'; id: string } | { kind: 'failed' };

/** What `GET /api/boards/<id>` came back as. */
export type CheckResponse = { kind: 'exists' } | { kind: 'not_found' } | { kind: 'unreachable' };

/**
 * Make a board and take its address (`share.create`).
 *
 * A response that is not shaped like a board address counts as a failure: putting nonsense
 * into the location bar would be worse than not navigating at all.
 */
export async function createBoardRequest(): Promise<CreateResponse> {
  let response: Response;
  try {
    response = await fetch('/api/boards', { method: 'POST' });
  } catch {
    return { kind: 'failed' };
  }
  if (!response.ok) return { kind: 'failed' };
  const body = (await response.json().catch(() => null)) as { id?: unknown } | null;
  // Not a string of the right shape, not a board: the alternative is putting whatever the
  // server said into the address bar and calling it a board page.
  const id = body?.id;
  return typeof id === 'string' && isValidBoardId(id) ? { kind: 'created', id } : { kind: 'failed' };
}

/**
 * Does this address belong to a board?
 *
 * A malformed id is answered here rather than asked about: the server would say the same
 * thing and a mistyped link does not need a round trip to be told (`share.not_found`). A
 * 5xx or a failed `fetch` is `unreachable`, which is the answer that keeps the page retrying
 * instead of giving up.
 */
export async function checkBoard(id: string): Promise<CheckResponse> {
  if (!BOARD_ID_PATTERN.test(id)) return { kind: 'not_found' };
  let response: Response;
  try {
    response = await fetch(`/api/boards/${encodeURIComponent(id)}`);
  } catch {
    return { kind: 'unreachable' };
  }
  if (response.status === 404) return { kind: 'not_found' };
  // Anything else non-2xx is the server failing to answer rather than answering "no".
  if (!response.ok) return { kind: 'unreachable' };
  return { kind: 'exists' };
}
