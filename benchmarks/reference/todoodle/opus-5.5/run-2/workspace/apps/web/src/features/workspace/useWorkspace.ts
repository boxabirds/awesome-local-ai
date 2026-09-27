import type { Workspace } from '@todoodle/shared/schemas';
import { useQuery } from '@tanstack/react-query';
import { workspaceQuery } from './workspaceQuery';

export function useWorkspace(id: string, opts?: { placeholderData?: Workspace }) {
  return useQuery(workspaceQuery(id, opts));
}
