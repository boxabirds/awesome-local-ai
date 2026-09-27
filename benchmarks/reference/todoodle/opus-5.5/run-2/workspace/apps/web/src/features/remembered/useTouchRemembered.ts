import { useQuery, useQueryClient } from '@tanstack/react-query';
import { touchRemembered } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';

/**
 * Opening /w/:id tells the server, once per visit, to move the workspace to the front of this
 * browser's list. A query, not an effect: the key sits outside ['remembered'], so refreshing the
 * list never touches again. gcTime 0 drops the result when the route unmounts, so the next visit
 * touches again (StrictMode's remount re-subscribes before the gc timer fires, so no double touch).
 */
export function useTouchRemembered(id: string) {
  const client = useQueryClient();
  return useQuery({
    queryKey: queryKeys.rememberedTouch(id),
    queryFn: async () => {
      await touchRemembered(id);
      void client.invalidateQueries({ queryKey: queryKeys.remembered() });
      return true;
    },
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
}
