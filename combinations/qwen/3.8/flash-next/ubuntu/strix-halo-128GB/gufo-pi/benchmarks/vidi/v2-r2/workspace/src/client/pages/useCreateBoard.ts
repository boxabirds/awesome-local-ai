import { useCallback, useState } from 'react';
import { createBoardRequest } from '@client/api';
import { navigate } from '@client/router';
import { CREATE_FAILED_MESSAGE, type HomePageState } from './state';

export interface CreateBoardAction {
  state: HomePageState;
  create: () => void;
}

/**
 * The Home page create action, shared by HomePage and NotFoundPage (share.create,
 * share.create_failure). Clicking New board moves to `creating` while the POST
 * runs; on success it navigates to the new board; on failure it stays put, shows
 * the exact failure message and re-enables the button.
 */
export function useCreateBoard(): CreateBoardAction {
  const [state, setState] = useState<HomePageState>({ kind: 'idle' });

  const create = useCallback(async () => {
    setState({ kind: 'creating' });
    const res = await createBoardRequest();
    if (res.kind === 'created') {
      navigate(`/b/${encodeURIComponent(res.id)}`);
      setState({ kind: 'idle' });
      return;
    }
    setState({ kind: 'create_failed', message: CREATE_FAILED_MESSAGE });
  }, []);

  return { state, create };
}
