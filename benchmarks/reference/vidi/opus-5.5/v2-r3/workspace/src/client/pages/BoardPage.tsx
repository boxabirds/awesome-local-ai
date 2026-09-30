// Board page (share.open_link): check the link, then open the board, show Board
// not found, or keep retrying while the service cannot be reached.
import { useEffect, useState } from 'react';
import { isValidBoardId } from '../../shared/board-id';
import { checkBoard, type CheckResponse } from '../api';
import { Board } from '../board/Board';
import { SharePanel } from '../share/SharePanel';
import { NotFoundPage } from './NotFoundPage';
import { nextBoardPageState, type BoardPageState } from './state';

export function BoardPage({ id }: { id: string }) {
  const valid = isValidBoardId(id);
  const [state, setState] = useState<BoardPageState>(valid ? { kind: 'checking' } : { kind: 'not_found' });

  useEffect(() => {
    // Malformed ids never cause a request.
    if (!valid) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let current: BoardPageState = { kind: 'checking' };
    let attempt = 0;
    const check = async () => {
      attempt++;
      let result: CheckResponse;
      try {
        result = await checkBoard(id);
      } catch {
        result = { kind: 'unreachable' };
      }
      if (cancelled) return;
      current = nextBoardPageState(current, result, attempt, id);
      setState(current);
      if (current.kind === 'unreachable') timer = setTimeout(() => void check(), current.nextRetryMs);
    };
    void check();
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [id, valid]);

  switch (state.kind) {
    case 'not_found':
      return <NotFoundPage />;
    case 'ready':
      return (
        <Board boardId={state.boardId}>
          <SharePanel boardId={state.boardId} />
        </Board>
      );
    case 'checking':
    case 'unreachable':
      return (
        <main className="page board-loading-page">
          <p className="page-lead" role="status">
            {state.kind === 'checking' ? 'Opening board…' : "Couldn't reach vidi6. Retrying…"}
          </p>
        </main>
      );
  }
}
