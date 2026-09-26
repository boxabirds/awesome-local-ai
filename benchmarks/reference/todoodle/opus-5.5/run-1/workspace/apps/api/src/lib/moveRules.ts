/** A move destination's state in the task's workspace: missing covers ids of other workspaces and unknown ids. */
export type DestinationState = 'active' | 'deleted' | 'missing';

export type MoveDecision = 'same_list' | 'move' | 'project_not_found';

/**
 * What PATCH /tasks/:tid {projectId} does. null means the Inbox. Moving to the list the task is already in is
 * a no-op (no write, no version bump, no broadcast); a project destination must be active in this workspace.
 * `destState` is only read for a project destination.
 */
export function classifyMove(currentProjectId: string | null, destProjectId: string | null, destState: DestinationState | null): MoveDecision {
  if (currentProjectId === destProjectId) return 'same_list';
  if (destProjectId === null) return 'move';
  return destState === 'active' ? 'move' : 'project_not_found';
}
