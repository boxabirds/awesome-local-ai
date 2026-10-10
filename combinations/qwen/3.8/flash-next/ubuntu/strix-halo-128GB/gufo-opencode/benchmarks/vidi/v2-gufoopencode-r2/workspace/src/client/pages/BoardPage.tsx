// Story 5 (share.pages): opens a board from its link id. Malformed ids are
// "not found" without a request; valid ids go through checkBoard, with
// exponential backoff retries while the service is unreachable, and mount
// the stories 1–4 board (its WebSocket included) only once it exists.

import { useEffect, useRef, useState } from 'react';
import { checkBoard } from '../api';
import { isValidBoardId } from '../../shared/board-id';
import { BoardScreen } from './BoardScreen';
import { NotFoundPage } from './NotFoundPage';
import { SharePanel } from '../share/SharePanel';
import { UNREACHABLE_MESSAGE, nextBoardPageState, type BoardPageState } from './state';

export function BoardPage({ id }: { id: string }) {
  const [state, setState] = useState<BoardPageState>(() =>
    isValidBoardId(id) ? { kind: 'checking' } : { kind: 'not_found' },
  );
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    if (!isValidBoardId(id)) return; // malformed: not_found, no request sent
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const runCheck = (attempt: number) => {
      void checkBoard(id).then((result) => {
        if (cancelled) return;
        const next = nextBoardPageState(stateRef.current, result, attempt, id);
        setState(next);
        if (next.kind === 'unreachable') {
          timer = setTimeout(() => runCheck(next.attempt), next.nextRetryMs);
        }
      });
    };
    runCheck(0);

    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [id]);

  if (state.kind === 'ready') {
    return (
      <>
        <BoardScreen boardId={id} />
        <SharePanel boardId={id} />
      </>
    );
  }
  if (state.kind === 'not_found') return <NotFoundPage />;
  if (state.kind === 'unreachable') {
    return (
      <main className="page">
        <p role="status">{UNREACHABLE_MESSAGE}</p>
      </main>
    );
  }
  return (
    <main className="page">
      <p role="status">Opening board&#8230;</p>
    </main>
  );
}
