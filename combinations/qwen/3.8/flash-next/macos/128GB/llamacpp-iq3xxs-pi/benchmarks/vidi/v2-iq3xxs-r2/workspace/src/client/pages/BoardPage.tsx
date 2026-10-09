import { useEffect, useReducer, type JSX } from 'react';
import { isValidBoardId } from '../../shared/board-id';
import { checkBoard } from '../api';
import { Board } from '../board/Board';
import { SharePanel } from '../share/SharePanel';
import { NotFoundPage } from './NotFoundPage';
import {
  boardCheckDelayMs,
  boardPageWaitingMessage,
  initialBoardPageState,
  nextBoardPageState,
} from './state';

/**
 * A board link (`/b/:id`), from the moment it is opened to the moment the board is on
 * screen — the sequence diagram of story 5, in one component.
 *
 * Three things can come back from asking whether this board exists, and they are not
 * interchangeable: it does (`ready`, and the story 1–4 board mounts), it does not
 * (`not_found`, and the Board not found page — with nothing created here, which is the
 * point of `share.not_found`), or nothing answered (`unreachable`, `share.unreachable`).
 * The third is the only one that keeps asking: a link opened while the service is having
 * a bad minute should open the board when the minute ends, without the person reloading
 * and without them being told the board is gone when nobody knows that yet.
 *
 * An id that cannot be a board never asks at all (TC-19): `not_found` is already the
 * answer, and the server would only agree.
 */
export function BoardPage({ boardId }: { boardId: string }): JSX.Element {
  const [state, dispatch] = useReducer(
    nextBoardPageState,
    boardId,
    initialBoardPageState,
  );

  useEffect(() => {
    if (!isValidBoardId(boardId)) return; // no request sent, and none will be
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();

    const check = async (retry: number): Promise<void> => {
      if (retry > 0) dispatch({ type: 'check-started' }); // keeps the retry message up
      const result = await checkBoard(boardId, controller.signal);
      if (cancelled) return;
      dispatch({ type: 'check-result', result });
      if (result === 'unreachable') {
        timer = setTimeout(() => void check(retry + 1), boardCheckDelayMs(retry));
      }
    };
    void check(0);

    return (): void => {
      // Navigating away, or a different board at the same address: no timer outlives the
      // page that started it, and no late answer lands on a page that is gone.
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
      controller.abort();
    };
  }, [boardId]);

  if (state.stage === 'not_found') return <NotFoundPage />;

  if (state.stage !== 'ready') {
    return (
      <main className="vidi6-page" data-testid="board-page" data-stage={state.stage}>
        <p
          className="vidi6-tagline"
          data-testid="board-status"
          role="status"
          aria-live="polite"
        >
          {boardPageWaitingMessage(state)}
        </p>
      </main>
    );
  }

  // The board, plus the one thing story 5 adds to it: the Share button and its panel.
  // They belong to the page rather than to the toolbar, because they are about this
  // board's address and not about the tools used on it.
  return (
    <>
      <Board boardId={boardId} />
      <SharePanel boardId={boardId} />
    </>
  );
}
