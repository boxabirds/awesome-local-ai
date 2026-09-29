/**
 * The board route (story 5, tasks 1.3 and 5).
 *
 * A board page first asks whether the board exists, and only when that check
 * says yes does it mount the board surface, which is where the provider (and so
 * the socket) is created. That ordering is the whole point: before the `200`
 * nothing connects, so a wrong or truncated link cannot open an empty
 * collaborative session, cannot write, and cannot fork somebody's board
 * (`live.no_fork`, `share.not_found`).
 *
 * Four things can be on screen, and only the last one is a board:
 *
 *  - "Opening board…" while the first check is in flight;
 *  - the same line with a *Retrying* marker while an unreachable service is
 *    being retried — never a silent switch to "not found" (`share.unreachable`);
 *  - "Board not found", for a `404` and for an id that was never a valid id;
 *  - the board itself, which is stories 1–4 plus the Share button.
 *
 * `App` is reused unchanged as the surface, which is what keeps the story 1–4
 * component tests — they render `App` directly — working without a gate.
 */
import { App } from '../App';
import { NotFoundPage } from './NotFound';
import { SharePanel } from '../share/SharePanel';
import { useBoardExists, type BoardExistsOptions } from '../useBoardExists';
import type { ProviderLike } from '../sync/connectBoard';
import { BOARD_LINK_PREFIX, boardLink, isValidBoardId } from '../../shared/board-id';

/** The exact PRD copy for the two waiting states. */
export const BOARD_PAGE_TEXT = {
  opening: 'Opening board\u2026',
  retrying: "Couldn't reach vidi6. Retrying\u2026",
} as const;

export interface BoardPageProps extends BoardExistsOptions {
  /** The board this page was routed to. */
  boardId: string;
  /** The socket factory, injected so a test can watch whether one is made. */
  providerFactory?: (url: string, room: string, doc: import('yjs').Doc) => ProviderLike;
  /** Where the board service lives. Defaults to the page's own host. */
  origin?: string;
}

/**
 * The board route: a waiting line, "Board not found", or — once the existence
 * check has returned `200` — the board surface.
 */
export function BoardPage({
  boardId,
  providerFactory,
  origin: propsOrigin,
  ...check
}: BoardPageProps) {
  // A malformed id is answered here, with no request at all: there is no
  // board shaped like `abc`, and asking would put a guess on the network
  // (`share.unguessable`, and TC-19's "checkBoard never called").
  const valid = isValidBoardId(boardId);
  const { status } = useBoardExists(valid ? boardId : null, check);

  if (status.phase === 'loading') {
    return (
      <main className="page board-loading" data-testid="board-loading">
        <p role="status" data-testid="board-loading-text">
          {status.retried ? BOARD_PAGE_TEXT.retrying : BOARD_PAGE_TEXT.opening}
        </p>
      </main>
    );
  }

  if (status.phase === 'not_found') {
    return (
      <NotFoundPage
        reason={valid ? 'missing' : 'malformed'}
        attempted={`${BOARD_LINK_PREFIX}${boardId}`}
      />
    );
  }

  // Found: hand the board over to the surface. `App` builds the session and so
  // opens the socket, and it is only mounted now, after the `200`.
  const origin = propsOrigin ?? (typeof window !== 'undefined' ? window.location.origin : '');
  return (
    <div className="board-page" data-testid="board-page">
      <header className="board-topbar" data-testid="board-topbar">
        <SharePanel boardId={boardId} link={boardLink(boardId, origin)} />
      </header>
      <App
        location={`${BOARD_LINK_PREFIX}${boardId}`}
        providerFactory={providerFactory}
        origin={propsOrigin}
      />
    </div>
  );
}
