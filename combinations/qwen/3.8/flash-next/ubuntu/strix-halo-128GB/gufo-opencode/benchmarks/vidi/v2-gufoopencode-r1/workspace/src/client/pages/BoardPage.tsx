import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { isValidBoardId } from '../../shared/board-id';
import { checkBoard } from '../api';
import { SharePanel } from '../share/SharePanel';
import { BoardShell } from './BoardShell';
import { NotFoundPage } from './NotFoundPage';
import { nextBoardPageState, type BoardPageState } from './state';

// share.open_link / not_found / unreachable. A malformed id never reaches the
// network (immediate not_found). A valid id is checked; while the service is
// unreachable the page retries with exponential backoff (attempt 0 waits
// BOARD_CHECK_RETRY_BASE_MS, doubling up to RECONNECT_MAX_BACKOFF_MS) and
// resolves to ready or not_found without a reload.
export function BoardPage(props: { id: string }): JSX.Element {
  const [state, setState] = useState<BoardPageState>(() =>
    isValidBoardId(props.id) ? { kind: 'checking' } : { kind: 'not_found' }
  );

  useEffect(() => {
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    function step(prev: BoardPageState, attempt: number): void {
      void checkBoard(props.id).then((result) => {
        if (cancelled) return;
        const next = nextBoardPageState(prev, result, attempt);
        if (next.kind === 'ready') {
          setState({ kind: 'ready', boardId: props.id });
          return;
        }
        setState(next);
        if (next.kind === 'unreachable') {
          const retry = setTimeout(() => step(next, attempt + 1), next.nextRetryMs);
          timers.push(retry);
        }
      });
    }

    if (!isValidBoardId(props.id)) {
      setState({ kind: 'not_found' });
      return;
    }
    setState({ kind: 'checking' });
    step({ kind: 'checking' }, 0);
    return () => {
      cancelled = true;
      for (const timer of timers) clearTimeout(timer);
    };
  }, [props.id]);

  if (state.kind === 'ready') {
    return (
      <>
        <SharePanel boardId={state.boardId} />
        <BoardShell boardId={state.boardId} />
      </>
    );
  }
  if (state.kind === 'not_found') return <NotFoundPage />;
  if (state.kind === 'unreachable') return <CenteredMessage text="Couldn't reach vidi6. Retrying…" />;
  return <CenteredMessage text="Opening board…" />;
}

function CenteredMessage(props: { text: string }): JSX.Element {
  return (
    <main
      role="status"
      style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        font: '500 16px system-ui, sans-serif',
        color: '#4b5563'
      }}
    >
      {props.text}
    </main>
  );
}
