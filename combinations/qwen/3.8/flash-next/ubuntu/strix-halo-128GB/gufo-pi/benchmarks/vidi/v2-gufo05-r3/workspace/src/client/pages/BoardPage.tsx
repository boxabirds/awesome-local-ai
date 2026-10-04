/**
 * The board page (story 5, `share.pages`).
 *
 * Given an id from the address bar it decides what to show, and only mounts the
 * stories 1–4 board once the board is known to exist:
 *
 *   malformed id ................ Board not found, no request (share.not_found)
 *   exists ...................... the board, fully editable, no sign-in (open_link)
 *   unknown id .................. Board not found
 *   service unreachable ......... "Couldn't reach vidi6. Retrying…" and an
 *                                 automatic backoff retry that needs no reload
 *                                 (share.unreachable)
 *
 * While the first check runs the page says "Opening board…". Retry timers are
 * cleared on unmount so a tab that moved on cannot wake a dead component.
 */

import { useEffect, useState } from 'react';
import App from '../App';
import { checkBoard } from '../api';
import { isValidBoardId } from '../../shared/board-id';
import { SharePanel } from '../share/SharePanel';
import { NotFoundPage } from './NotFoundPage';
import { nextBoardPageState, type BoardPageState } from './state';

/** Shown while the very first existence check is in flight (PRD: loading). */
export const OPENING_MESSAGE = 'Opening board…';
/** Shown while the service cannot be reached (PRD `share.unreachable`). */
export const UNREACHABLE_MESSAGE = "Couldn't reach vidi6. Retrying\u2026";

export interface BoardPageProps {
  id: string;
}

export function BoardPage({ id }: BoardPageProps) {
  const valid = isValidBoardId(id);
  const [state, setState] = useState<BoardPageState>(() =>
    valid ? { kind: 'checking' } : { kind: 'not_found' },
  );

  useEffect(() => {
    // A malformed id is answered from the address alone: no request, no Durable
    // Object, nothing created (share.not_found).
    if (!valid) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const run = async (attempt: number): Promise<void> => {
      const result = await checkBoard(id);
      if (cancelled) return;
      const next = nextBoardPageState({ kind: 'checking' }, result, attempt, id);
      setState(next);
      if (next.kind === 'unreachable') {
        timer = setTimeout(() => void run(attempt + 1), next.nextRetryMs);
      }
    };

    void run(1);
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [id, valid]);

  if (state.kind === 'ready') {
    return (
      <div className="board-page" data-testid="board-page">
        <App boardId={state.boardId} />
        <SharePanel boardId={state.boardId} />
      </div>
    );
  }

  if (state.kind === 'not_found') return <NotFoundPage />;

  const message = state.kind === 'unreachable' ? UNREACHABLE_MESSAGE : OPENING_MESSAGE;
  return (
    <main
      className="board-page-board-check"
      role="status"
      data-board-check={state.kind}
      data-testid="board-page-status"
    >
      {message}
    </main>
  );
}
