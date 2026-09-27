import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { createWorkspace } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import { rememberSecretWorkspace } from './bootOpen';

/** Creates a workspace and goes straight into it. Used by Home and NotFound. */
export function useCreateWorkspace() {
  const client = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: createWorkspace,
    onSuccess: ({ workspace, secret }) => {
      // Prime the cache so the Workspace route renders the name with no second fetch.
      client.setQueryData(queryKeys.workspace(workspace.id), workspace);
      rememberSecretWorkspace(secret, workspace.id);
      void import('@/features/share/SharePanel');
      navigate(`/w#${secret}`, { state: { justCreated: true } });
    },
  });
}
