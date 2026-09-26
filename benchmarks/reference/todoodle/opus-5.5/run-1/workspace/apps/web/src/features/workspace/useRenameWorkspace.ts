import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Workspace } from '@todoodle/shared/schemas';
import { toast } from 'sonner';
import { renameWorkspace } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';

/** Optimistic rename: the new name shows at once and rolls back with a toast if saving fails. */
export function useRenameWorkspace(workspaceId: string) {
  const queryClient = useQueryClient();
  const key = queryKeys.workspace(workspaceId);
  return useMutation({
    mutationFn: (name: string) => renameWorkspace(workspaceId, name),
    onMutate: async (name) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Workspace>(key);
      if (previous) queryClient.setQueryData<Workspace>(key, { ...previous, name });
      return { previous };
    },
    onError: (_error, _name, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
      toast.error("Couldn't rename the workspace — try again");
    },
    onSuccess: (workspace) => {
      queryClient.setQueryData(key, workspace);
    },
    onSettled: () => {
      // Story 3: this browser's remembered list shows the name too (Home, switcher, instant name).
      void queryClient.invalidateQueries({ queryKey: queryKeys.remembered() });
      return queryClient.invalidateQueries({ queryKey: key });
    },
  });
}
