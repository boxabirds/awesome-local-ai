import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { isNotFoundError, touchRemembered } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';

/**
 * Open by id (/w/:workspaceId): tells the server this browser just opened the workspace, which moves it
 * to the front of the remembered list. A query, not an effect: keyed ['remembered-touch', id] (outside
 * ['remembered'], so refreshing the list never re-fires it), fired once per mount of the route.
 * A 404 means the workspace is not remembered or no longer opens; the route shows NotFound.
 */
export function useTouchRemembered(id: string) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: queryKeys.rememberedTouch(id),
    queryFn: async () => {
      try {
        await touchRemembered(id);
      } catch (error) {
        if (!isNotFoundError(error)) toast.error("Couldn't update your workspaces on this browser");
        throw error;
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.remembered() });
      return true;
    },
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    retry: false,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}
