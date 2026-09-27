import { CLIENT_HEADER_NAME, CLIENT_HEADER_VALUE, CLIENT_ID_HEADER_NAME } from '@todoodle/shared/limits';
import {
  type Counts,
  CountsSchema,
  type CreateProjectInput,
  type CreateTaskInput,
  CreateWorkspaceResponse,
  DeleteProjectResponse,
  type Project,
  ProjectListResponse,
  ProjectResponse,
  RestoreProjectResponse,
  type UpdateProjectInput,
  OpenWorkspaceResponse,
  RememberedListResponse,
  type RememberedPublic,
  type Task,
  type TaskPatch,
  TaskListResponse,
  TaskResponse,
  type RescheduleRequest,
  type RescheduleResponse,
  type RestoreDueDateItem,
  type RestoreDueDatesResponse,
  type TodayResponse,
  rescheduleResponseSchema,
  restoreDueDatesResponseSchema,
  todayResponseSchema,
  type Workspace,
  WorkspaceLinkResponse,
  WorkspaceResponse,
} from '@todoodle/shared/schemas';
import { z } from 'zod';
import { clientId } from '@/features/live/clientId';
import { ApiError, GoneError, NetworkError, OfflineError } from './errors';
import type { ListScope } from './queryKeys';

export { ApiError, GoneError, NetworkError, OfflineError } from './errors';

/**
 * Connectivity hooks, installed by the live feature (story 4) so this module imports nothing from it:
 * `canMutate` is the edit gate (false while offline), `onNetworkFailure` tells the NetworkMonitor.
 */
type ConnectivityHooks = { canMutate(): boolean; onNetworkFailure(): void };
const connectivity: ConnectivityHooks = { canMutate: () => true, onNetworkFailure: () => {} };

export function setConnectivityHooks(hooks: Partial<ConnectivityHooks>): void {
  Object.assign(connectivity, hooks);
}

/** True for 'this workspace does not exist' (404, or 400 from a malformed open request). */
export function isNotFoundError(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 400);
}

export type ApiRequestInit = {
  method?: string;
  json?: unknown;
  /** A workspace edit: rejected with OfflineError, sending nothing, while editing is disabled. */
  edit?: boolean;
  /** The health probe itself must not report failures (it is how the monitor learns we are back). */
  probe?: boolean;
  /** Aborts the request (e.g. a timeout); an abort surfaces as NetworkError. */
  signal?: AbortSignal;
};

/**
 * The one fetch wrapper. Exported for stories 5 to 8 (and their tests): maps 410 to GoneError, network
 * failures to NetworkError, and rejects `edit` calls with OfflineError while editing is disabled.
 */
export async function request<T>(schema: z.ZodType<T>, path: string, init: ApiRequestInit = {}): Promise<T> {
  if (init.edit && !connectivity.canMutate()) throw new OfflineError();
  const headers: Record<string, string> = { [CLIENT_ID_HEADER_NAME]: clientId };
  const method = init.method ?? 'GET';
  if (method !== 'GET') headers[CLIENT_HEADER_NAME] = CLIENT_HEADER_VALUE;
  if (init.json !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: init.json === undefined ? undefined : JSON.stringify(init.json),
      credentials: 'same-origin',
      signal: init.signal,
      ...(init.probe ? { cache: 'no-store' as const } : {}),
    });
  } catch {
    // Network-level failure (a TypeError from fetch). HTTP error statuses never mean offline.
    if (!init.probe) connectivity.onNetworkFailure();
    throw new NetworkError();
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Non-JSON body: handled below by status.
  }
  if (res.status === 410) throw new GoneError();
  if (!res.ok) {
    const code = typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string' ? body.error : 'unknown';
    throw new ApiError(code, res.status);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError('bad_response', res.status);
  return parsed.data;
}

export function createWorkspace(): Promise<CreateWorkspaceResponse> {
  return request(CreateWorkspaceResponse, '/api/workspaces', { method: 'POST', json: {} });
}

/** The only request that ever carries the secret, and only in its body. */
export function openWorkspace(secret: string): Promise<OpenWorkspaceResponse> {
  return request(OpenWorkspaceResponse, '/api/workspaces/open', { method: 'POST', json: { secret } });
}

export async function getWorkspace(id: string): Promise<Workspace> {
  return (await request(WorkspaceResponse, `/api/w/${encodeURIComponent(id)}`)).workspace;
}

/** Whether this browser can still open the workspace: false on 404, rejects on any other failure. */
export async function workspaceExists(id: string): Promise<boolean> {
  try {
    await getWorkspace(id);
    return true;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return false;
    throw error;
  }
}

export async function renameWorkspace(id: string, name: string): Promise<Workspace> {
  return (await request(WorkspaceResponse, `/api/w/${encodeURIComponent(id)}`, { method: 'PATCH', json: { name }, edit: true }))
    .workspace;
}

/** Only called on an explicit user action (Share panel, Bookmark, banner Copy) on the /w/:id route. */
export async function getWorkspaceLink(id: string): Promise<string> {
  return (await request(WorkspaceLinkResponse, `/api/w/${encodeURIComponent(id)}/link`)).link;
}

/** GET /api/health with no-store: the offline probe. Resolves when Todoodle answers 2xx. */
export async function health(): Promise<void> {
  await request(z.unknown(), '/api/health', { probe: true });
}

/** Bodyless responses (204): nothing to parse. */
const NoContent = z.unknown();

/** This browser's remembered workspaces (never secrets), most recently opened first. */
export async function getRemembered(): Promise<RememberedPublic[]> {
  return (await request(RememberedListResponse, '/api/remembered')).workspaces;
}

/** Open by id: moves the workspace to the front of this browser's list. 404 when it is not remembered. */
export async function touchRemembered(id: string): Promise<void> {
  await request(NoContent, `/api/remembered/${encodeURIComponent(id)}/touch`, { method: 'POST' });
}

/** Forget on this browser only. Idempotent; the workspace itself is untouched. */
export async function forgetRemembered(id: string): Promise<void> {
  await request(NoContent, `/api/remembered/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------- story 5: tasks

/**
 * One list's open tasks in order, then (includeCompleted) its completed tasks, most recent first. Story 7:
 * a project list sends its projectId.
 */
export async function listTasks(workspaceId: string, filter: ListScope & { includeCompleted?: boolean }): Promise<Task[]> {
  const scope = filter.list === 'project' ? `list=project&projectId=${encodeURIComponent(filter.projectId)}` : `list=${filter.list}`;
  const query = `${scope}${filter.includeCompleted ? '&include_completed=true' : ''}`;
  return (await request(TaskListResponse, `/api/w/${encodeURIComponent(workspaceId)}/tasks?${query}`)).tasks;
}

/** Open-task counts per list (the sidebar badges). Story 8: the viewer's local date adds `today`. */
export function getCounts(workspaceId: string, date?: string): Promise<Counts> {
  const query = date === undefined ? '' : `?date=${encodeURIComponent(date)}`;
  return request(CountsSchema, `/api/w/${encodeURIComponent(workspaceId)}/counts${query}`);
}

/**
 * Idempotent create: the id is generated by the client, so sending the same body again (Retry after a
 * lost response) never makes a duplicate. 201 and 200 both resolve with the stored task.
 */
export async function createTask(workspaceId: string, input: CreateTaskInput, signal?: AbortSignal): Promise<Task> {
  const path = `/api/w/${encodeURIComponent(workspaceId)}/tasks`;
  return (await request(TaskResponse, path, { method: 'POST', json: input, edit: true, signal })).task;
}

// ---------------------------------------------------------------- story 6: lifecycle and edit
// Lifecycle calls are bodyless POSTs (the client header is enough). All are workspace edits.

function taskPath(workspaceId: string, taskId: string): string {
  return `/api/w/${encodeURIComponent(workspaceId)}/tasks/${encodeURIComponent(taskId)}`;
}

export async function completeTask(workspaceId: string, taskId: string): Promise<Task> {
  return (await request(TaskResponse, `${taskPath(workspaceId, taskId)}/complete`, { method: 'POST', edit: true })).task;
}

export async function reopenTask(workspaceId: string, taskId: string): Promise<Task> {
  return (await request(TaskResponse, `${taskPath(workspaceId, taskId)}/reopen`, { method: 'POST', edit: true })).task;
}

/** Undo of a delete. The server accepts it at any time; the 10 s window is the UI's. */
export async function restoreTask(workspaceId: string, taskId: string): Promise<Task> {
  return (await request(TaskResponse, `${taskPath(workspaceId, taskId)}/restore`, { method: 'POST', edit: true })).task;
}

/** Soft delete (204). There is never a confirmation: Undo (restoreTask) is the safeguard. */
export async function deleteTask(workspaceId: string, taskId: string): Promise<void> {
  await request(NoContent, taskPath(workspaceId, taskId), { method: 'DELETE', edit: true });
}

export async function updateTask(workspaceId: string, taskId: string, patch: TaskPatch): Promise<Task> {
  return (await request(TaskResponse, taskPath(workspaceId, taskId), { method: 'PATCH', json: patch, edit: true })).task;
}

// ---------------------------------------------------------------- story 7: projects

function projectsPath(workspaceId: string, projectId?: string): string {
  const base = `/api/w/${encodeURIComponent(workspaceId)}/projects`;
  return projectId === undefined ? base : `${base}/${encodeURIComponent(projectId)}`;
}

/** The workspace's active projects, in creation order. */
export async function listProjects(workspaceId: string): Promise<Project[]> {
  return (await request(ProjectListResponse, projectsPath(workspaceId))).projects;
}

/** Idempotent create (client-generated id): 201 and 200 (a replay) both resolve with the stored project. */
export async function createProject(workspaceId: string, input: CreateProjectInput): Promise<Project> {
  return (await request(ProjectResponse, projectsPath(workspaceId), { method: 'POST', json: input, edit: true })).project;
}

export async function updateProject(workspaceId: string, projectId: string, patch: UpdateProjectInput): Promise<Project> {
  return (await request(ProjectResponse, projectsPath(workspaceId, projectId), { method: 'PATCH', json: patch, edit: true })).project;
}

/** Deletes the project and all its tasks; the batchId is what Undo sends back. */
export function deleteProject(workspaceId: string, projectId: string): Promise<DeleteProjectResponse> {
  return request(DeleteProjectResponse, projectsPath(workspaceId, projectId), { method: 'DELETE', edit: true });
}

/** Undo of deleteProject: restores the project and exactly the tasks that deletion removed. */
export function restoreProject(workspaceId: string, projectId: string, batchId: string): Promise<RestoreProjectResponse> {
  return request(RestoreProjectResponse, `${projectsPath(workspaceId, projectId)}/restore`, { method: 'POST', json: { batchId }, edit: true });
}

/** Moves a task to a project, or to the Inbox (null). Name, completion and due date are untouched. */
export function moveTask(workspaceId: string, taskId: string, projectId: string | null): Promise<Task> {
  return updateTask(workspaceId, taskId, { projectId });
}

// ---------------------------------------------------------------- story 8: Today, reschedule, undo

/** The viewer's Today: overdue and today tasks (and completed ones due today, with includeCompleted). */
export function getToday(workspaceId: string, params: { date: string; includeCompleted: boolean }): Promise<TodayResponse> {
  const query = `date=${encodeURIComponent(params.date)}${params.includeCompleted ? '&includeCompleted=1' : ''}`;
  return request(todayResponseSchema, `/api/w/${encodeURIComponent(workspaceId)}/today?${query}`);
}

/** Moves exactly these overdue tasks to the viewer's date `to`; the server skips any no longer overdue. */
export function rescheduleTasks(workspaceId: string, body: RescheduleRequest): Promise<RescheduleResponse> {
  return request(rescheduleResponseSchema, `/api/w/${encodeURIComponent(workspaceId)}/tasks/reschedule`, { method: 'POST', json: body, edit: true });
}

/** Undo of rescheduleTasks: each date goes back only while the task is still at the version the reschedule left. */
export function restoreDueDates(workspaceId: string, items: RestoreDueDateItem[]): Promise<RestoreDueDatesResponse> {
  return request(restoreDueDatesResponseSchema, `/api/w/${encodeURIComponent(workspaceId)}/tasks/due-dates/restore`, {
    method: 'POST',
    json: { items },
    edit: true,
  });
}
