import type { LiveEvent } from '@todoodle/shared/events';
import type { RememberedPublic, Workspace } from '@todoodle/shared/schemas';
import { queryKeys } from '@/lib/queryKeys';
import { type HandlerCtx, registerLiveHandler } from './registry';

/** workspace.updated: replace the cached workspace when the event is newer. */
export function applyWorkspaceUpdated(ctx: HandlerCtx, event: Extract<LiveEvent, { type: 'workspace.updated' }>): boolean {
  const { entity } = event;
  if (entity.id !== ctx.workspaceId) return false;
  const key = queryKeys.workspace(ctx.workspaceId);
  const cached = ctx.queryClient.getQueryData<Workspace>(key);
  if (cached && cached.version >= event.version) return false;
  ctx.queryClient.setQueryData<Workspace>(key, entity);
  // The remembered list (Home, switcher, instant name) shows the name too: patch it, no refetch.
  ctx.queryClient.setQueryData<RememberedPublic[]>(queryKeys.remembered(), (list) =>
    list?.map((item) => (item.id === entity.id ? { ...item, name: entity.name } : item)),
  );
  return true;
}

/** tasks.bulk: too many changes to patch; refetch tasks and counts. */
export function applyTasksBulk(ctx: HandlerCtx): boolean {
  void ctx.queryClient.invalidateQueries({ queryKey: queryKeys.tasks(ctx.workspaceId) });
  void ctx.queryClient.invalidateQueries({ queryKey: queryKeys.counts(ctx.workspaceId) });
  return true;
}

/** Story 4's handlers. Registered by LiveProvider once per workspace; returns an unregister function. */
export function registerWorkspaceHandlers(): () => void {
  const unregister = [registerLiveHandler('workspace.updated', applyWorkspaceUpdated), registerLiveHandler('tasks.bulk', applyTasksBulk)];
  return () => {
    for (const fn of unregister) fn();
  };
}
