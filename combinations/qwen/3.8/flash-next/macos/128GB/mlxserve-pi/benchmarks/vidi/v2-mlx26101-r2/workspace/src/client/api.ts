/**
 * The client's side of the board API (design "Home, board and not-found pages").
 *
 * Two questions, in the shapes the pages can act on: *make me a board* and *is this
 * board there*. The whole point of these types is that a network failure is a value
 * and not an exception: the pages have an answer for every one of the three ways a
 * link check can come back, and the one thing that must not happen is a check that
 * throws past the person looking at the screen.
 *
 * So: no throwing, no retrying here. A retry is a decision about what to show and when
 * to show it, which belongs to the page (`pages/state.ts`); this file's job ends at
 * saying what the service said, or that it could not be asked.
 */

import { isValidBoardId } from '../shared/board-id.js';

/** `POST /api/boards`. Either a board, or the truth. */
export type CreateResponse = { kind: 'created'; id: string } | { kind: 'failed' };

/**
 * `GET /api/boards/:id`. `unreachable` is not "the board does not exist": it is "the
 * service did not answer", and the page keeps the person's link alive on the strength
 * of the difference (PRD `share.unreachable`).
 */
export type CheckResponse = { kind: 'exists' } | { kind: 'not_found' } | { kind: 'unreachable' };

/** The two calls, as an object a page can be given. */
export interface BoardsApi {
  create(): Promise<CreateResponse>;
  check(boardId: string): Promise<CheckResponse>;
}

/** Where the board API lives, relative to the page. */
export const BOARDS_ENDPOINT = '/api/boards';

/** The path of one board's entry. */
export const boardEndpoint = (boardId: string): string => `${BOARDS_ENDPOINT}/${boardId}`;

/**
 * Ask for a board. A 201 carrying something that is a board id is a board; every
 * other answer — a 500, a 201 with rubbish in it, a fetch that never resolved because
 * the network refused it — is `failed`, which the home page renders as "Couldn't
 * create a board. Please try again."
 *
 * A body that is not a board id counts as a failure rather than as a link, because a
 * page that navigated to it would show a board that is not there and hand out a link
 * that does not work.
 */
export async function createBoardRequest(): Promise<CreateResponse> {
  let response: Response;
  try {
    response = await fetch(BOARDS_ENDPOINT, { method: 'POST' });
  } catch {
    return { kind: 'failed' };
  }
  if (!response.ok) return { kind: 'failed' };

  const id = await jsonStringField(response);
  if (id === null || !isValidBoardId(id)) return { kind: 'failed' };
  return { kind: 'created', id };
}

/**
 * Ask whether a board exists. 200 is `exists`, 404 is `not_found`, and everything
 * else — 500, 503, a proxy that answered HTML, a fetch that failed outright — is
 * `unreachable`, because the only honest reading of an answer that is not "no" is
 * "we did not get an answer".
 *
 * A malformed id is answered here rather than sent: it cannot name a board, the
 * server says the same (TC-07), and a request that is certain to fail should not be
 * made in the first place.
 */
export async function checkBoard(boardId: string): Promise<CheckResponse> {
  if (!isValidBoardId(boardId)) return { kind: 'not_found' };

  let response: Response;
  try {
    response = await fetch(boardEndpoint(boardId));
  } catch {
    return { kind: 'unreachable' };
  }
  if (response.status === 404) return { kind: 'not_found' };
  if (response.status === 200) return { kind: 'exists' };
  return { kind: 'unreachable' };
}

/** The real API, which is what a page uses unless it is handed another one. */
export const boardsApi: BoardsApi = {
  create: () => createBoardRequest(),
  check: (boardId: string) => checkBoard(boardId),
};

/** The `id` of a JSON body, or null when the body is not JSON or has no such field. */
async function jsonStringField(response: Response): Promise<string | null> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return null;
  }
  if (typeof body !== 'object' || body === null) return null;
  const id = (body as Record<string, unknown>)['id'];
  return typeof id === 'string' ? id : null;
}
