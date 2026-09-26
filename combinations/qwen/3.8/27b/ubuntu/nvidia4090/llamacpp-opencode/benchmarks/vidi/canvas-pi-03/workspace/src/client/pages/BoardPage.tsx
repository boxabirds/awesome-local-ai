import { useEffect, useRef, useState } from 'react';
import { checkBoard } from '@/client/api';
import { isValidBoardId } from '@/shared/board-id';
import { BOARD_CHECK_RETRY_BASE_MS, RECONNECT_MAX_BACKOFF_MS } from '@/shared/config';
import { Board } from '@/client/board/Board';
import { NotFoundPage } from './NotFoundPage';
import type { ReactElement } from 'react';

/**
 * `/b/:boardId` (story 5, share.urls): before rendering the board, the page
 * confirms the board exists.
 *
 *  - malformed ids (not 22 base64url chars) never touch the network and go
 *    straight to the not-found page;
 *  - a definitive 404 goes to the not-found page;
 *  - a network error is NOT a 404 (the board may exist): "Couldn't reach
 *    vidi6. Retrying…" with retries at exponential backoff starting at
 *    BOARD_CHECK_RETRY_BASE_MS and capped at RECONNECT_MAX_BACKOFF_MS;
 *  - once the board exists, the board UI is shown for the remainder of the
 *    visit (no re-checks while editing).
 */

type Phase = 'checking' | 'ready' | 'not_found' | 'unreachable';

export function BoardPage({ id }: { id: string }): ReactElement {
  const valid = isValidBoardId(id);
  const [phase, setPhase] = useState<Phase>(valid ? 'checking' : 'not_found');
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!isValidBoardId(id)) {
      setPhase('not_found');
      return;
    }
    let cancelled = false;
    let backoff = BOARD_CHECK_RETRY_BASE_MS;

    const runCheck = async (first: boolean): Promise<void> => {
      if (first) setPhase('checking');
      let res: Awaited<ReturnType<typeof checkBoard>>;
      try {
        res = await checkBoard(id);
      } catch {
        res = { kind: 'unreachable' };
      }
      if (cancelled) return;
      if (res.kind === 'exists') {
        backoff = BOARD_CHECK_RETRY_BASE_MS;
        setPhase('ready');
        return;
      }
      if (res.kind === 'not_found') {
        setPhase('not_found');
        return;
      }
      // Unreachable: keep the visit alive and retry with capped backoff.
      setPhase('unreachable');
      timerRef.current = setTimeout(() => {
        void runCheck(false);
      }, backoff);
      backoff = Math.min(backoff * 2, RECONNECT_MAX_BACKOFF_MS);
    };

    void runCheck(true);
    return () => {
      cancelled = true;
      if (timerRef.current !== undefined) clearTimeout(timerRef.current);
    };
  }, [id]);

  switch (phase) {
    case 'checking':
      return (
        <div data-testid="board-loading" role="status" style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
          Opening board…
        </div>
      );
    case 'unreachable':
      return (
        <div
          data-testid="board-unreachable"
          role="status"
          style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}
        >
          Couldn't reach vidi6. Retrying…
        </div>
      );
    case 'not_found':
      return <NotFoundPage />;
    case 'ready':
      return <Board id={id} />;
  }
}
