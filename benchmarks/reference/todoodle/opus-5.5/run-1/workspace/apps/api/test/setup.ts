import { applyD1Migrations, env, reset } from 'cloudflare:test';
import { beforeEach } from 'vitest';
import { assertLocalTestEnv } from '../src/lib/test-guard.ts';

// The base (wrangler.toml) environment must always be local. Projects that simulate
// staging/production override ENVIRONMENT inside Miniflare only; all other projects must see local.
assertLocalTestEnv({ ENVIRONMENT: env.TEST_BASE_ENVIRONMENT });
if (!env.TEST_SIMULATED_ENVIRONMENT) assertLocalTestEnv(env);

// Isolated storage per test: wipe every binding, then bring the schema back.
beforeEach(async () => {
  await reset();
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
