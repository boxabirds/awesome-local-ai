/**
 * Test-only routes (never enabled in a deployed Worker).
 *
 * `POST /api/__tests/seed-board` with `{"id": …, "updates": ["<base64>", …]}`
 * writes stored updates the way stories 3 and 4 did — content, no
 * `created_at` — so a *legacy* board can be created for TC-31 and TC-08 and
 * checked against story 5's existence rule. Without it there would be no way
 * to make a board that predates this story, because every route a real client
 * can now reach either grants a board or refuses it.
 *
 * The Worker only consults this module when `VIDI6_TEST_HOOKS === '1'`
 * (`tools/e2e-server.mjs` and the integration config set it), and the id must
 * still be well-formed: a hook cannot be used to write into somebody's board
 * through a guessed address, and nothing here runs in production.
 */

import { isValidBoardId } from '../shared/board-id'
import type { Env } from './index'

const SEED_PATH = '/api/__tests/seed-board'

export async function handleTestHook(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response | null> {
  if (url.pathname !== SEED_PATH) return null
  if (request.method.toUpperCase() !== 'POST') return null

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return new Response('{"error":"bad_request"}', {
      status: 400,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    })
  }

  const { id, updates } = (body ?? {}) as { id?: unknown; updates?: unknown }
  if (typeof id !== 'string' || !isValidBoardId(id)) {
    return new Response('{"error":"not_found"}', {
      status: 404,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    })
  }
  if (!Array.isArray(updates) || !updates.every(entry => typeof entry === 'string')) {
    return new Response('{"error":"bad_request"}', {
      status: 400,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    })
  }

  const namespace = env.BOARD_ROOM
  const stub = namespace.get(namespace.idFromName(id))
  const written = await stub.seed(updates as string[])
  return new Response(JSON.stringify({ id, seeded: written }), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}
