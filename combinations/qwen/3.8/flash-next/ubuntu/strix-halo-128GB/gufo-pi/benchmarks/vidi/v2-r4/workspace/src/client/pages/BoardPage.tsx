import { useState, useEffect, useCallback, useRef } from 'react';
import { checkBoard } from '../api';
import { isValidBoardId } from '../../shared/board-id';
import { BOARD_CHECK_RETRY_BASE_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';
import { App } from '../App';
import { SharePanel } from '../share/SharePanel';
import { NotFoundPage } from './NotFoundPage';

type BoardPageState =
  | { kind: 'not_found' }
  | { kind: 'checking' }
  | { kind: 'unreachable' }
  | { kind: 'ready'; boardId: string };

/**
 * Board page: checks board existence, then renders the board or an error state.
 */
export function BoardPage(props: { id: string }): React.JSX.Element {
  const [state, setState] = useState<BoardPageState>(() => {
    // Malformed id → not_found, no request
    if (!isValidBoardId(props.id)) {
      return { kind: 'not_found' };
    }
    return { kind: 'checking' };
  });

  const attemptRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doCheck = useCallback(async () => {
    if (!isValidBoardId(props.id)) {
      setState({ kind: 'not_found' });
      return;
    }
    const result = await checkBoard(props.id);
    if (result.kind === 'exists') {
      setState({ kind: 'ready', boardId: props.id });
    } else if (result.kind === 'not_found') {
      setState({ kind: 'not_found' });
    } else {
      // unreachable - schedule retry
      setState({ kind: 'unreachable' });
      const delay = Math.min(
        BOARD_CHECK_RETRY_BASE_MS * Math.pow(2, attemptRef.current),
        RECONNECT_MAX_BACKOFF_MS,
      );
      attemptRef.current++;
      timerRef.current = setTimeout(doCheck, delay);
    }
  }, [props.id]);

  useEffect(() => {
    if (state.kind === 'checking') {
      doCheck();
    }
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (state.kind === 'not_found') {
    return <NotFoundPage />;
  }

  if (state.kind === 'checking') {
    return <div className="board-page-loading"><p>Opening board…</p></div>;
  }

  if (state.kind === 'unreachable') {
    return <div className="board-page-loading"><p>Couldn&apos;t reach vidi6. Retrying…</p></div>;
  }

  // Ready: render the board with Share panel
  return (
    <div className="board-page">
      <App boardId={state.boardId} />
      <SharePanel boardId={state.boardId} />
    </div>
  );
}
