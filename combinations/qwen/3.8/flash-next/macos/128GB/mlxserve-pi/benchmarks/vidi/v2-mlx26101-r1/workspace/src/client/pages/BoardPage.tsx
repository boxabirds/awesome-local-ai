// The board page: the address bar's link, checked before anything is mounted.
//
// The order matters (share.not_found):
//   checking   "Opening board\u2026"          — asking the service
//   ready      the board + Share panel        — it said the board exists
//   not_found  "Board not found"              — it said 404
//   unreachable"Couldn't reach vidi6. Retrying\u2026" — we could not ask, so we retry
//
// The stories 1-4 board (and with it `connectBoard`) is mounted *only* in `ready`, so
// a bad link never opens a WebSocket and never writes anything. An id that is not a
// link at all is answered here without asking: there is no such board, and the
// service is not consulted for garbage.

import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { checkBoard } from '../api';
import { isValidBoardId } from '../../shared/board-id';
import { Board } from '../board/Board';
import { SharePanel } from '../share/SharePanel';
import { NotFoundPage } from './NotFoundPage';
import { nextBoardPageState, type BoardPageState } from './state';

export interface BoardPageProps {
  /** The link from the address bar, as written. */
  id: string;
}

/** A full-screen status line, for the states that have no board to show. */
function StatusScreen({
  testId,
  text,
}: {
  testId: string;
  text: string;
}): JSX.Element {
  return (
    <main className="status-screen" data-testid={testId}>
      <p className="status-screen-text" role="status">
        {text}
      </p>
    </main>
  );
}

export function BoardPage({ id }: BoardPageProps): JSX.Element {
  // A malformed link is answered without a request: nothing about it can exist.
  const [state, setState] = useState<BoardPageState>(() =>
    isValidBoardId(id) ? { kind: 'checking' } : { kind: 'not_found' },
  );

  useEffect(() => {
    if (!isValidBoardId(id)) return;
    // This effect owns the whole asking sequence: `last` is what we told React, and
    // `attempt` how many times we have asked, so the retry cadence is one straight
    // line rather than state scattered across renders.
    let last: BoardPageState = { kind: 'checking' };
    let attempt = 0;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const ask = (): void => {
      void checkBoard(id).then((result) => {
        if (cancelled) return;
        attempt += 1;
        last = nextBoardPageState(last, result, attempt, id);
        setState(last);
        if (last.kind === 'unreachable') {
          timer = setTimeout(ask, last.nextRetryMs);
        }
      });
    };
    ask();

    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [id]);

  if (state.kind === 'checking') {
    return <StatusScreen testId="board-checking" text={'Opening board\u2026'} />;
  }
  if (state.kind === 'unreachable') {
    // One sentence, worded exactly as the PRD words it: what went wrong, and that it
    // is already being retried. Never "not found" — we do not know that, and saying it
    // would be the one answer this story is not allowed to give.
    return (
      <StatusScreen
        testId="board-unreachable"
        text={"Couldn't reach vidi6. Retrying\u2026"}
      />
    );
  }
  if (state.kind === 'not_found') {
    return <NotFoundPage />;
  }

  // Only a board that exists gets a live connection, a tool rail and a Share button.
  return (
    <div className="board-page" data-testid="board-page">
      <Board boardId={state.boardId} />
      <SharePanel boardId={state.boardId} />
    </div>
  );
}
