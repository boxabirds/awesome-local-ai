import { useEffect, useRef, useState, type ReactElement } from 'react';
import { isValidBoardId } from '@shared/board-id';
import { checkBoard } from '@client/api';
import { nextBoardPageState, type BoardPageState } from './state';
import { NotFoundPage } from './NotFoundPage';
import { Board } from '@client/App';
import { SharePanel } from '@client/share/SharePanel';

/**
 * Board page (share.open_link, share.not_found, share.unreachable). A malformed
 * id shows Board not found with no request; a valid id shows "Opening board…"
 * while checking. `exists` mounts the stories 1–4 board with a Share panel;
 * `not_found` shows the not-found page; `unreachable` retries with exponential
 * backoff from BOARD_CHECK_RETRY_BASE_MS (capped at RECONNECT_MAX_BACKOFF_MS)
 * and opens the board when the service recovers, without a reload.
 */
export function BoardPage({ id }: { id: string }): ReactElement {
  const valid = isValidBoardId(id);
  const [state, setState] = useState<BoardPageState>(
    valid ? { kind: 'checking' } : { kind: 'not_found' },
  );
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);

  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (!isValidBoardId(id)) {
      setState({ kind: 'not_found' });
      return;
    }

    let cancelled = false;
    attemptRef.current = 0;
    setState({ kind: 'checking' });

    const runCheck = async (): Promise<void> => {
      const result = await checkBoard(id);
      if (cancelled) return;
      if (result.kind === 'exists') {
        setState({ kind: 'ready', boardId: id });
        return;
      }
      if (result.kind === 'not_found') {
        setState({ kind: 'not_found' });
        return;
      }
      // Unreachable: schedule a retry with exponential backoff.
      attemptRef.current += 1;
      const next = nextBoardPageState(
        { kind: 'unreachable', attempt: 0, nextRetryMs: 0 },
        { kind: 'unreachable' },
        attemptRef.current,
        id,
      );
      setState(next);
      if (next.kind === 'unreachable') {
        timerRef.current = setTimeout(() => {
          void runCheck();
        }, next.nextRetryMs);
      }
    };

    void runCheck();

    return () => {
      cancelled = true;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [id]);

  if (state.kind === 'not_found') return <NotFoundPage />;
  if (state.kind === 'unreachable') {
    return (
      <main className="board-loading">
        <p role="status">Couldn't reach vidi6. Retrying…</p>
      </main>
    );
  }
  if (state.kind !== 'ready') {
    return (
      <main className="board-loading">
        <p role="status">Opening board…</p>
      </main>
    );
  }

  return (
    <div className="vidi6-app">
      <Board boardId={state.boardId} />
      <SharePanel boardId={state.boardId} />
    </div>
  );
}
