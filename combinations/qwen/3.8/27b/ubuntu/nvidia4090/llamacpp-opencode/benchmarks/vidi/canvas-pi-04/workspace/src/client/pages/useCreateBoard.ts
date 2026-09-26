// Story 5: the "create a board" action shared by HomePage and NotFoundPage
// (share.pages). State: Idle -> Creating -> (created: navigate) | CreateFailed
// | RateLimited; both error states go back to Creating on the next click.

import { useCallback, useState } from 'react';
import { createBoardRequest } from '../api';
import { navigate } from '../router';

export type CreateBoardState =
  | { status: 'idle' }
  | { status: 'creating' }
  | { status: 'create_failed' }
  | { status: 'rate_limited' };

export function useCreateBoard(): { state: CreateBoardState; create: () => void } {
  const [state, setState] = useState<CreateBoardState>({ status: 'idle' });

  const create = useCallback((): void => {
    if (state.status === 'creating') return;
    setState({ status: 'creating' });
    void createBoardRequest().then((result) => {
      if (result.kind === 'created') {
        navigate(`/b/${result.id}`);
        setState({ status: 'idle' });
      } else if (result.kind === 'rate_limited') {
        setState({ status: 'rate_limited' });
      } else {
        setState({ status: 'create_failed' });
      }
    });
  }, [state.status]);

  return { state, create };
}
