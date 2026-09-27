export { DEPLOY_RETRY_ATTEMPTS } from '@todoodle/shared/limits';

export type DeployEnv = 'staging' | 'production';

export type DangerousPattern = { name: string; regex: RegExp };

/**
 * Data changes known to be irreversible (or unsupported by SQLite without a table rebuild).
 * Matched case-insensitively over raw SQL, comments included: a false positive blocks, which is
 * the safe failure.
 */
export const DANGEROUS_MIGRATION_PATTERNS: readonly DangerousPattern[] = [
  { name: 'CHECK (', regex: /\bCHECK\s*\(/gi },
  { name: 'DROP TABLE', regex: /\bDROP\s+TABLE\b/gi },
  { name: 'TRUNCATE TABLE', regex: /\bTRUNCATE\s+TABLE\b/gi },
  { name: 'ALTER TABLE .. MODIFY', regex: /\bALTER\s+TABLE\b[^;]*?\bMODIFY\b/gi },
  { name: 'ALTER TABLE .. CHANGE', regex: /\bALTER\s+TABLE\b[^;]*?\bCHANGE\b/gi },
  { name: 'ADD CONSTRAINT', regex: /\bADD\s+CONSTRAINT\b/gi },
  { name: 'DROP CONSTRAINT', regex: /\bDROP\s+CONSTRAINT\b/gi },
];

/** DROP TABLE of a table with one of these suffixes is a routine rebuild step, not data loss. */
export const TEMP_TABLE_SUFFIXES: readonly string[] = ['_new', '_old', '_temp', '_backup'];

export const DEPLOY_RETRY_BASE_DELAY_MS = 5_000;
export const HEALTH_VERIFY_TIMEOUT_MS = 30_000;
export const HEALTH_VERIFY_INTERVAL_MS = 2_000;

/** Where each environment answers /health. Override with TODOODLE_<ENV>_URL. */
export const ENV_BASE_URLS: Record<DeployEnv, string> = {
  staging: process.env.TODOODLE_STAGING_URL ?? 'https://todoodle-staging.workers.dev',
  production: process.env.TODOODLE_PRODUCTION_URL ?? 'https://todoodle.workers.dev',
};

export const MIGRATIONS_DIR = 'migrations';
export const DEPLOYMENT_LOG_PATH = 'docs/ops/deployment-log.csv';
export const DEPLOYMENT_LOG_HEADER = 'deploy_id,operator,environment,git_sha,timestamp,status,version';
export const RELEASE_BRANCH = 'main';
export const SEMVER_TAG = /^v\d+\.\d+\.\d+$/;
