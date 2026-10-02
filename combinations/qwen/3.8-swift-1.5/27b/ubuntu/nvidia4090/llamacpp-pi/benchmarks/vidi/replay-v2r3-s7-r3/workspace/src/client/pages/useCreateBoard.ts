import { useCallback, useState } from 'react';
import { createBoardRequest } from '../api';
import { navigate } from '../router';
import { CREATE_FAILURE_MESSAGE, type HomePageState } from './state';

/**
 * Shared "New board" action for HomePage and the not-found page
 * (share.home, share.open_link): creating → navigate to /b/<id>;
 * failure → create_failed with the exact failure message (no partial
 * navigation on 500).
 */
export function useCreateBoard(): {
  state: HomePageState;
  start: () => void;
} {
  const [state, setState] = useState<HomePageState>({ kind: 'idle' });

  const start = useCallback(async () => {
    setState({ kind: 'creating' });
    const result = await createBoardRequest();
    if (result.kind === 'created') {
      navigate(`/b/${result.id}`);
    } else {
      setState({ kind: 'create_failed', message: CREATE_FAILURE_MESSAGE });
    }
  }, []);

  return { state, start };
}
