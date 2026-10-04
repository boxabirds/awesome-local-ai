import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { liveApi, type BoardApi } from '../api';
import { App } from '../App';
import { SharePanel } from '../share/SharePanel';
import { boardPath } from '../router';
import { NotFoundPage } from './NotFoundPage';
import {
  BOARD_PAGE_TEXT,
  boardPage,
  pageAfter,
  pageWantsRetry,
  retryDelayFor,
  type BoardPage as BoardPageState,
} from './state';

export interface BoardPageProps {
  /** The board the address names, already known to be a board's code. */
  boardId: string;
  /** What to ask the service with. Tests hand this a set of prepared answers. */
  api?: BoardApi;
}

/**
 * The page a board link leads to.
 *
 * It does one thing before it shows anything: it asks whether this board exists. That question is
 * not decoration - a board's id is a thing you cannot look up, so the only way to know whether a
 * link leads somewhere is to ask, and the only honest answers are the four this page knows how to
 * show. What it replaces is the older, worse habit of the client: making a board up locally and
 * hoping the room turned out to agree.
 *
 * The waiting is the part that has to be written down rather than felt. A check that cannot get
 * through is not a missing board, and saying "not found" then would be the worst thing this page
 * could do: it would tell a person on a train with a bad signal that their work is gone. So the
 * page says it cannot get there, asks again on the schedule in `state.ts`, and only gives up when
 * giving up has a button next to it.
 */
export function BoardPage({ boardId, api = liveApi }: BoardPageProps): JSX.Element {
  const [page, setPage] = useState<BoardPageState>(boardPage);
  // Bumped by "Try again". The check itself lives in the effect below, so this is only a way of
  // saying "that one again" to something that has stopped by itself.
  const [trying, setTrying] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let waiting: ReturnType<typeof setTimeout> | null = null;
    let current = boardPage();
    setPage(current);

    const ask = (): void => {
      void api.checkBoard(boardId).then(
        (outcome) => {
          if (cancelled) {
            return;
          }
          current = pageAfter(current, outcome);
          setPage(current);
          if (pageWantsRetry(current)) {
            waiting = setTimeout(ask, retryDelayFor(current.attempts));
          }
        },
        () => {
          if (cancelled) {
            return;
          }
          // An API that throws rather than answers is the same news as a service that says it
          // broke: this page does not get to decide that the board is missing.
          current = pageAfter(current, 'failed');
          setPage(current);
        },
      );
    };

    ask();
    return () => {
      cancelled = true;
      if (waiting !== null) {
        clearTimeout(waiting);
      }
    };
  }, [boardId, api, trying]);

  if (page.state === 'ready') {
    return (
      <div className="board-page" data-testid="board-page">
        <App key={boardId} boardId={boardId} />
        <SharePanel link={shareLink(boardId)} />
      </div>
    );
  }

  if (page.state === 'absent') {
    return <NotFoundPage boardId={boardId} />;
  }

  // "Opening" and "cannot get there" are both things happening still, so they are said as a
  // status; only the end of trying is an alert, and it comes with a button.
  const waiting = page.state !== 'error';
  return (
    <main className="page" data-testid="board-page">
      <p
        className={waiting ? 'page__status' : 'page__failure'}
        role={waiting ? 'status' : 'alert'}
        data-testid={waiting ? 'board-checking' : 'board-error'}
      >
        {BOARD_PAGE_TEXT[page.state]}
      </p>
      {page.state === 'error' ? (
        <button
          type="button"
          className="page__button"
          onClick={() => {
            setTrying((current) => current + 1);
          }}
        >
          Try again
        </button>
      ) : null}
    </main>
  );
}

/**
 * The link this board is known by: the address of this page, in full.
 *
 * It is built from where the page is being served, not written down anywhere, because a board's
 * address is not a fact about the board - it is a fact about the deployment it happens to be on.
 */
function shareLink(boardId: string): string {
  return `${window.location.origin}${boardPath(boardId)}`;
}

