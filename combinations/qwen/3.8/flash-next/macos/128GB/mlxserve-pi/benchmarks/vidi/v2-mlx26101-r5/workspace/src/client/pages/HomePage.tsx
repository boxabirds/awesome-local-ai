/**
 * The home page: what this is, and one thing to do.
 *
 * Three elements, in the order a person reads them — the name, one sentence about what the
 * product is for, and a button — with a line under the button that is empty until there is
 * something to say there. The sentence is not decoration: `share.create` is the first thing
 * anybody does here, and a person who is not sure what a "board" is should find that out from the
 * page that offers to make one.
 *
 * The empty line under the button is the part that has to be designed rather than improvised. It
 * holds exactly one message, "Couldn't create a board. Please try again.", and it appears when
 * the service says no or says nothing at all — which is the same message for two different
 * failures, because what the person does about both is to press the button again
 * (`share.create_failure`).
 *
 * Nothing is written into the address bar on the way here or on the way out: a visit to `/` that
 * created nothing leaves the back button pointing where it did before, and the board's own
 * address is put there only once the board exists (`share.create`).
 */

import { navigate } from '../router';
import { CREATE_FAILED_MESSAGE, CREATING_LABEL, NEW_BOARD_LABEL, TAGLINE } from './messages';
import type { GoTo } from './useCreateBoard';
import { useCreateBoard } from './useCreateBoard';

export interface HomePageProps {
  /** Where to go when a board arrives. Defaults to the router. */
  go?: GoTo;
}

/** The home page. */
export function HomePage({ go }: HomePageProps): React.JSX.Element {
  const { state, start } = useCreateBoard(go ?? navigate);

  return (
    <main className="page" data-testid="home-page">
      <h1 className="home-name">vidi6</h1>
      <p className="home-tagline">{TAGLINE}</p>
      <button
        type="button"
        className="page-button home-new-board"
        data-testid="new-board-button"
        // The label is the state, in the button itself: a person waiting for a board should be
        // looking at the thing they pressed, not at a message below it.
        disabled={state === 'creating'}
        onClick={start}
      >
        {state === 'creating' ? CREATING_LABEL : NEW_BOARD_LABEL}
      </button>
      {/* One line, one meaning: why nothing happened, and what to do about it. */}
      {/* A live region, so the sentence is read out when it arrives rather than only to somebody
          who happens to move focus to it afterwards. */}
      <p className="page-error" data-testid="home-error" role="status">
        {state === 'failed' ? CREATE_FAILED_MESSAGE : ''}
      </p>
    </main>
  );
}
