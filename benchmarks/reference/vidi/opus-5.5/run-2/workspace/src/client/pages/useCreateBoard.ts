/**
 * The Create a board action (anchor: share.pages), shared by HomePage and NotFoundPage:
 * Idle → Creating → navigate to the new board, or back to idle with an error message.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createBoardRequest } from '../api';
import { navigate } from '../router';

export const CREATING_TEXT = 'Creating…';
export const CREATE_FAILED_TEXT = "Couldn't create a board. Please try again.";
export const RATE_LIMITED_TEXT = "You're creating boards too quickly. Wait a minute and try again.";

export interface CreateBoardAction {
  creating: boolean;
  error: string | null;
  create(): void;
}

export function useCreateBoard(): CreateBoardAction {
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const create = useCallback(() => {
    if (busy.current) return;
    busy.current = true;
    setCreating(true);
    setError(null);
    void createBoardRequest().then((result) => {
      busy.current = false;
      if (!mounted.current) return;
      setCreating(false);
      if (result.kind === 'created') navigate(`/b/${result.id}`);
      else setError(result.kind === 'rate_limited' ? RATE_LIMITED_TEXT : CREATE_FAILED_TEXT);
    });
  }, []);

  return { creating, error, create };
}
