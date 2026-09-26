import { readFileSync } from 'node:fs';
import path from 'node:path';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';
import { assertLocalTestEnv } from './src/lib/test-guard.ts';

const root = path.resolve(import.meta.dirname, '../..');
const wranglerConfigPath = path.join(root, 'wrangler.toml');

/** ENVIRONMENT from the top-level [vars] of wrangler.toml (the base env; tests never use --env). */
function readBaseEnvironment(): string | undefined {
  const toml = readFileSync(wranglerConfigPath, 'utf8');
  const baseVars = toml.split(/^\[env\./m)[0]?.split(/^\[vars\]\s*$/m)[1]?.split(/^\[/m)[0] ?? '';
  return /^ENVIRONMENT\s*=\s*"([^"]*)"/m.exec(baseVars)?.[1];
}

const baseEnvironment = readBaseEnvironment();
// Guard on the node side too: never start the pool against a non-local base config.
assertLocalTestEnv({ ENVIRONMENT: baseEnvironment });

const migrations = await readD1Migrations(path.join(root, 'migrations'));

/**
 * Worker pool options. `simulate` overrides ENVIRONMENT (and version vars) inside Miniflare to
 * exercise staging/production behaviour. Everything still runs locally in workerd against the
 * base (local) wrangler config.
 */
function workersPool(simulate?: Record<string, string>) {
  return cloudflareTest({
    wrangler: { configPath: wranglerConfigPath },
    miniflare: {
      bindings: {
        TEST_MIGRATIONS: migrations,
        TEST_BASE_ENVIRONMENT: baseEnvironment ?? '',
        ...(simulate ? { ...simulate, TEST_SIMULATED_ENVIRONMENT: simulate.ENVIRONMENT ?? '' } : {}),
      },
    },
  });
}

const STAGING_SIMULATION = {
  ENVIRONMENT: 'staging',
  APP_VERSION: 'v1.2.0',
  GIT_SHA: '0123456789abcdef0123456789abcdef01234567',
  DEPLOYED_AT: '2026-09-25T12:34:56.000Z',
};

export default defineConfig({
  test: {
    globalSetup: [path.join(import.meta.dirname, 'test/global-setup.ts')],
    setupFiles: [path.join(import.meta.dirname, 'test/setup.ts')],
    projects: [
      {
        extends: true,
        plugins: [workersPool()],
        test: { name: 'api-unit', include: ['test/unit/**/*.test.ts'], root: import.meta.dirname },
      },
      {
        extends: true,
        plugins: [workersPool()],
        test: {
          name: 'api-integration',
          include: ['test/integration/**/*.test.ts'],
          exclude: ['**/*.staging.test.ts', '**/*.production.test.ts'],
          root: import.meta.dirname,
        },
      },
      {
        extends: true,
        plugins: [workersPool(STAGING_SIMULATION)],
        test: { name: 'api-staging-sim', include: ['test/integration/**/*.staging.test.ts'], root: import.meta.dirname },
      },
      {
        extends: true,
        plugins: [workersPool({ ENVIRONMENT: 'production' })],
        test: {
          name: 'api-production-gate',
          include: ['test/integration/**/*.production.test.ts'],
          root: import.meta.dirname,
        },
      },
    ],
  },
});
