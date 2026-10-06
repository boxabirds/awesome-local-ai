/**
 * Board page (`share.board_page`, `share.not_found`, `share.unreachable`).
 *
 * Opening a link is a question before it is a board: *does this board exist?*
 * This page asks `GET /api/boards/:id`, and what it renders depends only on the
 * answer's phase — board content, the Share button and the WebSocket connection
 * all appear in the `board` phase and nowhere else. That is what makes
 * `share.not_found` testable as a negative: an unknown link never reaches the
 * code that could open a connection.
 *
 * An answer that could not be got is not treated as "does not exist". The page
 * says it could not reach vidi6 and asks again with the same exponential backoff
 * the reconnect logic uses (`BOARD_CHECK_RETRY_BASE_MS` doubling to
 * `RECONNECT_MAX_BACKOFF_MS`), because being wrong about existence would tell a
 * person their board is gone.
 *
 * The transitions themselves live in `state.ts` — this component calls
 * `nextBoardPageState` and renders what the phase says.
 */

import { useCallback, useEffect, useState } from "react";
import { checkBoard, type BoardCheckOutcome } from "../api";
import { App } from "../App";
import { boardPath } from "../routing";
import type { CreateBoardFn } from "../api";
import { initialBoardPageState, nextBoardPageState, type BoardPageEvent, type BoardPageState } from "./state";
import { NotFoundPage } from "./NotFoundPage";

export interface BoardPageProps {
  boardId: string;
  /** Passed through to the Board-not-found page's "New board" button. */
  navigate?: (pathname: string, options?: { replace?: boolean }) => void;
  /** Injectable existence check: component tests stub this instead of fetch. */
  check?: (boardId: string, options: { signal: AbortSignal }) => Promise<BoardCheckOutcome>;
  /** Passed through to the Board-not-found page's "New board" button. */
  create?: CreateBoardFn;
}

export function BoardPage({ boardId, navigate, check = checkBoard, create }: BoardPageProps) {
  const [state, setState] = useState<BoardPageState>(() => initialBoardPageState(boardId));

  const dispatch = useCallback((event: BoardPageEvent) => {
    setState((current) => nextBoardPageState(current, event));
  }, []);

  // Re-opening a different link at the same mounted page starts over; a page is
  // never left showing one board's answer while displaying another's content.
  useEffect(() => {
    setState(initialBoardPageState(boardId));
  }, [boardId]);

  // The ask. Aborted on cleanup so an unmount or a re-open cannot land an answer
  // on a page that stopped caring.
  useEffect(() => {
    if (state.phase !== "checking") return;

    const controller = new AbortController();
    let stale = false;

    void (async () => {
      // A check that throws is the same to the person as one that answers
      // "unreachable": the request never got an answer, and the board stays
      // unseen either way.
      let outcome: BoardCheckOutcome;
      try {
        outcome = await check(state.boardId, { signal: controller.signal });
      } catch {
        outcome = "unreachable";
      }
      if (stale) return;
      if (outcome === "unreachable") dispatch({ type: "check-failed" });
      else dispatch({ type: "checked", outcome });
    })();

    return () => {
      stale = true;
      controller.abort();
    };
  }, [check, dispatch, state.boardId, state.phase]);

  // The retry, driven by the delay the state machine chose. No timer is left
  // running when the page stops being unreachable.
  useEffect(() => {
    if (state.phase !== "unreachable") return;
    const timer = setTimeout(() => dispatch({ type: "recheck" }), state.retryDelayMs);
    return () => clearTimeout(timer);
  }, [dispatch, state.phase, state.retryDelayMs]);

  if (state.phase === "board") return <App boardId={state.boardId} />;

  if (state.phase === "not_found") {
    return (
      <NotFoundPage
        pathname={boardPath(state.boardId)}
        navigate={navigate}
        create={create}
      />
    );
  }

  const unreachable = state.phase === "unreachable";
  return (
    <main
      className="page page-board-status"
      data-testid="board-page"
      data-board-status={unreachable ? "unreachable" : "checking"}
    >
      <p role="status">
        {unreachable ? "Couldn\u2019t reach vidi6. Retrying\u2026" : "Opening board\u2026"}
      </p>
    </main>
  );
}
