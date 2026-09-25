/**
 * Board page (anchor: share.pages): checks that the link's board exists before mounting the
 * stories 1–4 board. Malformed ids are Board not found without any request; an unreachable
 * service is retried with exponential backoff from BOARD_CHECK_RETRY_BASE_MS, capped at
 * RECONNECT_MAX_BACKOFF_MS, until the board opens or turns out not to exist.
 */
import { useEffect, useState } from 'react';
import { App } from '../App';
import { checkBoard } from '../api';
import { SharePanel } from '../share/SharePanel';
import { isValidBoardId } from '../../shared/board-id';
import { BOARD_CHECK_RETRY_BASE_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';
import { NotFoundPage } from './NotFoundPage';

export const OPENING_TEXT = 'Opening board…';
export const UNREACHABLE_TEXT = "Couldn't reach vidi6. Retrying…";

type PageState = 'checking' | 'unreachable' | 'ready' | 'not_found';

/** Delay before retry number `failures` (1-based). */
export function checkRetryDelay(failures: number): number {
  return Math.min(BOARD_CHECK_RETRY_BASE_MS * 2 ** (failures - 1), RECONNECT_MAX_BACKOFF_MS);
}

export function BoardPage(props: { id: string }): React.JSX.Element {
  const { id } = props;
  const valid = isValidBoardId(id);
  const [state, setState] = useState<PageState>(valid ? 'checking' : 'not_found');

  useEffect(() => {
    if (!valid) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    const attempt = () => {
      checkBoard(id)
        .catch(() => ({ kind: 'unreachable' as const }))
        .then((result) => {
          if (cancelled) return;
          if (result.kind === 'exists') setState('ready');
          else if (result.kind === 'not_found') setState('not_found');
          else {
            failures += 1;
            setState('unreachable');
            timer = setTimeout(attempt, checkRetryDelay(failures));
          }
        });
    };
    attempt();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [id, valid]);

  if (state === 'not_found') return <NotFoundPage />;
  if (state === 'ready') {
    return (
      <>
        <App boardId={id} />
        <SharePanel boardId={id} />
      </>
    );
  }
  return (
    <main className="page">
      <p className="page-text" role="status">
        {state === 'checking' ? OPENING_TEXT : UNREACHABLE_TEXT}
      </p>
    </main>
  );
}
