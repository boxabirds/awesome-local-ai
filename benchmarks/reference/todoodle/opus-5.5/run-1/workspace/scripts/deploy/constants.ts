export { DEPLOY_RETRY_ATTEMPTS } from '@todoodle/shared/limits';

export type DeployEnvironment = 'staging' | 'production';
export const DEPLOY_ENVIRONMENTS: readonly DeployEnvironment[] = ['staging', 'production'];

/**
 * SQL patterns known to be irreversible (or to force a table rebuild) on D1/SQLite.
 * Matched case-insensitively over raw SQL, comments included: a false positive blocks, which is the safe failure.
 */
export const DANGEROUS_MIGRATION_PATTERNS: readonly { pattern: string; regex: RegExp }[] = [
  { pattern: 'CHECK (', regex: /\bCHECK\s*\(/gi },
  { pattern: 'DROP TABLE', regex: /\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([`"[]?[\w.]+[`"\]]?)?/gi },
  { pattern: 'TRUNCATE TABLE', regex: /\bTRUNCATE\s+TABLE\b/gi },
  { pattern: 'ALTER TABLE .. MODIFY', regex: /\bALTER\s+TABLE\b[^;]*?\bMODIFY\b/gi },
  { pattern: 'ALTER TABLE .. CHANGE', regex: /\bALTER\s+TABLE\b[^;]*?\bCHANGE\b/gi },
  { pattern: 'ADD CONSTRAINT', regex: /\bADD\s+CONSTRAINT\b/gi },
  { pattern: 'DROP CONSTRAINT', regex: /\bDROP\s+CONSTRAINT\b/gi },
];

/** DROP TABLE of a table whose name ends with one of these is the safe end of a table-rebuild migration. */
export const TEMP_TABLE_SUFFIXES: readonly string[] = ['_new', '_old', '_temp', '_backup'];

export const DEPLOY_RETRY_BASE_DELAY_MS = 5000;
export const HEALTH_VERIFY_TIMEOUT_MS = 30_000;
export const HEALTH_VERIFY_INTERVAL_MS = 2000;

/** Public base URL of each environment (health is at `<base>/health`). Set once the domains exist. */
export const ENV_BASE_URLS: Record<DeployEnvironment, string> = {
  staging: 'https://staging.todoodle.app',
  production: 'https://todoodle.app',
};

export const DEPLOYMENT_LOG_PATH = 'docs/ops/deployment-log.csv';
export const DEPLOYMENT_LOG_HEADER = 'deploy_id,operator,environment,git_sha,timestamp,status,version';
export const MIGRATIONS_DIR = 'migrations';
export const RELEASE_BRANCH = 'main';
export const SEMVER_TAG = /^v\d+\.\d+\.\d+$/;
