export interface Env {
  /** Room registry and round history. Optional: rooms work without it. */
  DB?: D1Database;
  POKER_ROOM: DurableObjectNamespace;
  /** Static SPA assets, bound by Workers Static Assets. */
  ASSETS: Fetcher;

  ENVIRONMENT: "local" | "staging" | "production";
  APP_VERSION: string;
  GIT_SHA: string;
  DEPLOYED_AT: string;
  /** Origin allowed to call the API cross-origin. Same-origin needs no value. */
  WEB_APP_URL?: string;
}
