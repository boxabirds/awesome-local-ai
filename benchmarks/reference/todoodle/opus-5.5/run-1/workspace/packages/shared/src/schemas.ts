import { z } from 'zod';
import { WORKSPACE_NAME_MAX } from './limits.ts';

// No JIT: zod's `new Function` probe is reported as a CSP violation (default-src 'self'), and neither
// the browser under our CSP nor workerd may evaluate code anyway.
z.config({ jitless: true });

/** Public shape of a workspace. Never includes the secret or its hash. */
export const Workspace = z.object({
  id: z.string(),
  name: z.string(),
  version: z.number().int(),
  createdAt: z.string(),
});
export type Workspace = z.infer<typeof Workspace>;

/** The persisted columns `toPublicWorkspace` reads (a subset of the D1 row). */
export type WorkspaceRecord = {
  id: string;
  name: string;
  version: number;
  created_at: string;
};

/** Maps a stored row to the public shape. Only whitelisted fields are copied, so secret_hash can never leak. */
export function toPublicWorkspace(row: WorkspaceRecord): Workspace {
  return { id: row.id, name: row.name, version: row.version, createdAt: row.created_at };
}

export const RenameWorkspaceBody = z.object({
  name: z.string().trim().min(1).max(WORKSPACE_NAME_MAX),
});
export type RenameWorkspaceBody = z.infer<typeof RenameWorkspaceBody>;

export const OpenWorkspaceBody = z.object({ secret: z.string() });
export type OpenWorkspaceBody = z.infer<typeof OpenWorkspaceBody>;

export const CreateWorkspaceResponse = z.object({ workspace: Workspace, secret: z.string(), dropped: z.number().int() });
export type CreateWorkspaceResponse = z.infer<typeof CreateWorkspaceResponse>;

export const OpenWorkspaceResponse = z.object({ workspace: Workspace, dropped: z.number().int() });
export type OpenWorkspaceResponse = z.infer<typeof OpenWorkspaceResponse>;

export const WorkspaceResponse = z.object({ workspace: Workspace });
export type WorkspaceResponse = z.infer<typeof WorkspaceResponse>;

export const WorkspaceLinkResponse = z.object({ link: z.string() });
export type WorkspaceLinkResponse = z.infer<typeof WorkspaceLinkResponse>;

export const ErrorBody = z.object({ error: z.string(), message: z.string() });
export type ErrorBody = z.infer<typeof ErrorBody>;
