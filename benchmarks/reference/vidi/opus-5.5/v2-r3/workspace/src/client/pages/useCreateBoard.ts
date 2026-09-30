// The New board action shared by the Home and Board not found pages (share.create).
import { useCallback, useEffect, useRef, useState } from 'react';
import { createBoardRequest } from '../api';
import { navigate } from '../router';
import { CREATE_FAILED_MESSAGE, type HomePageState } from './state';

export function useCreateBoard(): { state: HomePageState; create(): void } {
  const [state, setState] = useState<HomePageState>({ kind: 'idle' });
  const mounted = useRef(true);
  const busy = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const create = useCallback(() => {
    if (busy.current) return;
    busy.current = true;
    setState({ kind: 'creating' });
    void createBoardRequest()
      .catch(() => ({ kind: 'failed' }) as const)
      .then((result) => {
        busy.current = false;
        if (!mounted.current) return;
        if (result.kind === 'created') {
          navigate(`/b/${result.id}`);
        } else {
          // Stay on this page; the button is available again.
          setState({ kind: 'create_failed', message: CREATE_FAILED_MESSAGE });
        }
      });
  }, []);

  return { state, create };
}
