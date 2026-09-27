import { CLIENT_HEADER, CLIENT_HEADER_VALUE } from '@todoodle/shared/limits';
import {
  type Counts,
  CountsSchema,
  type CreateTaskInput,
  CreateWorkspaceResponse,
  OpenWorkspaceResponse,
  type RememberedPublic,
  RememberedListResponse,
  type Task,
  type TaskList,
  TaskListResponse,
  TaskResponse,
  type Workspace,
  WorkspaceLinkResponse,
  WorkspaceResponse,
} from '@todoodle/shared/schemas';
import type { z } from 'zod';
import { canEditStore } from '@/features/live/canEdit';
import { CLIENT_ID_HEADER, clientId } from '@/features/live/clientId';
import { networkMonitor } from '@/features/live/network';
import { ApiError, GoneError, NetworkError, OfflineError } from './errors';

const MUTATION_HEADERS = { [CLIENT_HEADER]: CLIENT_HEADER_VALUE };

/** Workspace edits (anything but a read under /api/w/) are refused while editing is off. */
function isWorkspaceEdit(path: string, init?: RequestInit): boolean {
  return (init?.method ?? 'GET').toUpperCase() !== 'GET' && path.startsWith('/api/w/');
}

/**
 * fetch that turns failures into errors. While editing is off a workspace edit rejects with
 * OfflineError and sends nothing. A fetch that never gets an answer is a NetworkError and tells
 * NetworkMonitor (HTTP error statuses are answers, not offline). 410 is GoneError.
 */
async function send(path: string, init?: RequestInit): Promise<Response> {
  if (isWorkspaceEdit(path, init) && !canEditStore.getSnapshot()) throw new OfflineError();
  let res: Response;
  try {
    const headers = new Headers(init?.headers);
    headers.set(CLIENT_ID_HEADER, clientId);
    res = await fetch(path, { credentials: 'same-origin', ...init, headers });
  } catch (error) {
    if (error instanceof TypeError) {
      networkMonitor.reportNetworkFailure();
      throw new NetworkError();
    }
    throw new ApiError('network', 0);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
    if (res.status === 410) throw new GoneError();
    throw new ApiError(typeof body?.error === 'string' ? body.error : 'http_error', res.status);
  }
  return res;
}

async function request<S extends z.ZodType>(schema: S, path: string, init?: RequestInit): Promise<z.infer<S>> {
  const res = await send(path, init);
  const parsed = schema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) throw new ApiError('bad_response', res.status);
  return parsed.data;
}

function mutation(method: 'POST' | 'PATCH', body: unknown): RequestInit {
  return {
    method,
    headers: { ...MUTATION_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export type CreateResult = z.infer<typeof CreateWorkspaceResponse>;
export type OpenResult = z.infer<typeof OpenWorkspaceResponse>;

export function createWorkspace(): Promise<CreateResult> {
  return request(CreateWorkspaceResponse, '/api/workspaces', mutation('POST', {}));
}

/** The only request that ever carries the secret, in its body. */
export function openWorkspace(secret: string): Promise<OpenResult> {
  return request(OpenWorkspaceResponse, '/api/workspaces/open', mutation('POST', { secret }));
}

export async function getWorkspace(id: string): Promise<Workspace> {
  return (await request(WorkspaceResponse, `/api/w/${encodeURIComponent(id)}`)).workspace;
}

export async function renameWorkspace(id: string, name: string): Promise<Workspace> {
  return (await request(WorkspaceResponse, `/api/w/${encodeURIComponent(id)}`, mutation('PATCH', { name })))
    .workspace;
}

/** The full link, rebuilt by the server from this browser's own cookie entry. */
export async function getWorkspaceLink(id: string): Promise<string> {
  return (await request(WorkspaceLinkResponse, `/api/w/${encodeURIComponent(id)}/link`)).link;
}

/** Bodyless mutation (204 answers): only the CSRF header, no Content-Type. */
function bodyless(method: 'POST' | 'DELETE'): RequestInit {
  return { method, headers: MUTATION_HEADERS };
}

/** This browser's remembered workspaces, most recent first. Never includes secrets. */
export async function getRemembered(): Promise<RememberedPublic[]> {
  return (await request(RememberedListResponse, '/api/remembered')).workspaces;
}

/** Opening by id: moves the workspace to the front of this browser's list. 404 if not openable. */
export async function touchRemembered(id: string): Promise<void> {
  await send(`/api/remembered/${encodeURIComponent(id)}/touch`, bodyless('POST'));
}

/** Forgets the workspace on this browser only. */
export async function forgetRemembered(id: string): Promise<void> {
  await send(`/api/remembered/${encodeURIComponent(id)}`, bodyless('DELETE'));
}

/** The offline probe: resolves when Todoodle answers GET /api/health with 2xx, rejects otherwise. */
export async function health(): Promise<void> {
  const res = await fetch('/api/health', { cache: 'no-store', credentials: 'same-origin' });
  if (!res.ok) throw new ApiError('health', res.status);
}

/** Open tasks of one list, in list order. */
export async function listTasks(workspaceId: string, list: TaskList, signal?: AbortSignal): Promise<Task[]> {
  const path = `/api/w/${encodeURIComponent(workspaceId)}/tasks?list=${encodeURIComponent(list)}`;
  return (await request(TaskListResponse, path, { signal })).tasks;
}

/** Open-task counts per list. */
export function getCounts(workspaceId: string, signal?: AbortSignal): Promise<Counts> {
  return request(CountsSchema, `/api/w/${encodeURIComponent(workspaceId)}/counts`, { signal });
}

/**
 * Creates a task with a client-generated id. Idempotent: sending the same id again returns the
 * task that already exists (200), so a retry after a lost response never makes a duplicate.
 */
export async function createTask(workspaceId: string, input: CreateTaskInput, signal?: AbortSignal): Promise<Task> {
  const init = { ...mutation('POST', input), signal };
  return (await request(TaskResponse, `/api/w/${encodeURIComponent(workspaceId)}/tasks`, init)).task;
}
