import { useEffect, useState } from 'react';
import { isValidBoardId } from '../../shared/board-id';
import { App } from '../App';
import { type CheckResponse, checkBoard } from '../api';
import { SharePanel } from '../share/SharePanel';
import { NotFoundPage } from './NotFoundPage';
import { type BoardPageState, nextBoardPageState, retryDelayMs } from './state';

/**
 * A board link: a malformed id is Board not found without asking the service; otherwise the
 * board's existence is checked (retrying while the service cannot be reached) before the
 * stories 1–4 board opens. Remount (key) per id.
 */
export function BoardPage(props: { id: string }) {
  const { id } = props;
  const valid = isValidBoardId(id);
  const [state, setState] = useState<BoardPageState>(
    valid ? { kind: 'checking' } : { kind: 'not_found' },
  );

  useEffect(() => {
    if (!valid) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    const check = async () => {
      attempt += 1;
      let result: CheckResponse;
      try {
        result = await checkBoard(id);
      } catch {
        result = { kind: 'unreachable' };
      }
      if (cancelled) return;
      setState((prev) => nextBoardPageState(prev, result, attempt, id));
      if (result.kind === 'unreachable') timer = setTimeout(check, retryDelayMs(attempt));
    };
    void check();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [id, valid]);

  switch (state.kind) {
    case 'not_found':
      return <NotFoundPage />;
    case 'checking':
      return (
        <main className="page">
          <p className="page-text" role="status">
            Opening board…
          </p>
        </main>
      );
    case 'unreachable':
      return (
        <main className="page">
          <p className="page-text" role="status">
            Couldn't reach vidi6. Retrying…
          </p>
        </main>
      );
    case 'ready':
      return (
        <>
          <App boardId={state.boardId} />
          <SharePanel boardId={state.boardId} />
        </>
      );
  }
}
