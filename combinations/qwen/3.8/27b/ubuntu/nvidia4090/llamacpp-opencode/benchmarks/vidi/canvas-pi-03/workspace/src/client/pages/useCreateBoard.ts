import { useCallback, useRef, useState } from 'react';
import { createBoardRequest } from '@/client/api';
import { navigate } from '@/client/router';

/**
 * Shared "create a board" behaviour for the home and not-found pages
 * (story 5, share.create):
 *
 *  - the button is disabled while a request is in flight ("Creating…");
 *  - rapid double-clicks do not fire a second request;
 *  - on success the app navigates to `/b/<id>` (SPA navigation — no reload);
 *  - on 500/network error: "Couldn't create a board. Please try again."
 *    (the button re-enables);
 *  - on 429: "You're creating boards too quickly. Wait a minute and try
 *    again." (share.rate_limit).
 */

export const CREATE_FAILED_TEXT = "Couldn't create a board. Please try again.";
export const RATE_LIMITED_TEXT = "You're creating boards too quickly. Wait a minute and try again.";

export type CreateState = 'idle' | 'creating' | 'create_failed' | 'rate_limited';

export function useCreateBoard(): { state: CreateState; create: () => void } {
  const [state, setState] = useState<CreateState>('idle');
  const busyRef = useRef(false);

  const create = useCallback((): void => {
    if (busyRef.current) return; // a request is already in flight
    busyRef.current = true;
    setState('creating');
    void (async () => {
      try {
        const res = await createBoardRequest();
        if (res.kind === 'created') {
          // The navigation unmounts this component; do not touch state after.
          navigate('/b/' + res.id);
          return;
        }
        setState(res.kind === 'rate_limited' ? 'rate_limited' : 'create_failed');
      } catch {
        setState('create_failed');
      } finally {
        busyRef.current = false;
      }
    })();
  }, []);

  return { state, create };
}
