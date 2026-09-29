import { useEffect, useRef, useState } from 'react';
import { checkBoard } from '../api';
import { isValidBoardId } from '@shared/board-id';
import { Board } from '../Board';
import { SharePanel } from '../share/SharePanel';
import { NotFoundPage } from './NotFoundPage';
import { nextBoardPageState, type BoardPageState } from './state';

/**
 * Board page (share.pages): checks the board link before opening it.
 *
 * - malformed id → Board not found (no request is sent)
 * - "Opening board…" while checking
 * - exists → the stories 1–4 board, editable immediately, no sign-in
 * - not_found → Board not found
 * - unreachable → "Couldn't reach vidi6. Retrying…" with automatic backoff
 *   retries until the board opens or is found to be missing (no reload)
 */
export function BoardPage(props: { id: string }) {
  const { id } = props;
  const [state, setState] = useState<BoardPageState>(() =>
    isValidBoardId(id) ? { kind: 'checking' } : { kind: 'not_found' },
  );
  const stateRef = useRef(state);
  stateRef.current = state;
  const attemptRef = useRef(0);
  const cancelledRef = useRef(false);

  const doCheck = () => {
    attemptRef.current += 1;
    const attempt = attemptRef.current;
    checkBoard(id).then((result) => {
      if (cancelledRef.current) return;
      const next = nextBoardPageState(stateRef.current, result, attempt);
      // The pure transition cannot recover the id from an `unreachable`
      // state, so the page (which owns the id) supplies it on recovery.
      setState(next.kind === 'ready' && next.boardId === '' ? { kind: 'ready', boardId: id } : next);
    });
  };

  // Initial existence check (only for well-formed ids).
  useEffect(() => {
    cancelledRef.current = false;
    if (!isValidBoardId(id)) return;
    doCheck();
    return () => {
      cancelledRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Retry timer while unreachable; cleared on unmount and on state change.
  useEffect(() => {
    if (state.kind !== 'unreachable') return;
    const timer = setTimeout(doCheck, state.nextRetryMs);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  if (state.kind === 'not_found') {
    return <NotFoundPage />;
  }

  if (state.kind === 'checking') {
    return (
      <CenteredMessage data-testid="opening-board">Opening board…</CenteredMessage>
    );
  }

  if (state.kind === 'unreachable') {
    return (
      <CenteredMessage data-testid="unreachable" aria-live="polite">
        Couldn't reach vidi6. Retrying…
      </CenteredMessage>
    );
  }

  // ready
  return (
    <>
      <Board boardId={state.boardId} />
      <SharePanel boardId={state.boardId} />
    </>
  );
}

function CenteredMessage(props: { 'data-testid': string; 'aria-live'?: 'off' | 'polite' | 'assertive'; children: string }) {
  return (
    <div
      data-testid={props['data-testid']}
      aria-live={props['aria-live']}
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#111',
        color: '#fff',
        fontFamily: 'system-ui, sans-serif',
        fontSize: 16,
      }}
    >
      {props.children}
    </div>
  );
}