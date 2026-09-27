export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ENVIRONMENT?: string;
  APP_VERSION?: string;
  GIT_SHA?: string;
  DEPLOYED_AT?: string;
}
