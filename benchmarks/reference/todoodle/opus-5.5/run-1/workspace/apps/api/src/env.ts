import type { WorkspaceRow } from './db/workspaces.ts';
import type { RememberedEntry } from './lib/cookie.ts';
import type { WorkspaceRoom } from './live/WorkspaceRoom.ts';
import type { ReleaseVars } from './release-vars.ts';

export interface Env extends ReleaseVars {
  DB: D1Database;
  ASSETS: Fetcher;
  /** Story 4: one live room per workspace (idFromName(workspaceId)). */
  WORKSPACE_ROOM: DurableObjectNamespace<WorkspaceRoom>;
}

/** Per-request values set by middleware (Hono Variables). */
export type Variables = {
  requestId: string;
  /** Set by workspace-auth on /api/w/:workspaceId routes once the cookie secret is verified. */
  workspace: WorkspaceRow;
  /** The verified cookie entry for that workspace (its secret rebuilds the link). */
  rememberedEntry: RememberedEntry;
};
