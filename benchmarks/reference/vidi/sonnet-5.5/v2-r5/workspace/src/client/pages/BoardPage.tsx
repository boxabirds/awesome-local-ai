import { useEffect, useState } from 'react';
import { isValidBoardId } from '../../shared/board-id';
import { checkBoard } from '../api';
import { Board } from '../board/Board';
import { SharePanel } from '../share/SharePanel';
import { NotFoundPage } from './NotFoundPage';
import { nextBoardPageState, type BoardPageState } from './state';

export function BoardPage({ id }: { id: string }) {
  const valid = isValidBoardId(id);
  const [state, setState] = useState<BoardPageState>({ kind: 'checking' });

  useEffect(() => {
    setState({ kind: 'checking' });
    if (!valid) return undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async (attempt: number) => {
      const result = await checkBoard(id);
      if (cancelled) return;
      const next = nextBoardPageState({ kind: 'checking' }, result, attempt, id);
      setState(next);
      if (next.kind === 'unreachable') timer = setTimeout(() => { void check(attempt + 1); }, next.nextRetryMs);
    };
    void check(1);
    return () => { cancelled = true; if (timer !== undefined) clearTimeout(timer); };
  }, [id, valid]);

  if (!valid || state.kind === 'not_found') return <NotFoundPage />;
  if (state.kind === 'ready') {
    return (
      <>
        <Board key={id} boardId={id} />
        <SharePanel boardId={id} />
      </>
    );
  }
  return (
    <main className="page">
      <p role="status">{state.kind === 'unreachable' ? "Couldn't reach vidi6. Retrying…" : 'Opening board…'}</p>
    </main>
  );
}
