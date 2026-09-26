/** The stored state decideRestore reads (a subset of a projects row). */
export type RestorableProject = { deleted: number; delete_batch_id: string | null };

export type RestoreDecision = 'ok' | 'not_deleted' | 'batch_mismatch';

/**
 * Whether POST /projects/:pid/restore may undo a deletion: only a deleted project, and only with the batch id
 * of the deletion that removed it (an empty or stale id never matches), so undo restores exactly that set.
 */
export function decideRestore(project: RestorableProject, batchId: string): RestoreDecision {
  if (project.deleted === 0) return 'not_deleted';
  if (batchId === '' || project.delete_batch_id === null || project.delete_batch_id !== batchId) return 'batch_mismatch';
  return 'ok';
}
