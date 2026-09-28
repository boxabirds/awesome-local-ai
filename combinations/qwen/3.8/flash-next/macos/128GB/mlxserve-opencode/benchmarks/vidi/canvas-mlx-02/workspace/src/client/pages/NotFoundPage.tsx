// The page for a link that is nobody's board. It cannot join anything, cannot
// retry its way into a board, and it does not pretend the code might turn up: the
// way forward it offers is a board of this visitor's own, made by the same action
// the start page offers (PRD share.not_found).
import { useCallback } from 'react';
import { useCreateBoard } from '../useCreateBoard.ts';
import { navigateTo } from '../useRoute.ts';
import { boardPath } from '../router.ts';
import { createBoardRequest, type CreateBoardResult } from '../api.ts';

export interface NotFoundPageProps {
  /** How a board is asked for. Tests answer without a network. */
  createRequest?: () => Promise<CreateBoardResult>;
}

export function NotFoundPage({ createRequest }: NotFoundPageProps) {
  const go = useCallback(
    (boardId: string) => navigateTo(boardPath(boardId)),
    [],
  );
  const state = useCreateBoard(go, createRequest ?? createBoardRequest);

  // The same rule as on the start page: a press while a board is being made is
  // ignored, not turned into a second board or a refusal that would be shown as
  // this page's own complaint.
  const onPress = useCallback(() => {
    if (!state.wants) return;
    state.create();
  }, [state]);

  return (
    <main className="page" data-testid="not-found-page">
      <div className="page-card">
        <h1 className="page-title" data-testid="not-found-title">
          Board not found
        </h1>
        <p className="page-lede" data-testid="not-found-message">
          Check the link, or ask the person who shared it to send it again.
        </p>
        <button
          type="button"
          className="primary-button"
          data-testid="create-board"
          onClick={onPress}
        >
          {state.phase === 'creating' ? 'Creating…' : 'Create a new board'}
        </button>
        <div className="page-slot" role="status" aria-live="polite" data-testid="create-slot">
          {state.message ? (
            <p className="page-message" role="alert" data-testid="create-message">
              {state.message}
            </p>
          ) : null}
        </div>
        <a className="page-link" href="/" data-testid="home-link">
          Back to the home page
        </a>
      </div>
    </main>
  );
}
