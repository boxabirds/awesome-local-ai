import { useRef, useState } from 'react';
import type { JSX } from 'react';
import { liveApi, type BoardApi } from '../api';
import { HOME_FAILURE, homeAfter, homeBusy, type HomePageState } from './state';
import { boardPath, navigateTo } from '../router';

export interface NewBoardButtonProps {
  /** What to ask the service with. Tests hand this a set of prepared answers. */
  api?: BoardApi;
  /** Which page is asking, so it can style its own button. */
  className?: string;
}

/**
 * Asking for a board, and going to it.
 *
 * Two pages ask for a board: the home page, and the page for a link that led nowhere - which is
 * the same wish, made by somebody who was hoping for something else. So the asking lives here
 * rather than being said twice in two voices, and both pages get the same two guarantees:
 *
 * - the request goes out once per wish, however eagerly the button is pressed;
 * - the address in the bar ends up being the board that came back, because that address is the
 *   thing the person then shares.
 *
 * A failure is shown next to the button, in the words the service used, and the button is handed
 * back to the person: nothing here retries on its own, because a board nobody wished for is worse
 * than a click that had to be made twice.
 */
export function NewBoardButton({
  api = liveApi,
  className = 'page__button',
}: NewBoardButtonProps): JSX.Element {
  const [state, setState] = useState<HomePageState>('idle');
  // The same guard as `homeBusy`, in a place React cannot be behind. State is only up to date once
  // it has rendered, and two clicks in the same breath both arrive before that happens - so the
  // promise of one board per wish is kept here, where "already asked" is true the instant the first
  // click is seen.
  const asked = useRef(false);

  const start = (): void => {
    if (asked.current) {
      return;
    }
    asked.current = true;
    setState(homeAfter(state, 'start'));
    void api.createBoard().then((outcome) => {
      if (outcome.ok) {
        setState(homeAfter(state, 'created'));
        navigateTo(boardPath(outcome.id));
        return;
      }
      asked.current = false;
      setState((current) => homeAfter(current, 'failed'));
    });
  };

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={start}
        disabled={homeBusy(state)}
        data-testid="new-board"
      >
        New board
      </button>
      {state === 'failed' ? (
        <p className="page__failure" role="alert" data-testid="create-failure">
          {HOME_FAILURE}
        </p>
      ) : null}
    </>
  );
}
