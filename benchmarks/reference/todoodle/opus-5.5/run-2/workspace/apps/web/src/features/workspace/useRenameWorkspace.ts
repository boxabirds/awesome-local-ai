import type { Workspace } from '@todoodle/shared/schemas';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { renameWorkspace } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';

/** Optimistic rename: the new name shows at once and rolls back if the server refuses. */
export function useRenameWorkspace(workspaceId: string) {
  const client = useQueryClient();
  const key = queryKeys.workspace(workspaceId);
  return useMutation({
    mutationFn: (name: string) => renameWorkspace(workspaceId, name),
    onMutate: async (name) => {
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<Workspace>(key);
      if (previous) client.setQueryData<Workspace>(key, { ...previous, name });
      return { previous };
    },
    onError: (_error, _name, context) => {
      if (context?.previous) client.setQueryData(key, context.previous);
      toast.error("Couldn't rename the workspace — try again.");
    },
    onSuccess: (workspace) => {
      client.setQueryData(key, workspace);
    },
    onSettled: () => client.invalidateQueries({ queryKey: key }),
  });
}
