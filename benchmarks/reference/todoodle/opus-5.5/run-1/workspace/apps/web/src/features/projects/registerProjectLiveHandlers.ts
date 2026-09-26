import type { QueryKey } from '@tanstack/react-query';
import type { LiveEvent } from '@todoodle/shared/events';
import { type Counts, type Project, ProjectSchema } from '@todoodle/shared/schemas';
import { type HandlerCtx, registerLiveHandler } from '@/features/live/registry';
import type { LocalTask } from '@/features/tasks/taskCache';
import { type TasksFilter, queryKeys } from '@/lib/queryKeys';
import { adjustCounts, applyProjectEvent } from './projectCache';
import { markProjectGone, unmarkProjectGone } from './projectGone';

export type ProjectLiveDeps = {
  /** The project this tab is showing, if any (read when an event arrives, so it never goes stale). */
  currentProjectId(): string | null;
  /** The project on screen was deleted by someone else: go to the Inbox and say so. */
  onViewedProjectDeleted(id: string): void;
};

function validProject(entity: unknown): Project | null {
  const parsed = ProjectSchema.safeParse(entity);
  return parsed.success ? parsed.data : null;
}

/**
 * Sidebar counts are recomputed by the server: one refetch. cancelRefetch false joins a refetch already in
 * flight (several events in one frame, or story 4's own tasks.bulk invalidation) instead of restarting it.
 */
function refreshCounts(ctx: HandlerCtx): void {
  void ctx.queryClient.invalidateQueries({ queryKey: queryKeys.counts(ctx.workspaceId), exact: true }, { cancelRefetch: false });
}

/** Every cached task list of one project (both includeCompleted variants). */
function projectListKeys(ctx: HandlerCtx, projectId: string): QueryKey[] {
  return ctx.queryClient
    .getQueriesData<LocalTask[]>({ queryKey: queryKeys.tasks(ctx.workspaceId) })
    .map(([key]) => key)
    .filter((key) => {
      const filter = key[3] as TasksFilter | undefined;
      return filter?.list === 'project' && filter.projectId === projectId;
    });
}

function writeProjects(ctx: HandlerCtx, fn: (list: Project[] | undefined) => Project[] | undefined): boolean {
  const key = queryKeys.projects(ctx.workspaceId);
  const before = ctx.queryClient.getQueryData<Project[]>(key);
  const after = fn(before);
  if (after === before) return false;
  ctx.queryClient.setQueryData(key, after);
  return true;
}

/** project.upserted (created, renamed or recoloured elsewhere): newer versions replace, stale ones are ignored. */
export function applyProjectUpserted(ctx: HandlerCtx, event: Extract<LiveEvent, { type: 'project.upserted' }>): boolean {
  const project = validProject(event.entity);
  if (!project) return false;
  const changed = writeProjects(ctx, (list) => applyProjectEvent(list, { type: 'project.upserted', project, version: event.version }));
  if (changed) {
    // A new project has zero tasks; its counts entry comes with it.
    ctx.queryClient.setQueryData<Counts>(queryKeys.counts(ctx.workspaceId), (counts) =>
      counts && !counts.projects?.[project.id] ? adjustCounts(counts, { projects: { [project.id]: {} } }) : counts,
    );
  }
  return changed;
}

/**
 * project.deleted: the project leaves the sidebar with its counts entry and cached task lists. A viewer of that
 * project is taken to the Inbox and told (prd.viewed_project_deleted).
 */
export function createProjectDeletedHandler(deps: ProjectLiveDeps) {
  return (ctx: HandlerCtx, event: Extract<LiveEvent, { type: 'project.deleted' }>): boolean => {
    const { id } = event.entity;
    const viewing = deps.currentProjectId() === id;
    markProjectGone(id);
    // Leave first, so the project view never renders without its project.
    if (viewing) deps.onViewedProjectDeleted(id);
    const changed = writeProjects(ctx, (list) => applyProjectEvent(list, { type: 'project.deleted', id, version: event.version }));
    ctx.queryClient.setQueryData<Counts>(queryKeys.counts(ctx.workspaceId), (counts) => adjustCounts(counts, { remove: [id] }));
    for (const key of projectListKeys(ctx, id)) ctx.queryClient.removeQueries({ queryKey: key, exact: true });
    refreshCounts(ctx);
    return changed || viewing;
  };
}

/** project.restored (someone's Undo): the project returns at its place; its tasks come with tasks.bulk. */
export function applyProjectRestored(ctx: HandlerCtx, event: Extract<LiveEvent, { type: 'project.restored' }>): boolean {
  const project = validProject(event.entity);
  if (!project) return false;
  unmarkProjectGone(project.id);
  const changed = writeProjects(ctx, (list) => applyProjectEvent(list, { type: 'project.restored', project, version: event.version }));
  refreshCounts(ctx);
  return changed;
}

/**
 * tasks.bulk from a project delete: the ids leave every loaded list at once (story 4's handler also refetches
 * them). Restores need the refetch, which story 4's handler does; counts refetch there too.
 */
export function applyProjectTasksBulk(ctx: HandlerCtx, event: Extract<LiveEvent, { type: 'tasks.bulk' }>): boolean {
  if (event.entity.deleted !== true) return false;
  const ids = new Set(event.entity.ids);
  let changed = false;
  for (const [key, list] of ctx.queryClient.getQueriesData<LocalTask[]>({ queryKey: queryKeys.tasks(ctx.workspaceId) })) {
    if (!list?.some((task) => ids.has(task.id))) continue;
    ctx.queryClient.setQueryData(
      key,
      list.filter((task) => !ids.has(task.id)),
    );
    changed = true;
  }
  return changed;
}

/**
 * task.upserted touching a project (created in one, or moved into or out of one): per-project numbers may
 * change for lists this tab has not loaded, so the counts are refetched. Inbox-only changes are counted exactly
 * by story 5/6's handler and need no request.
 */
export function refreshCountsOnTaskUpserted(ctx: HandlerCtx, event: Extract<LiveEvent, { type: 'task.upserted' }>): boolean {
  const projectId = (event.entity as { projectId?: unknown }).projectId;
  const cached = ctx.queryClient
    .getQueriesData<LocalTask[]>({ queryKey: queryKeys.tasks(ctx.workspaceId) })
    .flatMap(([, list]) => list ?? [])
    .find((task) => task.id === event.entity.id);
  if (typeof projectId === 'string' || cached?.projectId) refreshCounts(ctx);
  // Story 5/6's handler decides whether the event changed anything (stale events stay stale).
  return false;
}

/**
 * Adds the project handlers to story 4's registry (a Set per event type): they coexist with story 4/5/6/8
 * handlers for the same types and never replace them. Called once per workspace; returns the unregister
 * function, which removes only these handlers.
 */
export function registerProjectLiveHandlers(deps: ProjectLiveDeps): () => void {
  const unregister = [
    registerLiveHandler('project.upserted', applyProjectUpserted),
    registerLiveHandler('project.deleted', createProjectDeletedHandler(deps)),
    registerLiveHandler('project.restored', applyProjectRestored),
    registerLiveHandler('tasks.bulk', applyProjectTasksBulk),
    registerLiveHandler('task.upserted', refreshCountsOnTaskUpserted),
  ];
  return () => {
    for (const fn of unregister) fn();
  };
}
