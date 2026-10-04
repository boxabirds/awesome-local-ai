/**
 * Board page (story 5): checks the board exists (GET /api/boards/:id),
 * retrying with backoff while the service is unreachable, then mounts the
 * live board (stories 1–4) with the Share panel. Unknown or malformed ids
 * show Board not found without any request.
 */
import { useEffect, useState, type JSX } from 'react';
import { isValidBoardId } from '../../shared/board-id';
import { checkBoard } from '../api';
import { Board } from '../board/Board';
import { SharePanel } from '../share/SharePanel';
import { NotFoundPage } from './NotFoundPage';
import { nextBoardPageState, type BoardPageState } from './state';

const OPENING_TEXT = 'Opening board…';
const UNREACHABLE_TEXT = "Couldn't reach vidi6. Retrying…";

export function BoardPage(props: { id: string }): JSX.Element {
  const { id } = props;
  const [state, setState] = useState<BoardPageState>(() =>
    isValidBoardId(id) ? { kind: 'checking' } : { kind: 'not_found' },
  );

  useEffect(() => {
    if (!isValidBoardId(id)) {
      // Malformed ids never hit the API (share.bad_link: no request).
      setState({ kind: 'not_found' });
      return;
    }
    setState({ kind: 'checking' });
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const attempt = (n: number) => {
      void checkBoard(id).then((result) => {
        if (cancelled) return;
        const next = nextBoardPageState({ kind: 'checking' }, result, n, id);
        setState(next);
        if (next.kind === 'unreachable') {
          timer = setTimeout(() => attempt(next.attempt + 1), next.nextRetryMs);
        }
      });
    };
    attempt(1);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [id]);

  switch (state.kind) {
    case 'checking':
      return <p data-testid="board-opening" style={{ padding: 24 }}>{OPENING_TEXT}</p>;
    case 'unreachable':
      return (
        <p data-testid="board-unreachable" role="alert" style={{ padding: 24, color: '#5f6368' }}>
          {UNREACHABLE_TEXT}
        </p>
      );
    case 'not_found':
      return <NotFoundPage />;
    case 'ready':
      return (
        <>
          <Board boardId={state.boardId} />
          <SharePanel boardId={state.boardId} />
        </>
      );
  }
}
