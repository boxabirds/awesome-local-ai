import { useQuery } from '@tanstack/react-query';
import type { Workspace } from '@todoodle/shared/schemas';
import { workspaceQuery } from './workspaceQuery';

/** The workspace from the query cache, refetched on focus so a rename by someone else shows up. */
export function useWorkspace(id: string, opts?: { placeholderData?: Workspace }) {
  return useQuery(workspaceQuery(id, opts));
}
