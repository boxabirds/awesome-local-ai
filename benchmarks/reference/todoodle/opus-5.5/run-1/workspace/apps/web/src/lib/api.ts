import { CLIENT_HEADER_NAME, CLIENT_HEADER_VALUE } from '@todoodle/shared/limits';
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

/**
 * A failed API call. Carries only the error code and HTTP status (0 for a network failure):
 * never the request body, URL or secret, so it is safe to show or report.
 */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number) {
    super(`API error ${status} ${code}`);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

/** True for 'this workspace does not exist' (404, or 400 from a malformed open request). */
export function isNotFoundError(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 400);
}

async function request<T>(schema: z.ZodType<T>, path: string, init: { method?: string; json?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {};
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
    });
  } catch {
    throw new ApiError('network', 0);
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Non-JSON body: handled below by status.
  }
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

export async function renameWorkspace(id: string, name: string): Promise<Workspace> {
  return (await request(WorkspaceResponse, `/api/w/${encodeURIComponent(id)}`, { method: 'PATCH', json: { name } })).workspace;
}

/** Only called on an explicit user action (Share panel, Bookmark, banner Copy) on the /w/:id route. */
export async function getWorkspaceLink(id: string): Promise<string> {
  return (await request(WorkspaceLinkResponse, `/api/w/${encodeURIComponent(id)}/link`)).link;
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
