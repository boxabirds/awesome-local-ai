import { useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { WorkspaceSkeleton } from '@/features/workspace/WorkspaceSkeleton';
import { rememberedPlaceholder } from './rememberedPlaceholder';

/**
 * Suspense fallback for /w/:workspaceId while the Workspace chunk loads: the skeleton, with the name
 * already in the header when this browser's cached remembered list knows it (read-only cache access).
 */
export function RememberedWorkspaceFallback() {
  const { workspaceId } = useParams();
  const queryClient = useQueryClient();
  const name = workspaceId ? rememberedPlaceholder(queryClient, workspaceId)?.name : undefined;
  return <WorkspaceSkeleton name={name} />;
}
