/**
 * Tests may only ever run against the local environment. Called by every test harness at startup
 * (vitest pool-workers setup, Playwright global setup) so a misconfigured run fails before any test
 * can read or write staging or production data.
 */
export function assertLocalTestEnv(env: { ENVIRONMENT?: string }): void {
  if (env.ENVIRONMENT !== 'local') {
    throw new Error(`Refusing to run tests against ${env.ENVIRONMENT ?? 'an unknown environment (ENVIRONMENT is not set)'}`);
  }
}
