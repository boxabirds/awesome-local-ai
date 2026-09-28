// What the one "create a board" button does, including the three ways it can not
// work. Kept away from the page so the words can be read together and so an
// in-flight press can be refused without a page around it.
import { useCallback, useRef, useState } from 'react';
import { createBoardRequest, type CreateBoardResult } from './api.ts';

export type CreatePhase = 'idle' | 'creating';

/**
 * What a visitor is told, in the page's own error slot, or nothing at all. A
 * visitor who is told to wait is told to wait; a visitor the server refused is
 * told the board could not be created; a visitor whose request never arrived is
 * told that. None of them is shown the not-found page, and none of them is shown
 * a link that goes nowhere (PRD share.create, PRD share.rate_limit).
 */
export function createBoardMessage(result: CreateBoardResult): string | null {
  switch (result.kind) {
    case 'created':
      return null;
    case 'rate_limited':
      return "You're creating boards too quickly. Wait a minute and try again.";
    case 'failed':
    case 'unreachable':
      // The same sentence for a service that refused and a service that never
      // arrived, because what the visitor can do about either is press the button
      // again (PRD share.create_failure).
      return "Couldn't create a board. Please try again.";
  }
}

export interface CreateBoardState {
  phase: CreatePhase;
  /** What to show in the error slot. Null when there is nothing to say. */
  message: string | null;
  /**
   * Whether a press right now means "make me a board". False while a creation is
   * in flight, so a second press is ignored rather than queued into a second
   * board or a second request (TC-19).
   */
  wants: boolean;
  create: () => void;
}

/**
 * One creation at a time, and one answer per press.
 *
 * `request` and `onCreated` are parameters rather than module constants because
 * the page has to be testable without a network and without leaving the page it
 * is on; production passes the real request and a real navigation.
 */
export function useCreateBoard(
  onCreated: (boardId: string) => void,
  request: () => Promise<CreateBoardResult> = DEFAULT_REQUEST,
): CreateBoardState {
  const [phase, setPhase] = useState<CreatePhase>('idle');
  const [message, setMessage] = useState<string | null>(null);
  // The in-flight truth, in a ref: React state updates are not visible to a press
  // that lands in the same tick, and "ignore a press while creating" has to hold
  // for presses that do.
  const inFlight = useRef(false);

  const create = useCallback(() => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPhase('creating');
    // The previous press's message is cleared the moment this press happens: an
    // old complaint is never shown beside a new attempt.
    setMessage(null);
    void request().then(
      (result) => {
        inFlight.current = false;
        setPhase('idle');
        if (result.kind === 'created') {
          onCreated(result.boardId);
          return;
        }
        setMessage(createBoardMessage(result));
      },
      () => {
        // The request function is allowed to reject; a press must not end up
        // spinning forever with a button that no longer does anything.
        inFlight.current = false;
        setPhase('idle');
        setMessage(createBoardMessage({ kind: 'unreachable' }));
      },
    );
  }, [onCreated, request]);

  return { phase, message, wants: !inFlight.current, create };
}

// A module constant rather than a default parameter expression, so the default
// request is the same function every render and `create` keeps its identity.
const DEFAULT_REQUEST: () => Promise<CreateBoardResult> = createBoardRequest;
