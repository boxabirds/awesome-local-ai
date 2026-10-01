import { useEffect, useState } from 'react';
import { isValidBoardId } from '../../shared/board-id';
import { checkBoard } from '../api';
import { App } from '../App';
import { SharePanel } from '../share/SharePanel';
import { NotFoundPage } from './NotFoundPage';
import { nextBoardPageState, type BoardPageState } from './state';
import { pageStyle } from './useCreateBoard';

/** Existence check (with retry while the service is unreachable), then the board itself. */
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
    let timer: ReturnType<typeof setTimeout> | null = null;
    const check = (attempt: number) => {
      void checkBoard(id).then((result) => {
        if (cancelled) return;
        const next = nextBoardPageState({ kind: 'checking' }, result, attempt);
        if (next.kind === 'ready') {
          setState({ kind: 'ready', boardId: id });
        } else {
          setState(next);
          if (next.kind === 'unreachable') timer = setTimeout(() => check(attempt + 1), next.nextRetryMs);
        }
      });
    };
    check(0);
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [id, valid]);

  if (state.kind === 'not_found') return <NotFoundPage />;
  if (state.kind === 'ready') {
    return (
      <>
        <App boardId={state.boardId} />
        <SharePanel boardId={state.boardId} />
      </>
    );
  }
  return (
    <main style={pageStyle}>
      <p role="status" style={{ margin: 0, font: '16px system-ui, sans-serif', color: '#455A64' }}>
        {state.kind === 'unreachable' ? "Couldn't reach vidi6. Retrying…" : 'Opening board…'}
      </p>
    </main>
  );
}
