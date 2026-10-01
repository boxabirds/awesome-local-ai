import { useEffect, useRef, useState, type JSX } from 'react';
import { isValidBoardId } from '../../shared/board-id';
import { checkBoard } from '../api';
import { Board, type BoardProps } from '../board/Board';
import { SharePanel } from '../share/SharePanel';
import { NotFoundPage } from './NotFoundPage';
import {
  nextBoardPageState,
  OPENING_BOARD_MESSAGE,
  UNREACHABLE_MESSAGE,
  type BoardPageState,
} from './state';

export interface BoardPageProps extends BoardProps {
  /** The board this address names, already taken from `/b/<id>`. */
  id: string;
}

/**
 * The board page (share.open_link, share.not_found, share.unreachable).
 *
 * It opens a board by first asking whether it exists, and only mounts the live
 * board (the stories 1–4 UI, with its room connection) once the answer is yes.
 * The order matters twice over: a malformed address is answered with "Board not
 * found" without a request ever being sent (so a bad link never probes the
 * service), and an address that reaches the service but cannot be *reached* at it
 * shows "Couldn't reach vidi6. Retrying…" and retries on a capped backoff rather
 * than telling the person their board is gone when only the service is down.
 */
export function BoardPage(props: BoardPageProps): JSX.Element {
  const { id, ...boardProps } = props;
  // A malformed id is not-found before anything else, with no request sent.
  const valid = isValidBoardId(id);
  const [state, setState] = useState<BoardPageState>(() =>
    valid ? { kind: 'checking' } : { kind: 'not_found' },
  );
  const stateRef = useRef<BoardPageState>(state);
  stateRef.current = state;

  useEffect(() => {
    if (!valid) {
      setState({ kind: 'not_found' });
      return;
    }
    setState({ kind: 'checking' });

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;

    const run = async (): Promise<void> => {
      const result = await checkBoard(id);
      if (cancelled) return;
      const next = nextBoardPageState(stateRef.current, result, attempt);
      if (next.kind === 'ready') {
        setState({ kind: 'ready', boardId: id });
        return;
      }
      if (next.kind === 'not_found') {
        setState({ kind: 'not_found' });
        return;
      }
      if (next.kind === 'unreachable') {
        // Show the message and retry on the backoff, without a reload.
        attempt += 1;
        setState(next);
        timer = setTimeout(() => {
          void run();
        }, next.nextRetryMs);
      }
    };

    void run();
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [id, valid]);

  switch (state.kind) {
    case 'checking':
      return (
        <div className="board-status" role="status">
          {OPENING_BOARD_MESSAGE}
        </div>
      );
    case 'unreachable':
      return (
        <div className="board-status" role="status">
          {UNREACHABLE_MESSAGE}
        </div>
      );
    case 'not_found':
      return <NotFoundPage />;
    case 'ready':
      // The board is open for full editing with no sign-in step (share.open_link);
      // Share sits on top-right so the link can be handed to anyone.
      return (
        <>
          <Board {...boardProps} boardId={id} />
          <SharePanel boardId={id} />
        </>
      );
  }
}
