import type { ReleaseVars } from './release-vars.ts';

export interface Env extends ReleaseVars {
  DB: D1Database;
  ASSETS: Fetcher;
}
