/**
 * Story 5 · the create action (shared by the home page and the not-found page).
 *
 * Both pages offer the same button, so they share the state machine behind it:
 * `idle → creating → (navigate | failed | rate_limited)`, and either error state
 * can go back to `creating` on the next click (design "Home page" diagram).
 *
 * Two details are load-bearing:
 *  - the request is issued *outside* React state, so a double click cannot send
 *    two POSTs — the second click is ignored while `creating`;
 *  - the outcome is applied only if the component is still mounted. The success
 *    path navigates, which unmounts this page; without the guard a late
 *    response would write state into a page that no longer exists.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createBoardRequest } from '../api';
import { boardPath, replace } from '../router';

export type CreateState = 'idle' | 'creating' | 'failed' | 'rate_limited';

export interface CreateAction {
  state: CreateState;
  /** Fire the request. No-op while one is already in flight. */
  create(): void;
}

/** @param override injectable for the component tests (defaults to `api.ts`) */
export function useCreateBoard(
  create: () => Promise<
    { kind: 'created'; id: string } | { kind: 'rate_limited' } | { kind: 'failed' }
  > = createBoardRequest,
): CreateAction {
  const [state, setState] = useState<CreateState>('idle');
  const mounted = useRef(true);
  const busy = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      busy.current = false;
    };
  }, []);

  const createNow = useCallback(() => {
    if (busy.current) return;
    busy.current = true;
    setState('creating');
    void create().then((response) => {
      busy.current = false;
      if (!mounted.current) return;
      if (response.kind === 'created') {
        // The board page takes it from here. Replace rather than push: home and
        // the board it just opened are one visit (see `router.ts`).
        replace(boardPath(response.id));
        return;
      }
      setState(response.kind === 'rate_limited' ? 'rate_limited' : 'failed');
    });
  }, [create]);

  return { state, create: createNow };
}
