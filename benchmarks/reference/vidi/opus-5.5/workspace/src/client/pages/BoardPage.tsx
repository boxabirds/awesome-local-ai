import { useEffect, useState } from 'react';
import { isValidBoardId } from '../../shared/board-id';
import { BOARD_CHECK_RETRY_BASE_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';
import { checkBoard } from '../api';
import { Board } from '../board/Board';
import { SharePanel } from '../share/SharePanel';
import { NotFoundPage } from './NotFoundPage';

export const OPENING_TEXT = 'Opening board…';
export const UNREACHABLE_TEXT = "Couldn't reach vidi6. Retrying…";
const BACKOFF_FACTOR = 2;

type PageState = 'checking' | 'ready' | 'not_found' | 'unreachable';

/** Delay before retry number `attempt` (0-based): base, 2×base, 4×base… capped. */
export function checkRetryDelay(attempt: number): number {
  return Math.min(BOARD_CHECK_RETRY_BASE_MS * BACKOFF_FACTOR ** attempt, RECONNECT_MAX_BACKOFF_MS);
}

/**
 * A board link: malformed ids → Board not found without a request; otherwise the board's
 * existence is checked (retrying with backoff while the service is unreachable) and the board
 * of stories 1–4 is mounted only once it is known to exist.
 */
export function BoardPage({ id }: { id: string }) {
  const valid = isValidBoardId(id);
  const [state, setState] = useState<PageState>(valid ? 'checking' : 'not_found');

  useEffect(() => {
    if (!valid) return undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = (n: number) => {
      checkBoard(id)
        .catch(() => ({ kind: 'unreachable' as const }))
        .then((res) => {
          if (cancelled) return;
          if (res.kind === 'exists') setState('ready');
          else if (res.kind === 'not_found') setState('not_found');
          else {
            setState('unreachable');
            timer = setTimeout(() => attempt(n + 1), checkRetryDelay(n));
          }
        });
    };
    attempt(0);
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [id, valid]);

  switch (state) {
    case 'ready':
      return (
        <Board boardId={id}>
          <SharePanel boardId={id} />
        </Board>
      );
    case 'not_found':
      return <NotFoundPage />;
    case 'checking':
    case 'unreachable':
      return (
        <main className="page page--opening">
          <p className="page__text" role="status">
            {state === 'checking' ? OPENING_TEXT : UNREACHABLE_TEXT}
          </p>
        </main>
      );
  }
}
