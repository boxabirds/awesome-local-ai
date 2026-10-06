/**
 * Test-only routes (`tests/e2e/share.spec.ts` TC-31).
 *
 * Some fixtures cannot be produced by the product any more: story 5 makes a
 * board exist only if it was created, so an e2e test that needs a **legacy**
 * board — one with saved content but no `created_at`, which is exactly the shape
 * `share.legacy_boards` is about — has to write storage from the outside.
 *
 * These routes exist for that, and they are off unless the Worker is run with
 * `TEST_HOOKS=1` (the e2e servers pass it on the command line; a production
 * deploy does not). With the flag absent every `/__test-hooks/...` request is a
 * 404, so nothing here is reachable in the product.
 */

import { isValidBoardId } from "../shared/board-id";
import type { Env } from "./index";

export const TEST_HOOKS_PREFIX = "/__test-hooks/";

/** JSON response, because every hook is a small request/response contract. */
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Handles a `/__test-hooks/...` request, or returns `null` when this Worker has
 * no test hooks (the production case).
 */
export async function handleTestHook(
  request: Request,
  env: Env,
  pathname: string,
): Promise<Response | null> {
  if (env.TEST_HOOKS !== "1") return null;
  if (!pathname.startsWith(TEST_HOOKS_PREFIX)) return null;

  const hook = pathname.slice(TEST_HOOKS_PREFIX.length);

  if (hook === "legacy-board" && request.method === "POST") {
    return seedLegacyBoard(request, env);
  }

  return json({ error: "unknown_test_hook" }, 404);
}

/**
 * `POST /__test-hooks/legacy-board`  { id, updates: base64[] }
 *
 * Writes `updates` into that board's storage through the room's own write path
 * (apply to the document → append to the log), which is what a legacy board is:
 * content, and no `created_at`. It is the real append path, not a simulation of
 * it — the same rows a person's edits would have left.
 */
async function seedLegacyBoard(request: Request, env: Env): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const { id, updates } = (body ?? {}) as { id?: unknown; updates?: unknown };
  if (typeof id !== "string" || !isValidBoardId(id)) return json({ error: "invalid_id" }, 400);
  if (!Array.isArray(updates) || updates.some((update) => typeof update !== "string")) {
    return json({ error: "invalid_updates" }, 400);
  }

  const rows = await env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id)).seedBoardUpdates(
    updates as string[],
  );
  return json({ ok: true, id, rows });
}
