/**
 * Client side of the board API (`share.board_api`, `share.create`, `share.not_found`).
 *
 * Two calls, and each one answers the question the UI needs in its own terms:
 *
 *   - `createBoard()` returns an id **or a reason it failed**, never a thrown
 *     error. A person who clicks "New board" while the network is down must be
 *     told, not left staring at a button.
 *   - `checkBoard()` returns `exists` / `not_found` / `unreachable`. The third
 *     one is the important distinction: "this link is not a board" and "I could
 *     not ask" are different situations and get different screens
 *     (`share.not_found` vs `share.unreachable`).
 *
 * `checkBoard` does not ask the server about a malformed link at all: an
 * address that is not a board id cannot be a board, and answering it without a
 * round trip is both faster and honest.
 */

import { isValidBoardId } from "../shared/board-id";
import { BOARDS_ENDPOINT, type BoardCheckOutcome, type CreatedBoardBody } from "../shared/api";
import { boardPath } from "./routing";

export type CreateBoardOutcome =
  | { ok: true; id: string }
  | { ok: false; reason: "network" | "create_failed" };

/** The shape every "New board" button uses, so pages can inject a fake one. */
export type CreateBoardFn = () => Promise<CreateBoardOutcome>;

interface FetchOptions {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

/** `POST /api/boards`. */
export async function createBoard({ fetchImpl = fetch }: FetchOptions = {}): Promise<CreateBoardOutcome> {
  let response: Response;
  try {
    response = await fetchImpl(BOARDS_ENDPOINT, { method: "POST" });
  } catch {
    return { ok: false, reason: "network" };
  }

  if (!response.ok) return { ok: false, reason: "create_failed" };

  const body = (await response.json().catch(() => null)) as CreatedBoardBody | null;
  const id = body?.id;
  if (typeof id !== "string" || !isValidBoardId(id)) return { ok: false, reason: "create_failed" };
  return { ok: true, id };
}

/** `GET /api/boards/:id`. */
export async function checkBoard(
  boardId: string,
  { fetchImpl = fetch, signal }: FetchOptions = {},
): Promise<BoardCheckOutcome> {
  if (!isValidBoardId(boardId)) return "not_found";

  let response: Response;
  try {
    response = await fetchImpl(`${BOARDS_ENDPOINT}/${boardId}`, { signal });
  } catch {
    // Refused, timed out, or the answer was not a response at all: we do not
    // know, and we do not say "not found".
    return "unreachable";
  }

  if (response.status === 200) return "exists";
  if (response.status === 404) return "not_found";
  return "unreachable";
}

/** The shareable link for a board, absolute, as it appears in the address bar. */
export function boardLink(boardId: string, origin?: string): string {
  const base = origin ?? (typeof window === "undefined" ? "" : window.location.origin);
  return `${base}${boardPath(boardId)}`;
}

export type { BoardCheckOutcome };
