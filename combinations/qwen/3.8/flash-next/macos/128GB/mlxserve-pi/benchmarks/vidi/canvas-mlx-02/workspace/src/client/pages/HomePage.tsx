// The page a visitor who has no link lands on. One button, one answer per press,
// and the only thing that leaves this page on success is the address of the board
// that was just made.
import { useCallback } from 'react';
import { useCreateBoard } from '../useCreateBoard.ts';
import { navigateTo } from '../useRoute.ts';
import { boardPath } from '../router.ts';
import { createBoardRequest, type CreateBoardResult } from '../api.ts';

export interface HomePageProps {
  /** Where a created board's address goes. Production changes the address bar. */
  onCreated?: (boardId: string) => void;
  /** How a board is asked for. Tests answer without a network. */
  createRequest?: () => Promise<CreateBoardResult>;
}

export function HomePage({ onCreated, createRequest }: HomePageProps) {
  const go = useCallback(
    (boardId: string) => {
      if (onCreated) onCreated(boardId);
      else navigateTo(boardPath(boardId));
    },
    [onCreated],
  );
  const state = useCreateBoard(go, createRequest ?? createBoardRequest);

  // A press while a creation is in flight is ignored, not queued: a visitor who
  // presses twice has asked for a board, not for two boards and not for a second
  // request that the server will refuse as a limited one.
  const onPress = useCallback(() => {
    if (!state.wants) return;
    state.create();
  }, [state]);

  return (
    <main className="page">
      <div className="page-card">
        <h1 className="page-title">vidi6</h1>
        <p className="page-lede">A shared board for thinking together</p>
        <button
          type="button"
          className="primary-button"
          data-testid="create-board"
          onClick={onPress}
        >
          {state.phase === 'creating' ? 'Creating…' : 'Create a board'}
        </button>
        <div className="page-slot" role="status" aria-live="polite" data-testid="create-slot">
          {state.message ? (
            <p className="page-message" role="alert" data-testid="create-message">
              {state.message}
            </p>
          ) : null}
        </div>
      </div>
    </main>
  );
}
