/**
 * The board page: check the address, then show the board.
 *
 * A link is the only thing a person has when somebody shares a board, and it can be
 * broken in three ways — mistyped, pointing at a board that is gone, or opened while the
 * service cannot be reached — so this page is a check with three outcomes, and each of
 * them says what it means:
 *
 *   - "Opening board…" while the first answer is outstanding;
 *   * the board, when the Worker says the address is one;
 *   * `NotFoundPage`, when it says it is not — the same page whether the id could never
 *     have been one or was deleted years ago;
 *   * "Couldn't reach vidi6. Retrying…", which keeps asking, doubling the wait each time.
 *
 * The check is not skipped for a malformed id. `isValidBoardId` is the Worker's rule, and
 * the page could guess "that cannot be a board" from the shape alone — but a page that
 * guessed and a Worker that checked would be two answers, and the one the room gives is
 * the one that decides. So the page declines to ask and shows the not-found page, which
 * is the answer the room would have given.
 */
import { useEffect, useState, type JSX } from 'react';

import * as api from '../api';
import { isValidBoardId } from '../../shared/board-id';
import { App } from '../App';
import { SharePanel } from '../share/SharePanel';
import { NotFoundPage } from './NotFoundPage';
import { nextBoardPageState, type BoardPageState } from './state';

export function BoardPage({ id }: { id: string }): JSX.Element {
  const state = useBoardPageState(id);

  if (state.kind === 'not_found') return <NotFoundPage />;
  if (state.kind === 'checking') return <Notice text="Opening board…" />;
  if (state.kind === 'unreachable') return <Notice text="Couldn't reach vidi6. Retrying…" />;

  return (
    <>
      <App boardId={state.boardId} />
      <SharePanel boardId={state.boardId} />
    </>
  );
}

/**
 * Ask the Worker whether `id` is a board, retrying a check it cannot complete.
 *
 * The sequence is written as a small loop rather than as state transitions on user input,
 * because nobody is inputting anything: this runs on arrival. `cancelled` is set when the
 * page unmounts or the address changes — a retry scheduled for a board that has been
 * navigated away from must not answer for the new one — and `attempt` counts the checks
 * this address has had, which is what sets the wait.
 */
function useBoardPageState(id: string): BoardPageState {
  const [state, setState] = useState<BoardPageState>(() =>
    isValidBoardId(id) ? { kind: 'checking', boardId: id } : { kind: 'not_found' },
  );

  useEffect(() => {
    if (!isValidBoardId(id)) {
      // Nothing to ask, and nothing to wait for. `isValidBoardId` says this address can
      // not name a board, so the answer is already the one the Worker would give.
      setState({ kind: 'not_found' });
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let current: BoardPageState = { kind: 'checking', boardId: id };
    setState(current);

    const check = async (): Promise<void> => {
      const result = await api.checkBoard(id);
      if (cancelled) return;
      attempt += 1;
      current = nextBoardPageState(current, result.kind, attempt, id);
      setState(current);
      if (current.kind === 'unreachable') {
        timer = setTimeout(() => {
          void check();
        }, current.nextRetryMs);
      }
    };
    void check();

    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [id]);

  return state;
}

/** A full-page sentence, announced when it appears. */
function Notice({ text }: { text: string }): JSX.Element {
  return (
    <main className="page">
      <p className="page__notice" role="status">
        {text}
      </p>
    </main>
  );
}
