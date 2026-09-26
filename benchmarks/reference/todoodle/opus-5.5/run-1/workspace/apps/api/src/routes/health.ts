import type { Context } from 'hono';
import type { ReleaseVars } from '../release-vars.ts';

export type Health = {
  status: 'ok';
  environment: string;
  version: string;
  git_sha: string;
  deployed_at: string | null;
};

/** Version metadata is injected at deploy time (`wrangler deploy --var`); local runs fall back to dev values. */
export function buildHealth(env: Pick<ReleaseVars, 'ENVIRONMENT' | 'APP_VERSION' | 'GIT_SHA' | 'DEPLOYED_AT'>): Health {
  return {
    status: 'ok',
    environment: env.ENVIRONMENT || 'local',
    version: env.APP_VERSION || 'dev',
    git_sha: env.GIT_SHA || 'dev',
    deployed_at: env.DEPLOYED_AT || null,
  };
}

/** GET /health and GET /api/health. Never touches D1, so it answers even while migrations run. */
export const healthHandler = (c: Context<{ Bindings: ReleaseVars }>) => c.json(buildHealth(c.env));
