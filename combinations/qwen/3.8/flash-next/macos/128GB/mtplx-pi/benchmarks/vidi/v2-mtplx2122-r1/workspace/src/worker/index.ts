/**
 * Worker entry (story 3).
 *
 * Routing contract:
 *
 * - `GET /api/rooms/:boardId` with `Upgrade: websocket` and a well-formed
 *   board id → forwarded to that board's `BoardRoom`. `idFromName(boardId)`
 *   gives every board its own object, which is how boards stay separate
 *   (`live.isolation`). Nothing counts participants, so a 6th person on a
 *   board is never refused (`live.over_capacity`).
 * - `GET /api/rooms/:boardId` with a malformed id → `400`, and no Durable
 *   Object instance is created.
 * - `GET /api/rooms/:boardId` without the upgrade header → `426`.
 * - everything else → static assets (`single-page-application` fallback means
 *   `/b/<boardId>` serves `index.html`).
 */

import { isValidBoardId } from '../shared/board-id'
import { BoardRoom } from './board-room'

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>
  ASSETS: Fetcher
}

const ROOM_PREFIX = '/api/rooms/'

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

function textResponse(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const boardId = boardIdFromPath(url.pathname)

    if (boardId === null) {
      // Not a room route: let the assets binding answer (index.html, /assets/*,
      // and the single-page-application fallback for /b/<id>).
      if (!env.ASSETS) return textResponse('Not found', 404)
      return env.ASSETS.fetch(request)
    }

    if (!isValidBoardId(boardId)) {
      // Board addresses are machine-generated; anything else is a typo or a
      // probe. Deliberately do not create a Durable Object for it.
      return textResponse('Invalid board id', 400)
    }

    const upgrade = request.headers.get('Upgrade')
    if (upgrade === null || upgrade.toLowerCase() !== 'websocket') {
      return textResponse('Upgrade Required', 426)
    }

    const namespace = env.BOARD_ROOM
    const stub = namespace.get(namespace.idFromName(boardId))
    return stub.fetch(request)
  },
}

export { BoardRoom }
