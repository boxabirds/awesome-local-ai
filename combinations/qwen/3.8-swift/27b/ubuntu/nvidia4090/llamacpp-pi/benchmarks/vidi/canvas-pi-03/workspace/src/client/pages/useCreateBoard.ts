/**
 * Story 5: the create-a-board action shared by HomePage and NotFoundPage
 * (the PRD requires the not-found page to reuse the home page's action).
 *
 * State machine (not persisted):
 *   idle → creating ("Creating…", button disabled)
 *   creating → idle+navigate on success (never rendered — the route changes)
 *   creating → failed / rate_limited (message under the button; button re-enabled)
 */
import { useCallback, useState } from 'react';
import { createBoardRequest } from '../api';
import { navigate } from '../router';

export type CreateStatus = 'idle' | 'creating' | 'failed' | 'rate_limited';

export function useCreateBoard(): { status: CreateStatus; create: () => Promise<void> } {
  const [status, setStatus] = useState<CreateStatus>('idle');

  const create = useCallback(async () => {
    if (status === 'creating') return;
    setStatus('creating');
    const res = await createBoardRequest();
    if (res.kind === 'created') {
      // On success we navigate away; no local status change (the page
      // unmounts). A failed/rate-limited response re-enables the button.
      navigate(`/b/${res.id}`);
    } else {
      setStatus(res.kind === 'rate_limited' ? 'rate_limited' : 'failed');
    }
  }, [status]);

  return { status, create };
}
