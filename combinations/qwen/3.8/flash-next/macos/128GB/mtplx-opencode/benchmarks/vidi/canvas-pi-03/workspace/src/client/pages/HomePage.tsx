// Home page (share.pages).
//
// One screen: product name, one-line description, a **Create a board** button
// and a slot for an error message beneath it. Clicking Create runs the shared
// create action and navigates to the new board; a failure keeps the visitor on
// the home page with the button re-enabled and the right message.
//
// The same create action is reused by the "Create a new board" button on the
// Board-not-found page, so it lives here and is exported.

import { type ReactElement, useCallback, useState } from 'react';
import { createBoardRequest, type CreateResponse } from '../api';
import { navigate } from '../router';

export const HOME_TAGLINE = 'A shared board for thinking together';
export const CREATE_FAILURE_MESSAGE = "Couldn't create a board. Please try again.";
export const RATE_LIMIT_MESSAGE = "You're creating boards too quickly. Wait a minute and try again.";

/** What the create flow resolved to — also what a mocked `api.ts` returns in
 * the component tests. */
type CreateState = 'idle' | 'creating' | 'failed' | 'rate_limited';

/**
 * The Create-a-board button + its message slot. Kept as a component so both the
 * home page and the not-found page render the identical, tested interaction.
 * `afterCreate` overrides where a successful create navigates (default: the
 * new board). A `label` lets the not-found page say "Create a new board".
 */
export function CreateBoardButton(props: {
  label?: string;
  afterCreate?: (id: string) => void;
}): ReactElement {
  const { label = 'Create a board', afterCreate } = props;
  const [state, setState] = useState<CreateState>('idle');

  const create = useCallback(async () => {
    setState('creating');
    const result: CreateResponse = await createBoardRequest();
    if (result.kind === 'created') {
      // Leaving the page: reset to idle so a later back-navigation is clean.
      setState('idle');
      const target = `/b/${result.id}`;
      if (afterCreate) afterCreate(result.id);
      else navigate(target);
      return;
    }
    setState(result.kind === 'rate_limited' ? 'rate_limited' : 'failed');
  }, [afterCreate]);

  const message =
    state === 'rate_limited'
      ? RATE_LIMIT_MESSAGE
      : state === 'failed'
        ? CREATE_FAILURE_MESSAGE
        : null;

  return (
    <>
      <button
        type="button"
        data-testid="create-board"
        disabled={state === 'creating'}
        onClick={() => {
          void create();
        }}
      >
        {state === 'creating' ? 'Creating…' : label}
      </button>
      {message !== null && (
        <p role="alert" data-testid="create-message">
          {message}
        </p>
      )}
    </>
  );
}

/** The home page. */
export function HomePage(): ReactElement {
  return (
    <main data-testid="home-page">
      <h1>vidi6</h1>
      <p>{HOME_TAGLINE}</p>
      <CreateBoardButton />
    </main>
  );
}
