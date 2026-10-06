/**
 * Asking for a new board, from wherever a person asks.
 *
 * The home page asks with a button, and the Board not found page asks with a button that means
 * "the link I followed was wrong, give me one that is not". Both need the same three things: a
 * wait that can be seen, a failure that can be read, and a way to a board that only opens once
 * the board is real. So they share this.
 *
 * The order of the two state changes at the end is the whole point. `201` means the board
 * exists, so the address is changed after the answer; the button is enabled again only when the
 * answer was a failure. A person who clicks twice as fast as the service answers gets one board,
 * because the second click lands on a disabled button rather than on a second request.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { createBoard } from '../api';
import { boardPath } from '../router';

/** What came back from the last click. */
export type CreateBoardState = 'idle' | 'creating' | 'failed';

/** What a page does with the id of the board it was given. */
export type GoTo = (path: string) => void;

export interface CreateBoardHook {
  /** `creating` is the button's "Creating…"; `failed` is the message under it. */
  state: CreateBoardState;
  /** Asks for a board. Does nothing while one is already on its way. */
  start(): void;
}

/**
 * The state machine: `idle → creating → (navigated | failed)`, `failed → creating`.
 *
 * The navigation happens inside this hook rather than in the page, so that both pages take the
 * same route to a board and a test of either one sees the same address in the bar.
 */
export function useCreateBoard(go: GoTo): CreateBoardHook {
  const [state, setState] = useState<CreateBoardState>('idle');
  /** Whether this render is still the one that asked. */
  const mounted = useRef(true);
  const goRef = useRef(go);
  goRef.current = go;

  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  const start = useCallback((): void => {
    // A second click while the first is still out there is not a second board.
    setState((current) => (current === 'creating' ? current : 'creating'));
    // The message from a previous failure is cleared by the click, not by the answer: the
    // person has already read it, and it is not true of this request.
    void (async () => {
      const result = await createBoard();
      if (!mounted.current) return;
      if (result.ok) {
        // Leave the "Creating…" wording on screen until the board is on the way: the button
        // going back to "New board" for a moment before the page changes reads as a failure.
        goRef.current(boardPath(result.id));
        setState('idle');
        return;
      }
      setState('failed');
    })();
  }, []);

  return { state, start };
}
