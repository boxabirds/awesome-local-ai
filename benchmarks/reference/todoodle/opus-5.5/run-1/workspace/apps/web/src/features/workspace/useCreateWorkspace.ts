import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { preloadSharePanel } from '@/features/share/SharePanelLazy';
import { createWorkspace } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import { notifyDropped } from '@/features/remembered/useDroppedNotice';
import { primeOpen } from './bootOpen';

/** Creates a workspace and takes the visitor into it. Used by Home and NotFound. */
export function useCreateWorkspace() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: createWorkspace,
    onSuccess: ({ workspace, secret, dropped }) => {
      // Prime the cache in the mutation callback (never in render or an effect), so the
      // Workspace route renders the name immediately with no second request.
      queryClient.setQueryData(queryKeys.workspace(workspace.id), workspace);
      primeOpen(secret, workspace);
      // The new workspace is now first in this browser's remembered list.
      void queryClient.invalidateQueries({ queryKey: queryKeys.remembered() });
      notifyDropped(dropped);
      preloadSharePanel();
      // The secret goes only into the fragment; history state carries a flag, never the secret.
      navigate(`/w#${secret}`, { state: { justCreated: true } });
    },
  });
}
