import { useEffect, useState } from 'react';
import { isValidBoardId } from '../../shared/board-id';
import { App } from '../App';
import { checkBoard } from '../api';
import { SharePanel } from '../share/SharePanel';
import { NotFoundPage } from './NotFoundPage';
import { type BoardPageState, nextBoardPageState } from './state';

/**
 * Checks that the board exists before opening it (share.open_link): malformed ids
 * are not found without a request; while the service is unreachable the check is
 * retried with backoff until the board opens or turns out not to exist.
 */
export function BoardPage(props: { id: string }): React.JSX.Element {
  const { id } = props;
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
    let current: BoardPageState = { kind: 'checking' };
    const check = (attempt: number) => {
      void checkBoard(id).then((result) => {
        if (cancelled) return;
        current = nextBoardPageState(current, result, attempt, id);
        setState(current);
        if (current.kind === 'unreachable') timer = setTimeout(() => check(attempt + 1), current.nextRetryMs);
      });
    };
    check(1);
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
          <App key={state.boardId} boardId={state.boardId} />
          <SharePanel boardId={state.boardId} />
        </>
      );
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
  }
}
