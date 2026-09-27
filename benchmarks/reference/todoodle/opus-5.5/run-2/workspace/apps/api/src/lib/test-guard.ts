/**
 * Refuses to let any automated test run against a real environment.
 * Tests may only run when ENVIRONMENT is exactly 'local'.
 */
export function assertLocalTestEnv(env: { ENVIRONMENT?: string }): void {
  if (env.ENVIRONMENT !== 'local') {
    throw new Error(`Refusing to run tests against ${env.ENVIRONMENT ?? 'an unknown environment'}`);
  }
}
