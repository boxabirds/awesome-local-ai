import { useEffect, useState } from 'react';
import { isValidBoardId } from '../../shared/board-id';
import { checkBoard } from '../api';
import { ConnectedBoard } from '../board/BoardApp';
import { SharePanel } from '../share/SharePanel';
import { NotFoundPage } from './NotFoundPage';
import { nextBoardPageState, type BoardPageState } from './state';

export function BoardPage({ id }: { id: string }) {
  const valid = isValidBoardId(id);
  const [state, setState] = useState<BoardPageState>({ kind: valid ? 'checking' : 'not_found' });

  useEffect(() => {
    if (!valid) { setState({ kind: 'not_found' }); return; }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setState({ kind: 'checking' });
    const check = (attempt: number) => {
      void checkBoard(id).then((result) => {
        if (cancelled) return;
        const next = nextBoardPageState({ kind: 'checking' }, result, attempt);
        setState(next.kind === 'ready' ? { kind: 'ready', boardId: id } : next);
        if (next.kind === 'unreachable') timer = setTimeout(() => check(attempt + 1), next.nextRetryMs);
      });
    };
    check(1);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [id, valid]);

  switch (state.kind) {
    case 'ready':
      return (
        <>
          <ConnectedBoard boardId={state.boardId} />
          <SharePanel boardId={state.boardId} />
        </>
      );
    case 'not_found':
      return <NotFoundPage />;
    case 'unreachable':
      return <main className="page"><p role="status">Couldn't reach vidi6. Retrying…</p></main>;
    default:
      return <main className="page"><p role="status">Opening board…</p></main>;
  }
}
