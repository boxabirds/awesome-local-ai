import type { Workspace } from '@todoodle/shared/schemas';
import { queryKeys } from '@/lib/queryKeys';
import { type LiveHandler, registerLiveHandler } from './registry';

/** Someone renamed the workspace: patch the cache if the event is newer. */
export const applyWorkspaceUpdated: LiveHandler<'workspace.updated'> = ({ queryClient, workspaceId }, event) => {
  if (event.entity.id !== workspaceId) return 'stale';
  const key = queryKeys.workspace(workspaceId);
  const cached = queryClient.getQueryData<Workspace>(key);
  if (cached && cached.version >= event.version) return 'stale';
  queryClient.setQueryData<Workspace>(key, { ...event.entity, version: event.version });
  return 'applied';
};

/** A bulk task change: refetch rather than patch. */
export const applyTasksBulk: LiveHandler<'tasks.bulk'> = ({ queryClient, workspaceId }) => {
  void queryClient.invalidateQueries({ queryKey: [...queryKeys.root(workspaceId), 'tasks'] });
  void queryClient.invalidateQueries({ queryKey: [...queryKeys.root(workspaceId), 'counts'] });
  return 'applied';
};

/** This story's handlers; returns one function that unregisters them all. */
export function registerWorkspaceHandlers(): () => void {
  const off = [registerLiveHandler('workspace.updated', applyWorkspaceUpdated), registerLiveHandler('tasks.bulk', applyTasksBulk)];
  return () => off.forEach((fn) => fn());
}
