import { useCallback, useEffect, useRef, useState } from 'react';
import { createBoardRequest } from '../api';
import { navigate } from '../router';
import { CREATE_FAILED_MESSAGE, type HomePageState } from './state';

/** The New board action shared by the Home and Board not found pages. */
export function useCreateBoard(): { state: HomePageState; create: () => void } {
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
    void createBoardRequest().then((res) => {
      busy.current = false;
      if (res.kind === 'created') {
        navigate(`/b/${res.id}`);
      } else if (mounted.current) {
        setState({ kind: 'create_failed', message: CREATE_FAILED_MESSAGE });
      }
    });
  }, []);

  return { state, create };
}

export const pageStyle = {
  minHeight: '100%',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 16,
  padding: 24,
  textAlign: 'center',
  boxSizing: 'border-box',
} as const;

export const primaryButtonStyle = {
  padding: '12px 28px',
  font: '600 16px system-ui, sans-serif',
  border: 'none',
  borderRadius: 8,
  background: '#1565C0',
  color: '#fff',
  cursor: 'pointer',
} as const;
