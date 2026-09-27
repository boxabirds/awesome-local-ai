import { applyD1Migrations, env } from 'cloudflare:test';
import { beforeEach } from 'vitest';
import { assertLocalTestEnv } from '../src/lib/test-guard';

// The production-gate project deliberately sets ENVIRONMENT=production inside Miniflare to
// prove test routes vanish there. It is still local (same base wrangler config, local D1), which
// it declares through TEST_SIMULATED_ENVIRONMENT; anything else must be exactly 'local'.
const simulated = env.TEST_SIMULATED_ENVIRONMENT;
assertLocalTestEnv(
  simulated !== undefined && env.ENVIRONMENT === simulated ? { ENVIRONMENT: 'local' } : env,
);

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

// vitest-pool-workers 0.2x dropped `isolatedStorage`, so per-test isolation is done here:
// before every test, D1 is put back to its freshly-migrated state (tables created by earlier
// tests dropped, rows in migrated tables deleted).
const INTERNAL_TABLE = /^(sqlite_|_cf_|d1_migrations$)/;

async function userTables(): Promise<string[]> {
  const { results } = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table'",
  ).all<{ name: string }>();
  return results.map((r) => r.name).filter((name) => !INTERNAL_TABLE.test(name));
}

const migratedTables = new Set(await userTables());

beforeEach(async () => {
  const statements = [env.DB.prepare('PRAGMA defer_foreign_keys = ON')];
  for (const name of await userTables()) {
    const quoted = `"${name.replaceAll('"', '""')}"`;
    statements.push(
      env.DB.prepare(migratedTables.has(name) ? `DELETE FROM ${quoted}` : `DROP TABLE ${quoted}`),
    );
  }
  await env.DB.batch(statements);
});
