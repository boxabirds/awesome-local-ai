import type { ReactElement } from 'react';
import { useEffect, useRef, useState } from 'react';
import { isValidBoardId } from '../../shared/board-id';
import { checkBoard } from '../api';
import { Board } from '../Board';
import { NotFoundPage } from './NotFoundPage';
import { nextBoardPageState, type BoardPageState } from './state';

function CenterMessage(props: { text: string }): ReactElement {
  return (
    <main
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f3f5f8',
        color: '#555',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      {props.text}
    </main>
  );
}

/**
 * The board page (story 5): checks the board's existence before mounting the
 * board. A failing service is retried with a doubling delay (1s, 2s, 4s, ...
 * capped at 10s) without any reload; "not found" is terminal and shows the
 * board-not-found page.
 */
export function BoardPage(props: { id: string }): ReactElement {
  const [state, setState] = useState<BoardPageState>({ kind: 'checking' });
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    // A malformed id can never exist — no request is made for it
    // (share.not_found: "the client does not try to load such an id").
    if (!isValidBoardId(props.id)) {
      setState({ kind: 'not_found' });
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    const runCheck = () => {
      attempt += 1;
      void checkBoard(props.id).then((result) => {
        if (cancelled) return;
        const prev = stateRef.current;
        if (prev.kind === 'ready' || prev.kind === 'not_found') return; // terminal
        const next = nextBoardPageState(props.id, prev, result, attempt);
        setState(next);
        if (next.kind === 'unreachable') {
          timer = setTimeout(runCheck, next.nextRetryMs);
        }
      });
    };
    runCheck();
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [props.id]);

  if (state.kind === 'checking') {
    return <CenterMessage text="Opening board…" />;
  }
  if (state.kind === 'unreachable') {
    return <CenterMessage text="Couldn't reach vidi6. Retrying…" />;
  }
  if (state.kind === 'not_found') {
    return <NotFoundPage />;
  }
  return <Board boardId={state.boardId} />;
}
