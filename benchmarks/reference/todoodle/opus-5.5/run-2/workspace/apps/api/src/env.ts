import type { WorkspaceRow } from './db/workspaces';
import type { RememberedEntry } from './lib/cookie';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ENVIRONMENT?: string;
  APP_VERSION?: string;
  GIT_SHA?: string;
  DEPLOYED_AT?: string;
}

/** Per-request values set by middleware (Hono Variables). */
export type AppVariables = {
  requestId: string;
  /** The verified workspace, set by workspace-auth on /api/w/:workspaceId routes. */
  workspace: WorkspaceRow;
  /** The verified cookie entry for that workspace, set by workspace-auth. */
  rememberedEntry: RememberedEntry;
};
