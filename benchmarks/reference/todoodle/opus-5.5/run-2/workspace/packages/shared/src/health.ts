/** What every environment reports on /health. Shared by the Worker and the release tooling. */
export type Health = {
  status: 'ok';
  environment: string;
  version: string;
  git_sha: string;
  deployed_at: string | null;
};

/** The Worker vars health reads (a structural subset of the Worker's Env). */
export type HealthVars = {
  ENVIRONMENT?: string;
  APP_VERSION?: string;
  GIT_SHA?: string;
  DEPLOYED_AT?: string;
};

/** Pure: identity of the running environment. APP_VERSION/GIT_SHA/DEPLOYED_AT come from deploy. */
export function buildHealth(env: HealthVars): Health {
  return {
    status: 'ok',
    environment: env.ENVIRONMENT || 'local',
    version: env.APP_VERSION || 'dev',
    git_sha: env.GIT_SHA || 'dev',
    deployed_at: env.DEPLOYED_AT || null,
  };
}
