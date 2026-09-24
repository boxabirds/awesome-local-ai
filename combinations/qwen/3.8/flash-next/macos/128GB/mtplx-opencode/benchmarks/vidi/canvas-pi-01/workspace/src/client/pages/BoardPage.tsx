/**
 * Story 5 · the board page (design "Home, board and not-found pages").
 *
 * A board address is *checked* before anything is mounted. That single change
 * is what the story is about: before it, every address — right or wrong —
 * produced a live, editable board, so a truncated link looked like a board
 * whose contents had been deleted.
 *
 * Four states, matching the design's BoardPage diagram:
 *  - an id that is not a well-formed board id goes straight to "Board not
 *    found" with **no request** (PRD share.not_found: nothing is created or
 *    probed at a mistyped address, and the Worker would only answer 404);
 *  - `checking` shows "Opening board…";
 *  - `unreachable` shows "Couldn't reach vidi6. Retrying…" and keeps asking
 *    with exponential backoff (PRD share.unreachable);
 *  - `ready` mounts the stories 1–4 board and connects it.
 *
 * The board is mounted only in `ready`, and `App` keys the page on the id, so
 * one board's document, provider and selection never leak into another (PRD
 * live.isolation, unchanged from story 3).
 */
import { useRef } from 'react';
import { BoardShell } from '../board/BoardShell';
import { SharePanel } from '../share/SharePanel';
import { useViewportSize } from '../canvas/useCamera';
import { isBoardId } from '../../shared/board-id';
import { checkBoard, type CheckResponse } from '../api';
import { NotFoundPage } from './NotFoundPage';
import { useBoardCheck } from './useBoardCheck';

export const OPENING_MESSAGE = 'Opening board…';
export const UNREACHABLE_MESSAGE = "Couldn't reach vidi6. Retrying…";

export interface BoardPageProps {
  id: string;
  /** Test seam: the existence check (defaults to `api.checkBoard`). */
  check?: (id: string) => Promise<CheckResponse>;
}

export function BoardPage({ id, check = checkBoard }: BoardPageProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const viewport = useViewportSize(stageRef);
  // A malformed id never reaches the network: `enabled` is false, so the check
  // hook never runs (TC-19 asserts no request is made).
  const wellFormed = isBoardId(id);
  const { state } = useBoardCheck(id, wellFormed, check);

  if (!wellFormed || state === 'not_found') {
    return <NotFoundPage />;
  }

  if (state === 'checking' || state === 'unreachable') {
    const message = state === 'checking' ? OPENING_MESSAGE : UNREACHABLE_MESSAGE;
    return (
      <div className="page-stack" data-testid="board-loading">
        <p role="status" aria-live="polite" data-testid="board-loading-message">
          {message}
        </p>
      </div>
    );
  }

  return (
    <div ref={stageRef} className="board-stage" data-testid="board-stage">
      {/* `key` remounts per board: a fresh document, provider and selection. */}
      <BoardShell key={id} viewport={viewport} boardId={id} />
      <div className="board-top-right" data-testid="share-slot">
        <SharePanel boardId={id} />
      </div>
    </div>
  );
}
