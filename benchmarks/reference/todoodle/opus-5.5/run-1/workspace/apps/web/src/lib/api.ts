import { CLIENT_HEADER_NAME, CLIENT_HEADER_VALUE, CLIENT_ID_HEADER_NAME } from '@todoodle/shared/limits';
import {
  CreateWorkspaceResponse,
  OpenWorkspaceResponse,
  RememberedListResponse,
  type RememberedPublic,
  type Workspace,
  WorkspaceLinkResponse,
  WorkspaceResponse,
} from '@todoodle/shared/schemas';
import { z } from 'zod';
import { clientId } from '@/features/live/clientId';
import { ApiError, GoneError, NetworkError, OfflineError } from './errors';

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
