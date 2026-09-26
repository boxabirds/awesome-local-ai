import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import type { RememberedPublic } from '@todoodle/shared/schemas';
import { createElement } from 'react';
import { toast } from 'sonner';
import { forgetRemembered, getRemembered } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';

/**
 * This browser's remembered workspaces. Browser-scoped, so keyed ['remembered'] (outside ['ws', id]):
 * invalidating a workspace never refetches it. Shared by Home, the switcher and NotFound (one request).
 */
export const rememberedQuery = queryOptions({
  queryKey: queryKeys.remembered(),
  queryFn: getRemembered,
});

export const FORGET_FAILED_TEXT = "Couldn't forget this workspace — try again";

/**
 * Forget on this browser. Optimistic: the row disappears at once; on failure it comes back and an
 * alert toast explains. The list is refetched either way.
 */
export function useForgetRemembered() {
  const queryClient = useQueryClient();
  const key = queryKeys.remembered();
  return useMutation({
    mutationFn: (id: string) => forgetRemembered(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<RememberedPublic[]>(key);
      if (previous) queryClient.setQueryData<RememberedPublic[]>(key, previous.filter((entry) => entry.id !== id));
      return { previous };
    },
    onError: (_error, _id, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
      toast.error(createElement('span', { role: 'alert' }, FORGET_FAILED_TEXT));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}
