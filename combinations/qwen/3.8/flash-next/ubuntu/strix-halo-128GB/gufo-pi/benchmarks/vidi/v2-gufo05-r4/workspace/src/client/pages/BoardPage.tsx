/**
 * A board address, and what the server says about it (`share.open_link`).
 *
 * The page does one thing before it does anything else: it asks whether this address is a
 * board. That is not politeness. A board's content arrives over a WebSocket, and without the
 * check a person following a mistyped link would be connected to a room at an address nobody
 * created and invited to fill in a blank board (`share.not_found`).
 *
 * Once the answer is "yes", the page renders the board and gets out of the way. From there
 * the connection has its own states and its own badge, and a page that held a second opinion
 * about them would be a second source of truth.
 */

import { useEffect, useRef, useState, type JSX } from 'react';
import { checkBoard } from '../api';
import { boardPath } from '../router';
import { BoardScreen } from '../board/BoardScreen';
import { NotFoundPage } from './NotFoundPage';
import { initialBoardPageState, nextBoardPageState, type BoardPageState } from './state';

export function BoardPage({ id }: { id: string }): JSX.Element {
  const [page, setPage] = useState<BoardPageState>(() => initialBoardPageState(id));

  /**
   * How many re-checks of *this address* have already been waited for.
   *
   * A ref rather than state because it is not something the page renders: it decides how
   * long the next wait is, and a render for each retry would restart the effect that owns the
   * timer it is waiting on.
   */
  const attempt = useRef(0);

  /* The check, and only while the page is `checking`. Driving work off the state rather than
     off the mount is what keeps a request from outliving the state that asked for it: when the
     state moves, this effect is torn down and its answer is dropped. */
  const checking = page.kind === 'checking';
  useEffect(() => {
    if (!checking) return;
    let cancelled = false;
    void checkBoard(id).then((result) => {
      if (cancelled) return;
      // The address bar is the authority. If it no longer shows the board this request was
      // about, the answer is not news, however confident the server sounds.
      const stale = window.location.pathname !== boardPath(id);
      if (stale) return;
      setPage((current) => nextBoardPageState(current, result, attempt.current, id));
    });
    return () => {
      cancelled = true;
    };
  }, [checking, id]);

  /* A board that could not be reached is not a board that is gone, so the page asks again —
     with the doubling backoff of `boardCheckRetryMs`, for the same reason the live connection
     has one: the person holding this link has done nothing wrong, and the signal comes back
     (`share.unreachable`). */
  const nextRetryMs = page.kind === 'unreachable' ? page.nextRetryMs : null;
  useEffect(() => {
    if (nextRetryMs === null) return;
    const timer = setTimeout(() => {
      attempt.current += 1;
      setPage((current) => nextBoardPageState(current, { kind: 'retry' }, attempt.current, id));
    }, nextRetryMs);
    // A wait that ends after this page is gone must not ask anything (`share.unreachable`).
    return () => clearTimeout(timer);
  }, [nextRetryMs, id]);

  switch (page.kind) {
    case 'checking':
      return (
        <div className="vidi6-page vidi6-page--status" role="status">
          Opening board…
        </div>
      );
    case 'unreachable':
      return (
        <div className="vidi6-page vidi6-page--status" role="status">
          Couldn't reach vidi6. Retrying…
        </div>
      );
    case 'not_found':
      return <NotFoundPage />;
    case 'ready':
      // The board a person wanted: full editing, no sign-in, no further step
      // (`share.open_link`). `page.boardId` is the id this page was asked about and the
      // server confirmed — the address bar and the content cannot come apart here.
      return <BoardScreen boardId={page.boardId} />;
  }
}
