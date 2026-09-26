// Story 5: board-not-found page (share.pages): shown for unknown or invalid
// board ids. The Create a new board button reuses the home page's create
// action; nothing is created at the mistyped address.

import type { JSX } from 'react';
import { navigate } from '../router';
import { CREATE_FAILED_MESSAGE, RATE_LIMITED_MESSAGE } from './HomePage';
import { useCreateBoard } from './useCreateBoard';

export function NotFoundPage(): JSX.Element {
  const { state, create } = useCreateBoard();
  const creating = state.status === 'creating';
  const message =
    state.status === 'create_failed'
      ? CREATE_FAILED_MESSAGE
      : state.status === 'rate_limited'
        ? RATE_LIMITED_MESSAGE
        : null;

  return (
    <div className="page page--center">
      <h1 className="page-title">Board not found</h1>
      <p className="page-subtitle">
        Check the link, or ask the person who shared it to send it again.
      </p>
      <div className="page-actions">
        <button
          type="button"
          className="btn btn--primary create-button"
          onClick={create}
          disabled={creating}
        >
          {creating ? 'Creating…' : 'Create a new board'}
        </button>
        <button type="button" className="btn" onClick={() => navigate('/')}>
          Go to the home page
        </button>
      </div>
      {message !== null && (
        <p className="page-message" role="alert">
          {message}
        </p>
      )}
    </div>
  );
}
