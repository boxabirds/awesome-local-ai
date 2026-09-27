import type { RememberedPublic } from '@todoodle/shared/schemas';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { createElement } from 'react';
import { toast } from 'sonner';
import { forgetRemembered, getRemembered } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';

export const FORGET_FAILED = "Couldn't forget this workspace — try again";

/** This browser's remembered list. Browser-scoped, so keyed ['remembered'], not under ['ws', id]. */
export const rememberedQuery = queryOptions({
  queryKey: queryKeys.remembered(),
  queryFn: getRemembered,
  retry: false,
});

/**
 * Forget on this browser, optimistically: the row disappears at once and comes back with an
 * alert toast if the server call fails.
 */
export function useForgetRemembered() {
  const client = useQueryClient();
  const key = queryKeys.remembered();
  return useMutation({
    mutationFn: (id: string) => forgetRemembered(id),
    onMutate: async (id) => {
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<RememberedPublic[]>(key);
      if (previous) client.setQueryData<RememberedPublic[]>(key, previous.filter((w) => w.id !== id));
      return { previous };
    },
    onError: (_error, _id, context) => {
      if (context?.previous) client.setQueryData(key, context.previous);
      toast.error(createElement('span', { role: 'alert' }, FORGET_FAILED));
    },
    onSettled: () => client.invalidateQueries({ queryKey: key }),
  });
}
