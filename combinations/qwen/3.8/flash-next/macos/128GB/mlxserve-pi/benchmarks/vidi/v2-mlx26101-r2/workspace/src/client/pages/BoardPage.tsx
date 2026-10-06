/**
 * The board page (design "Home, board and not-found pages").
 *
 * This is what a board *link* is: an address that may or may not have a board behind it,
 * and a page that has to find out before it can show anything. The check is small and
 * read-only (TC-13) — a board whose link was pasted into a chat by nine people is nine
 * checks and one board — and the board surface, with its socket, is mounted only once the
 * answer is yes. That order is the point: a socket opened against a board that is not
 * there produces a connection badge complaining about the network where the person needs
 * to read "Board not found", and it produces a board of sorts, which is worse.
 *
 * The three answers are three different experiences and one piece of layout:
 *
 *  - `exists` → the board, and the Share panel beside it;
 *  - `not_found` → the Board not found page, which offers to make a board but never
 *    makes one on its own;
 *  - `unreachable` → "Couldn't reach vidi6. Retrying…", and the retrying part is real:
 *    the wait doubles on each failure up to the ceiling the socket already uses, and the
 *    board opens by itself the moment the service comes back. A person who opened a link
 *    on a train is entitled to leave the page open and walk into a signal.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';

import type { BoardsApi, CheckResponse } from '../api.js';
import { boardsApi as realBoardsApi } from '../api.js';
import type { BoardConnector } from '../board/useBoardDoc.js';
import { BoardSurface } from '../board/BoardSurface.js';
import { NotFoundPage } from './NotFoundPage.js';
import { SharePanel } from '../share/SharePanel.js';
import {
  initialBoardPageState,
  nextBoardPageState,
  OPENING_BOARD_MESSAGE,
  UNREACHABLE_MESSAGE,
  type BoardPageState,
} from './state.js';

export interface BoardPageProps {
  /** A board id that has already been checked for shape; the router does that. */
  id: string;
  /** The board API, so a test can hand this page a service that answers late. */
  api?: BoardsApi;
  /** How to reach the room; passed straight down to the surface (design `App.tsx`). */
  connect?: BoardConnector;
}

/**
 * A check, and whatever comes of it.
 *
 * `connect` is a stable function so the effect below can depend on the *state* it is
 * reacting to and nothing else: the effect is re-run on every state change, and each run
 * either asks a question or schedules the next one, with the previous run's timer cleared
 * by its own cleanup. That is also what keeps StrictMode's double-mount from sending two
 * requests: the first run's timer never survives long enough to fire.
 */
export function BoardPage({ id, api = realBoardsApi, connect }: BoardPageProps): JSX.Element {
  const [state, setState] = useState<BoardPageState>(initialBoardPageState);

  // How many times the service has failed to answer *this* board, in a row. A ref
  // because it is a count of events and not something to render, and because updating it
  // inside a state updater would have it counted twice under StrictMode.
  const failures = useRef(0);

  // A new board id is a new question, so the count starts again. The page is keyed by id
  // in `App.tsx` and so remounts anyway; this is here because the page should not be
  // correct only when its parent remembers to key it.
  const counted = useRef(id);
  if (counted.current !== id) {
    counted.current = id;
    failures.current = 0;
  }

  const settled = useCallback((result: CheckResponse): void => {
    if (result.kind === 'unreachable') failures.current += 1;
    const attempt = failures.current === 0 ? 1 : failures.current;
    setState((current) => nextBoardPageState(current, result, attempt, id));
  }, [id]);

  const failed = useCallback((): void => {
    settled({ kind: 'unreachable' });
  }, [settled]);

  useEffect(() => {
    if (state.kind !== 'checking' && state.kind !== 'unreachable') return;

    let cancelled = false;
    const ask = (): void => {
      api.check(id).then(
        (result) => {
          if (!cancelled) settled(result);
        },
        // An API that throws is a service that did not answer. There is no other
        // sensible reading, and there is definitely no reading in which the person
        // looking at this page is told nothing at all because a promise rejected.
        () => {
          if (!cancelled) failed();
        },
      );
    };

    // The first check is immediate; a retry waits, and waits longer each time.
    const timer = setTimeout(ask, state.kind === 'unreachable' ? state.nextRetryMs : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [state, api, id, settled, failed]);

  switch (state.kind) {
    case 'ready':
      return (
        <>
          <BoardSurface boardId={id} connect={connect} />
          <SharePanel boardId={id} />
        </>
      );
    case 'not_found':
      // The same page an address that never named a board gets, for the same reason: the
      // answer to "that is not a board address" and "there is no board at that address"
      // is the same, and a person with a broken link should not have to know which kind
      // of broken they have.
      return <NotFoundPage api={api} />;
    case 'unreachable':
      return (
        <main className="page board-opening" data-testid="board-unreachable">
          <p className="page-brand">vidi6</p>
          <p className="page-text" data-testid="board-opening-message">
            {UNREACHABLE_MESSAGE}
          </p>
        </main>
      );
    case 'checking':
      return (
        <main className="page board-opening" data-testid="board-opening">
          <p className="page-brand">vidi6</p>
          <p className="page-text" data-testid="board-opening-message">
            {OPENING_BOARD_MESSAGE}
          </p>
        </main>
      );
  }
}
