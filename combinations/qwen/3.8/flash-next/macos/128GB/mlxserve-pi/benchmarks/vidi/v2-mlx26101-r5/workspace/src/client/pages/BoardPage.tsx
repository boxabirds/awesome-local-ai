/**
 * The page a board link opens.
 *
 * Before this story, arriving at an address put a board on screen and asked questions later.
 * Now there is a question first, and it has three possible answers, so this file is mostly
 * about what to show while it is out there and what each answer means:
 *
 *   checking      "Opening board…" — a link is being asked about, which takes one request
 *   ready         the board, with the Share button on it
 *   not found     Board not found — the service answered, and the answer was no
 *   unreachable   "Couldn't reach vidi6. Retrying…" — nothing was answered, so we ask again
 *
 * The difference between the last two is the whole design. A 404 is worth acting on: it is the
 * service saying there is no board, and the page says so and stops. Anything else — a network
 * error, a 503, an answer that is not the JSON we agreed — says nothing about whether the board
 * exists, and the one thing this page must not do is tell a person their board is gone because
 * something else was down. So it waits, and asks again, with the wait doubling from
 * `BOARD_CHECK_RETRY_BASE_MS` up to `RECONNECT_MAX_BACKOFF_MS`: enough of a gap that a person
 * reads "Retrying…" as a promise rather than as a page that is stuck, and enough of a backoff
 * that a person who leaves the tab open through an outage is not the reason the outage lasts.
 *
 * The board is asked about once per visit and then again only on the retry schedule; there is
 * no polling once it is open. Whether the board still exists is the connection's problem from
 * then on — that is what story 3's socket is for.
 */

import { useEffect, useState } from 'react';

import { BOARD_CHECK_RETRY_BASE_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';
import { getBoard } from '../api';
import { Board } from '../board/Board';
import { SharePanel } from '../share/SharePanel';
import { NotFoundPage } from './NotFoundPage';
import { OPENING_BOARD_MESSAGE, UNREACHABLE_MESSAGE } from './messages';
import type { GoTo } from './useCreateBoard';

/** What the page knows about the link it was given. */
export type BoardPageState = 'checking' | 'ready' | 'notFound' | 'unreachable';

export interface BoardPageProps {
  /** The board this address asks for. */
  boardId: string;
  /** Where to go when a board arrives. Defaults to the router. */
  go?: GoTo;
}

/** How long to wait before retry number `retry` (the first retry is number 0). */
export function boardCheckDelay(retry: number): number {
  return Math.min(BOARD_CHECK_RETRY_BASE_MS * 2 ** retry, RECONNECT_MAX_BACKOFF_MS);
}

/**
 * The board named by a link, once it is established that the link is one.
 *
 * `boardId` is in the effect's dependencies, so moving from one board link to another restarts
 * the question from the beginning — including the backoff, which belongs to a link and not to a
 * tab. A board that is already open does not get re-asked about.
 */
export function BoardPage({ boardId, go }: BoardPageProps): React.JSX.Element {
  const [state, setState] = useState<BoardPageState>('checking');

  useEffect(() => {
    /** Whether this visit is still the one on screen, and what it has scheduled. */
    let live = true;
    const timers: ReturnType<typeof setTimeout>[] = [];
    setState('checking');

    const ask = (retry: number): void => {
      void (async () => {
        const result = await getBoard(boardId);
        // An answer to a question this page no longer has: the person moved to another link, or
        // the tab is gone. It says nothing about the board now on screen, so it changes nothing.
        if (!live) return;
        if (result.ok) {
          setState('ready');
          return;
        }
        if (result.reason === 'not_found') {
          setState('notFound');
          return;
        }
        // Nothing was learned, so nothing is concluded. Wait, and ask again.
        setState('unreachable');
        timers.push(setTimeout(() => ask(retry + 1), boardCheckDelay(retry)));
      })();
    };

    ask(0);

    return () => {
      // Nothing this visit started may speak for it again: the answer is dropped, and the retry
      // that was already timed never goes out.
      live = false;
      for (const timer of timers) clearTimeout(timer);
    };
  }, [boardId]);

  switch (state) {
    case 'checking':
      // One sentence in the middle of the window, in a live region: a link is being asked about,
      // and this is the honest thing to say while that takes however long it takes.
      return (
        <main className="page" data-testid="board-opening" role="status">
          <p className="page-waiting">{OPENING_BOARD_MESSAGE}</p>
        </main>
      );
    case 'unreachable':
      // The same sentence in the same place, with a second line that says what happens next —
      // because "Couldn't reach vidi6" on its own reads as an ending, and it is not one.
      return (
        <main className="page" data-testid="board-unreachable" role="status">
          <p className="page-waiting">{UNREACHABLE_MESSAGE}</p>
          <p className="page-detail">The board will open as soon as vidi6 answers.</p>
        </main>
      );
    case 'notFound':
      // The service said no. Nothing was created here, and the way out is the same page that
      // explains any other link that leads nowhere.
      return <NotFoundPage boardId={boardId} go={go} />;
    case 'ready':
      return (
        <div className="board-page" data-testid="board-page">
          {/* The board from stories 1 to 4, unchanged: by the time it is on screen, the only thing
              that has happened is one request that could have been made before it. */}
          <Board boardId={boardId} />
          {/* Top-right, over the board: the one thing a person on an existing board is most
              likely to want to do that stories 1 to 4 had no way to do. */}
          <SharePanel boardId={boardId} />
        </div>
      );
  }
}
