import { useEffect, useState } from 'react';
import { isValidBoardId } from '../../shared/board-id';
import { checkBoard } from '../api';
import { App } from '../App';
import { SharePanel } from '../share/SharePanel';
import { NotFoundPage } from './NotFoundPage';
import { nextBoardPageState } from './state';
import type { BoardPageState } from './state';

export function BoardPage({ id }: { id: string }) {
  const valid = isValidBoardId(id);
  const [state, setState] = useState<BoardPageState>(valid ? { kind: 'checking' } : { kind: 'not_found' });

  useEffect(() => {
    if (!valid) {
      setState({ kind: 'not_found' });
      return;
    }
    setState({ kind: 'checking' });
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async (attempt: number) => {
      const result = await checkBoard(id);
      if (cancelled) return;
      const next = nextBoardPageState({ kind: 'checking' }, result, attempt, id);
      setState(next);
      if (next.kind === 'unreachable') timer = setTimeout(() => void check(attempt + 1), next.nextRetryMs);
    };
    void check(1);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [id, valid]);

  switch (state.kind) {
    case 'not_found':
      return <NotFoundPage />;
    case 'ready':
      return (
        <>
          <App boardId={state.boardId} />
          <SharePanel boardId={state.boardId} />
        </>
      );
    case 'unreachable':
      return (
        <main className="page">
          <p role="status">Couldn't reach vidi6. Retrying…</p>
        </main>
      );
    case 'checking':
      return (
        <main className="page">
          <p role="status">Opening board…</p>
        </main>
      );
  }
}
