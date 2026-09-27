// The create-board action (spec: share.pages Home state diagram), shared by
// HomePage ("Create a board") and NotFoundPage ("Create a new board").
//
// Idle → Creating → navigate on 201; failed → "create_failed"; 429 →
// "rate_limited". In both terminal states the button is enabled again, so a
// click retries (CreateFailed/RateLimited → Creating).

import { useCallback, useState } from 'react';
import { createBoardRequest } from '../api';
import { navigate } from '../router';

export type CreateState = 'idle' | 'creating' | 'create_failed' | 'rate_limited';

export function useCreateBoard() {
  const [state, setState] = useState<CreateState>('idle');

  const create = useCallback(async () => {
    if (state === 'creating') return;
    setState('creating');
    const result = await createBoardRequest();
    if (result.status === 'created') {
      navigate(`/b/${result.id}`);
      return;
    }
    setState(result.status === 'rate_limited' ? 'rate_limited' : 'create_failed');
  }, [state]);

  return { state, create };
}
