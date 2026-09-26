/**
 * Release metadata vars. Plain strings with no Workers types, so node-side tooling (deploy scripts,
 * Playwright setup) can share the health contract.
 */
export interface ReleaseVars {
  /** 'local' | 'staging' | 'production'. Absent means local. */
  ENVIRONMENT?: string;
  /** Injected at deploy time via `wrangler deploy --var`. */
  APP_VERSION?: string;
  GIT_SHA?: string;
  DEPLOYED_AT?: string;
}
