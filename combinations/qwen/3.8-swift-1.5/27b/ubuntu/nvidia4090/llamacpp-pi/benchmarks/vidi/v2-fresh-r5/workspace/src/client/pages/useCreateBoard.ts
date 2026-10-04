/**
 * The New board action shared by the Home and Board-not-found pages
 * (story 5, share.create): creates a board server-side and navigates to it,
 * or shows the failure message and stays put (the button re-enables for
 * another attempt).
 */
import { useCallback, useState } from 'react';
import { createBoardRequest } from '../api';
import { navigate } from '../router';
import { CREATE_FAILED_MESSAGE, type HomePageState } from './state';

export function useCreateBoard(): { state: HomePageState; start: () => void } {
  const [state, setState] = useState<HomePageState>({ kind: 'idle' });

  const start = useCallback(() => {
    setState({ kind: 'creating' });
    void createBoardRequest().then((result) => {
      if (result.kind === 'created') {
        navigate(`/b/${result.id}`);
      } else {
        setState({ kind: 'create_failed', message: CREATE_FAILED_MESSAGE });
      }
    });
  }, []);

  return { state, start };
}
