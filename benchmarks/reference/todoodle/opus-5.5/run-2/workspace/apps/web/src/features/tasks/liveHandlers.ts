import { TaskSchema, type Counts } from '@todoodle/shared/schemas';
import { type LiveHandler, registerLiveHandler } from '@/features/live/registry';
import { qk } from '@/lib/queryKeys';
import type { LocalTask } from './localTask';
import { adjustCount, applyTaskEvents } from './taskCache';

/**
 * Someone else created or changed a task: patch the Inbox list (newer versions only; new ids at
 * their sortOrder position) and count a new open task. Story 4's dispatcher has already dropped
 * this tab's own echoes and runs a frame's events inside one notification batch.
 */
export const applyTaskUpserted: LiveHandler<'task.upserted'> = ({ queryClient, workspaceId }, event) => {
  const parsed = TaskSchema.safeParse(event.entity);
  if (!parsed.success) {
    // Not a shape this version understands: refetch instead of guessing.
    void queryClient.invalidateQueries({ queryKey: [...qk.root(workspaceId), 'tasks'] });
    void queryClient.invalidateQueries({ queryKey: qk.counts(workspaceId) });
    return 'stale';
  }
  if (parsed.data.workspaceId !== workspaceId) return 'stale';
  const key = qk.tasks(workspaceId, { list: 'inbox' });
  const before = queryClient.getQueryData<LocalTask[]>(key);
  if (!before) return 'stale';
  const after = applyTaskEvents(before, [{ entity: parsed.data, version: event.version }]);
  if (after === before) return 'stale';
  queryClient.setQueryData(key, after);
  if (after.length > before.length && parsed.data.completedAt === null) {
    queryClient.setQueriesData<Counts>({ queryKey: qk.counts(workspaceId) }, (counts) => adjustCount(counts, 1));
  }
  return 'applied';
};

/** Registers the task handlers (added to the registry's set; never replaces another). Returns the unregister. */
export function registerTaskHandlers(): () => void {
  return registerLiveHandler('task.upserted', applyTaskUpserted);
}
