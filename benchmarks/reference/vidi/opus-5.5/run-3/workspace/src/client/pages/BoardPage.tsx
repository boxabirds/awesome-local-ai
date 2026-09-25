import { useEffect, useState } from 'react';
import { isValidBoardId } from '../../shared/board-id';
import { BOARD_CHECK_RETRY_BASE_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';
import { checkBoard } from '../api';
import { App } from '../App';
import { SharePanel } from '../share/SharePanel';
import { NotFoundPage } from './NotFoundPage';

export const OPENING_TEXT = 'Opening board…';
export const UNREACHABLE_TEXT = "Couldn't reach vidi6. Retrying…";

type PageState = 'checking' | 'unreachable' | 'ready' | 'not_found';

/** Delay before retry number `attempt` (0-based): doubles from the base, capped. */
export function checkRetryDelay(attempt: number): number {
  return Math.min(BOARD_CHECK_RETRY_BASE_MS * 2 ** attempt, RECONNECT_MAX_BACKOFF_MS);
}

/**
 * Opens a board link: malformed ids are Board not found without a request; otherwise the board is checked
 * (retrying with backoff while the service is unreachable) and only an existing board is mounted.
 */
export function BoardPage(props: { id: string }) {
  const { id } = props;
  const valid = isValidBoardId(id);
  const [state, setState] = useState<PageState>('checking');

  useEffect(() => {
    if (!valid) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    const check = async () => {
      const result = await checkBoard(id).catch(() => ({ kind: 'unreachable' as const }));
      if (cancelled) return;
      if (result.kind === 'exists') setState('ready');
      else if (result.kind === 'not_found') setState('not_found');
      else {
        setState('unreachable');
        timer = setTimeout(() => void check(), checkRetryDelay(attempt++));
      }
    };
    void check();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [id, valid]);

  if (!valid || state === 'not_found') return <NotFoundPage />;
  if (state === 'ready') {
    return (
      <>
        <App boardId={id} />
        <SharePanel boardId={id} />
      </>
    );
  }
  return (
    <main className="page" aria-busy="true">
      <p className="page__text" role="status">
        {state === 'unreachable' ? UNREACHABLE_TEXT : OPENING_TEXT}
      </p>
    </main>
  );
}
