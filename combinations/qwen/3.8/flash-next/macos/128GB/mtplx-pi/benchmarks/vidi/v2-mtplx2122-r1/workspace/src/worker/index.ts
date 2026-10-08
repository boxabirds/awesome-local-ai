/**
 * Worker entry (story 3, extended by story 5 with the board API).
 *
 * Routing contract:
 *
 * - `POST /api/boards` → `createBoard`: one 128-bit id plus one
 *   `initialize()` RPC on the new board's `BoardRoom`. `201 {"id": …}` on
 *   success, `500 {"error":"create_failed"}` when the RPC throws or answers
 *   `exists` (`share.create`, `share.create_failure`).
 * - `GET /api/boards/:boardId` → `200 {"id": …}` when that board exists,
 *   `404 {"error":"not_found"}` when it does not *or* when the id is
 *   malformed: one answer for both, so a probe learns nothing, and neither
 *   path touches a Durable Object (TC-07).
 * - other methods on `/api/boards…` → `405`.
 * - `GET /api/rooms/:boardId` with `Upgrade: websocket` → forwarded to that
 *   board's `BoardRoom`. `idFromName(boardId)` gives every board its own
 *   object, which is how boards stay separate (`live.isolation`). Nothing
 *   counts participants, so a 6th person on a board is never refused
 *   (`live.over_capacity`). A board that was never granted comes back `404`
 *   from the room itself; a malformed id is refused here, `404` as well —
 *   story 3 answered `400`, and story 5 collapsed the two so that the client
 *   has exactly one "this address is not a board" case to handle.
 * - `GET /api/rooms/:boardId` without the upgrade header → `426`.
 * - everything else → static assets (`single-page-application` fallback means
 *   `/b/<boardId>` serves `index.html`).
 */

import { isValidBoardId } from '../shared/board-id'
import { BoardRoom } from './board-room'
import { createBoard } from './create-board'
import { handleTestHook } from './test-hooks'

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>
  ASSETS: Fetcher
  /**
   * `1` in the local e2e server and in integration tests only: it turns on
   * `/api/__tests/*`, which is how a legacy board (content, no `created_at`)
   * is created for TC-31. A deployed Worker has no such variable, and the
   * routes answer 404 there.
   */
  VIDI6_TEST_HOOKS?: string
}

const ROOM_PREFIX = '/api/rooms/'
const BOARDS_PATH = '/api/boards'
const BOARDS_PREFIX = '/api/boards/'
const TEST_HOOKS_PREFIX = '/api/__tests/'

/** Extract the `:boardId` segment, or `null` when the path is not a room route. */
export function boardIdFromPath(pathname: string): string | null {
  if (!pathname.startsWith(ROOM_PREFIX)) return null
  const rest = pathname.slice(ROOM_PREFIX.length)
  if (rest.length === 0) return null
  // Only a single segment is a room address: `/api/rooms/a/b` is not.
  if (rest.includes('/')) return null
  try {
    return decodeURIComponent(rest)
  } catch {
    return null
  }
}

/** The `:boardId` of a `/api/boards/<id>` request, or `null` for `/api/boards`. */
function boardIdFromApiPath(pathname: string): string | null {
  if (!pathname.startsWith(BOARDS_PREFIX)) return null
  const rest = pathname.slice(BOARDS_PREFIX.length)
  if (rest.length === 0 || rest.includes('/')) return null
  try {
    return decodeURIComponent(rest)
  } catch {
    return null
  }
}

function textResponse(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })
}

function jsonResponse(body: Record<string, string>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

/** "This address is not a board": the one answer for unknown and malformed ids. */
function notFound(): Response {
  return jsonResponse({ error: 'not_found' }, 404)
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const { pathname } = url
    const method = request.method.toUpperCase()

    // Test hooks come first: they are not part of the product and answer 404
    // for anybody who is not running the test server.
    if (pathname.startsWith(TEST_HOOKS_PREFIX)) {
      if (env.VIDI6_TEST_HOOKS !== '1') return notFound()
      const handled = await handleTestHook(request, env, url)
      if (handled !== null) return handled
      return notFound()
    }

    if (pathname === BOARDS_PATH || pathname === `${BOARDS_PATH}/`) {
      if (method !== 'POST') return textResponse('Method Not Allowed', 405)
      const result = await createBoard(env)
      if (!result.ok) return jsonResponse({ error: 'create_failed' }, 500)
      return jsonResponse({ id: result.id }, 201)
    }

    if (pathname.startsWith(BOARDS_PREFIX)) {
      if (method !== 'GET' && method !== 'HEAD') {
        return textResponse('Method Not Allowed', 405)
      }
      const boardId = boardIdFromApiPath(pathname)
      if (boardId === null || !isValidBoardId(boardId)) {
        // Malformed: no Durable Object is instantiated and no storage is read.
        return notFound()
      }
      const namespace = env.BOARD_ROOM
      const stub = namespace.get(namespace.idFromName(boardId))
      const exists = await stub.exists()
      return exists ? jsonResponse({ id: boardId }, 200) : notFound()
    }

    const boardId = boardIdFromPath(pathname)

    if (boardId === null) {
      // Not an API route: let the assets binding answer (index.html, /assets/*,
      // and the single-page-application fallback for /b/<id>).
      if (!env.ASSETS) return textResponse('Not found', 404)
      return env.ASSETS.fetch(request)
    }

    if (!isValidBoardId(boardId)) {
      // Board addresses are machine-generated; anything else is a typo or a
      // probe. Deliberately do not create a Durable Object for it, and answer
      // the same 404 a valid-but-unknown id gets.
      return notFound()
    }

    const upgrade = request.headers.get('Upgrade')
    if (upgrade === null || upgrade.toLowerCase() !== 'websocket') {
      return textResponse('Upgrade Required', 426)
    }

    const namespace = env.BOARD_ROOM
    const stub = namespace.get(namespace.idFromName(boardId))
    // The room decides whether the board exists (and answers 404 when it does
    // not), so the answer a browser gets is the same whether it arrives
    // through GET /api/boards/:id or through the websocket upgrade.
    return stub.fetch(request)
  },
}

export { BoardRoom }
