/**
 * Board API shared types (`share.board_api`).
 *
 * The paths are shared because both sides say them: the Worker serves them, the
 * client asks for them. A rename has to change this file, not two.
 */

export const BOARDS_ENDPOINT = "/api/boards";

/** `POST /api/boards` → 201 `{"id": "…"}`. */
export interface CreatedBoardBody {
  id: string;
}

/** `GET /api/boards/:id` → 200 `{"id": "…"}`. */
export interface CheckedBoardBody {
  id: string;
}

/** Every board API failure carries an `error` code. */
export interface ApiErrorBody {
  error: string;
}

/**
 * Outcome of asking the server whether a board exists — the three answers the
 * board page can act on (`share.not_found`, `share.unreachable`).
 */
export type BoardCheckOutcome = "exists" | "not_found" | "unreachable";
