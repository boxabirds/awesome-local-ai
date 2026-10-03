// The New board button, used by the home page and by "Board not found". It is the
// only door to `POST /api/boards`: one click, one board, then the address bar holds
// the link to it (share.create).
//
// Three states, one at a time: idle ("New board"), in flight ("Creating…", disabled,
// so a double click cannot make two boards), and failed — where the message sits
// under the button and the button becomes available again. A failure is retryable
// because `create_failed` means the service could not be reached or refused to write,
// not that the person did something wrong, and the words say so: "Couldn't create a
// board. Please try again." (PRD), never a stack trace or a status code.

import { useState } from 'react';
import type { JSX } from 'react';
import { createBoardRequest } from '../api';
import { navigate } from '../router';
import type { HomePageState } from './state';

/** Shown under the button when a board could not be created. */
export const CREATE_FAILED_MESSAGE = "Couldn't create a board. Please try again.";

const LABELS: Record<HomePageState['kind'], string> = {
  idle: 'New board',
  creating: 'Creating\u2026',
  create_failed: 'Try again',
};

export interface NewBoardButtonProps {
  /** Extra class for the page that hosts it. */
  className?: string;
}

export function NewBoardButton({ className }: NewBoardButtonProps): JSX.Element {
  const [state, setState] = useState<HomePageState>({ kind: 'idle' });
  const creating = state.kind === 'creating';

  const create = async () => {
    setState({ kind: 'creating' });
    const result = await createBoardRequest();
    if (result.kind === 'created') {
      // The link is the point of the whole story, so the address changes to it.
      setState({ kind: 'idle' });
      navigate(`/b/${result.id}`);
      return;
    }
    setState({ kind: 'create_failed', message: CREATE_FAILED_MESSAGE });
  };

  return (
    <div className="new-board">
      <button
        type="button"
        data-testid="new-board"
        className={className}
        disabled={creating}
        aria-busy={creating}
        onClick={() => {
          void create();
        }}
      >
        {LABELS[state.kind]}
      </button>
      {state.kind === 'create_failed' ? (
        <p className="new-board-error" role="alert" data-testid="new-board-error">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
