/**
 * Creating a board (`share.board_api`, `share.create`, `share.unguessable`).
 *
 * One id from `newBoardId()` — 128 cryptographic random bits — and one RPC
 * `initialize()` on that id's BoardRoom. That is the whole creation path, and it
 * is what makes creation fit CREATE_BUDGET_MS: an id generation, one RPC and one
 * small SQLite write.
 *
 * There is **no retry loop**. A collision between 128-bit random ids is not a
 * practical event; if `initialize()` ever answers `exists` for a fresh id, the
 * request fails with `create_failed` rather than minting another id and silently
 * pointing two people at a board they did not create.
 */

import { newBoardId } from "../shared/board-id";
import type { Env } from "./index";

export type CreateResult = { ok: true; id: string } | { ok: false; reason: "create_failed" };

/** Creates a brand-new empty board and returns its id. */
export async function createBoard(env: Env): Promise<CreateResult> {
  const id = newBoardId();

  try {
    const outcome = await env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id)).initialize();
    if (outcome !== "created") {
      logError("board-create-collided", { outcome });
      return { ok: false, reason: "create_failed" };
    }
    return { ok: true, id };
  } catch (error) {
    // The RPC threw, or storage refused the write: the person stays on the home
    // page and is told creation failed (share.create_failure), which is also what
    // a network failure looks like from the client.
    logError("board-create-failed", { error: errorMessage(error) });
    return { ok: false, reason: "create_failed" };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function logError(event: string, fields: Record<string, unknown>): void {
  console.error(JSON.stringify({ event, ...fields }));
}
