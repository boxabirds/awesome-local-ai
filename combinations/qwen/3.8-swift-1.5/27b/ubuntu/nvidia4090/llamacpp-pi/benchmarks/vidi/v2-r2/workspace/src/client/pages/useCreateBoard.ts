import { useState } from 'react';
import { createBoardRequest } from '../api';
import { navigate } from '../router';
import { CREATE_FAILED_MESSAGE, type HomePageState } from './state';

/**
 * The "New board" action (story 5): one POST /api/boards, then navigate to
 * the board link. Used by both the Home page and the "Board not found"
 * page, so the failure message and states stay identical.
 */
export function useCreateBoard() {
  const [state, setState] = useState<HomePageState>({ kind: 'idle' });

  const onCreate = async () => {
    if (state.kind === 'creating') return;
    setState({ kind: 'creating' });
    const result = await createBoardRequest();
    if (result.kind === 'created') {
      navigate(`/b/${result.id}`);
    } else {
      setState({ kind: 'create_failed', message: CREATE_FAILED_MESSAGE });
    }
  };

  return { state, onCreate };
}
