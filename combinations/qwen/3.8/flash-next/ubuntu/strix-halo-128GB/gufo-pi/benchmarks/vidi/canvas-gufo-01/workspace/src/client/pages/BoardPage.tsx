// Board page: validates the link code, asks the service whether the board
// exists, then mounts the board (and only then opens its room socket).
// States: Checking -> Ready | NotFound | Unreachable (retrying with exponential
// backoff). A malformed code never produces a request.

import { useEffect, useState } from 'react';
import { checkBoard, type CheckResponse } from '../api';
import { isValidBoardId } from '../../shared/board-id';
import { BOARD_CHECK_RETRY_BASE_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';
import { BoardWorkspace } from '../board/BoardWorkspace';
import { NotFoundPage } from './NotFoundPage';

export type BoardPagePhase = 'checking' | 'ready' | 'not_found' | 'unreachable';

export function BoardPage({ id }: { id: string }) {
  const valid = isValidBoardId(id);
  const [phase, setPhase] = useState<BoardPagePhase>(valid ? 'checking' : 'not_found');

  useEffect(() => {
    if (!valid) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;

    const run = async (): Promise<void> => {
      let result: CheckResponse;
      try {
        result = await checkBoard(id);
      } catch {
        result = { status: 'unreachable' };
      }
      if (cancelled) return;
      if (result.status === 'exists') {
        setPhase('ready');
        return;
      }
      if (result.status === 'not_found') {
        setPhase('not_found');
        return;
      }
      setPhase('unreachable');
      const delay = Math.min(BOARD_CHECK_RETRY_BASE_MS * 2 ** attempt, RECONNECT_MAX_BACKOFF_MS);
      attempt += 1;
      timer = setTimeout(() => void run(), delay);
    };

    void run();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [id, valid]);

  if (phase === 'checking') {
    return (
      <main className="page board-checking">
        <p role="status">Opening board…</p>
      </main>
    );
  }
  if (phase === 'not_found') return <NotFoundPage />;
  if (phase === 'unreachable') {
    return (
      <main className="page board-unreachable">
        <p role="status">{"Couldn't reach vidi6. Retrying…"}</p>
      </main>
    );
  }
  return <BoardWorkspace boardId={id} />;
}
