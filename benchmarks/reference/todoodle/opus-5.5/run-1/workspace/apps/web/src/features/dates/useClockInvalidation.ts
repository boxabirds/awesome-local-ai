import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { queryKeys } from '@/lib/queryKeys';
import { subscribe } from './clockStore';

/**
 * Mounted once in the workspace shell. The counts key carries no date (architecture §12): its queryFn reads the
 * clock snapshot. So when the local date changes, this refetches counts (the Today badge and tab title). The
 * Today list's key contains the date, so it refetches by itself.
 */
export function useClockInvalidation(workspaceId: string): void {
  const queryClient = useQueryClient();
  useEffect(
    () => subscribe(() => void queryClient.invalidateQueries({ queryKey: queryKeys.counts(workspaceId) })),
    [queryClient, workspaceId],
  );
}
