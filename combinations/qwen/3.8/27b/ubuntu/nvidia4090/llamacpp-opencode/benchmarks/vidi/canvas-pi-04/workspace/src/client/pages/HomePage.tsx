// Story 5: home page (share.pages): product name, one-line description,
// Create a board, and the creation error messages beneath the button.

import type { JSX } from 'react';
import { useCreateBoard } from './useCreateBoard';

export const CREATE_FAILED_MESSAGE = "Couldn't create a board. Please try again.";
export const RATE_LIMITED_MESSAGE =
  "You're creating boards too quickly. Wait a minute and try again.";

export function HomePage(): JSX.Element {
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
      <h1 className="page-title">vidi6</h1>
      <p className="page-subtitle">A shared board for thinking together</p>
      <button
        type="button"
        className="btn btn--primary create-button"
        onClick={create}
        disabled={creating}
      >
        {creating ? 'Creating…' : 'Create a board'}
      </button>
      {message !== null && (
        <p className="page-message" role="alert">
          {message}
        </p>
      )}
    </div>
  );
}
