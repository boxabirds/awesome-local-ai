import { CLIENT_HEADER, CLIENT_HEADER_VALUE } from '@todoodle/shared/limits';
import {
  CreateWorkspaceResponse,
  OpenWorkspaceResponse,
  type RememberedPublic,
  RememberedListResponse,
  type Workspace,
  WorkspaceLinkResponse,
  WorkspaceResponse,
} from '@todoodle/shared/schemas';
import type { z } from 'zod';

/**
 * A failed API call. Carries only the error code and HTTP status (0 for network failures):
 * never the request body, URL fragment or any secret.
 */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(`API request failed: ${code} (${status})`);
    this.name = 'ApiError';
  }
}

/** True for answers that mean "no such workspace" (404, or 400 for a malformed open request). */
export function isNotFoundError(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 400);
}

const MUTATION_HEADERS = { [CLIENT_HEADER]: CLIENT_HEADER_VALUE };

/** fetch that turns network failures and non-2xx answers into ApiError. */
async function send(path: string, init?: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(path, { credentials: 'same-origin', ...init });
  } catch {
    throw new ApiError('network', 0);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
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
