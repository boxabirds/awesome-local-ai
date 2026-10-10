import type { JSX } from 'react';

import { askBoard } from '../api';
import { BoardContents } from '../board/BoardContents';
import { CameraProvider, useBoard } from '../canvas/CameraProvider';
import { canZoomIn, canZoomOut, zoomPercent } from '../canvas/camera';
import { NavigationHint } from '../canvas/NavigationHint';
import { ZoomControls } from '../canvas/ZoomControls';
import { boardHref } from '../router';
import { useBoardExistence, type ExistenceCheck } from '../sync/existence';
import { SharePanel } from '../share/SharePanel';
import { NotFoundPage } from './NotFoundPage';

/** Zoom chrome wired to the board camera. */
function BoardZoomControls(): JSX.Element {
  const board = useBoard();
  return (
    <ZoomControls
      zoomPercent={zoomPercent(board.camera)}
      canZoomIn={canZoomIn(board.camera)}
      canZoomOut={canZoomOut(board.camera)}
      onZoomIn={() => board.zoomStep('in')}
      onZoomOut={() => board.zoomStep('out')}
      onReset={board.reset}
    />
  );
}

/** First-use hint, hidden by the first pan or zoom of the visit. */
function BoardNavigationHint(): JSX.Element {
  const { hasNavigated } = useBoard();
  return <NavigationHint visible={!hasNavigated} />;
}

/**
 * The board's own header: the name, which is the way back to the home page, and
 * the share control. It floats over the board rather than pushing it down, because
 * the board is the whole viewport and a bar across the top would move the origin
 * under people's hands.
 */
function BoardHeader({ boardId }: { readonly boardId: string }): JSX.Element {
  return (
    <header className="board-header" data-testid="board-header">
      <a className="brand" href="/" data-testid="brand" title="vidi6 home">
        vidi6
      </a>
      <SharePanel boardId={boardId} />
    </header>
  );
}

/**
 * A board that is there: the document, the notes, the chrome.
 *
 * This is what story 3 built and story 5 does not change — except that it is
 * mounted only after the address in the location bar has been answered "here", so
 * the websocket it opens goes to a board that exists.
 */
export function BoardSession({ boardId }: { readonly boardId: string }): JSX.Element {
  return (
    <div className="board-app" data-testid="board-app" data-board-id={boardId}>
      <CameraProvider>
        <BoardContents boardId={boardId} />
        <BoardZoomControls />
        <BoardNavigationHint />
        <BoardHeader boardId={boardId} />
      </CameraProvider>
    </div>
  );
}

export interface BoardPageProps {
  readonly boardId: string;
  /**
   * How to ask whether this board exists. The real one is a `GET
   * /api/boards/:id`; a component test answers on a schedule instead, which is how
   * TC-21 gets to measure the interval between attempts without a server.
   */
  readonly check?: ExistenceCheck;
}

/**
 * The board route (`/b/<boardId>`), which is two things in one place: the question
 * "is there a board at this address?" and, once the answer is yes, the board.
 *
 * The question comes first, and it is asked before the socket opens, so a board
 * that is not there costs one read of `sqlite_master` on the server and never a
 * websocket — and a person standing at a wrong link reads "Board not found" instead
 * of a board with nothing on it, which is a lie about a different subject (TC-15).
 */
export function BoardPage({ boardId, check = askBoard }: BoardPageProps): JSX.Element {
  const existence = useBoardExistence(boardId, check);

  switch (existence.phase) {
    case 'ready':
      return <BoardSession boardId={boardId} />;
    case 'missing':
      // A definite no from the server, and boards are never deleted, so asking
      // again could teach nothing: the page says so and stops asking.
      return <NotFoundPage path={boardHref(boardId)} />;
    case 'unreachable':
      // Not a no — this is the app failing, and it is reported as that. The
      // schedule carries on asking, and this button asks again right now.
      return (
        <main className="page board-page" data-testid="board-page">
          <p className="board-status board-status--error" role="status" data-testid="board-status">
            Couldn’t reach vidi6. Retrying…
          </p>
          <button type="button" className="retry-check" onClick={existence.retry}>
            Try again
          </button>
        </main>
      );
    default:
      // The first answer has not come back yet, so nothing is known about this
      // address and nothing is drawn that might turn out to be a board.
      return (
        <main className="page board-page" data-testid="board-page">
          <p className="board-status" role="status" data-testid="board-status">
            Opening board…
          </p>
        </main>
      );
  }
}
