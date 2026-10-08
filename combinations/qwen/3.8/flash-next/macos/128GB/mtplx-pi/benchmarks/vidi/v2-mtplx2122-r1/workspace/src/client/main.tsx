import { createRoot } from 'react-dom/client'
import { App } from './App'
import { isValidBoardId, newBoardId } from '../shared/board-id'

/**
 * Routing (story 3, temporary until story 5 adds a real router):
 * `/b/<boardId>` opens that board; anything else — including `/` — opens a
 * freshly generated board.  A board id that is not valid base64url is replaced
 * rather than sent to the server (the Worker would answer the websocket
 * upgrade with 400 anyway).
 */
export function boardIdFromPath(pathname: string): string | null {
  const match = /^\/b\/([^/?#]+)/.exec(pathname)
  if (!match) return null
  const candidate = decodeURIComponent(match[1])
  return isValidBoardId(candidate) ? candidate : null
}

function resolveBoardId(pathname: string): { boardId: string; pathname: string } {
  const existing = boardIdFromPath(pathname)
  if (existing) return { boardId: existing, pathname }
  const fresh = newBoardId()
  return { boardId: fresh, pathname: `/b/${fresh}` }
}

const initial = resolveBoardId(window.location.pathname)
if (initial.pathname !== window.location.pathname) {
  // `replaceState` keeps Back from cycling through generated boards.
  window.history.replaceState(null, '', initial.pathname)
}

const root = createRoot(document.getElementById('root')!)
// One App instance per board: switching boards rebuilds the Y.Doc and the
// connection instead of reusing either.
root.render(<App key={initial.boardId} boardId={initial.boardId} />)
