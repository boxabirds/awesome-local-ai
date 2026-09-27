import {
  DEPLOY_RETRY_ATTEMPTS,
  DEPLOY_RETRY_BASE_DELAY_MS,
  type DeployEnv,
  DEPLOYMENT_LOG_PATH,
  ENV_BASE_URLS,
  HEALTH_VERIFY_INTERVAL_MS,
  HEALTH_VERIFY_TIMEOUT_MS,
  MIGRATIONS_DIR,
  RELEASE_BRANCH,
  SEMVER_TAG,
} from './constants';
import { fetchDeployedSha, shouldSkipRelease } from './idempotency';
import { type LogEntry, recordRelease, releaseStamp } from './record';
import { withRetry } from './retry';
import { applyScanPolicy, describeFinding, scanMigrations } from './safety-scan';
import type { ExecResult, FsLike, GitLike } from './types';
import { verifyHealth } from './verify';

export type DeployDeps = {
  exec: (cmd: string, args: string[]) => Promise<ExecResult>;
  fetch: typeof fetch;
  fs: FsLike;
  git: GitLike;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  log: (line: string) => void;
  isTTY: boolean;
  confirm: (q: string) => Promise<boolean>;
  /** Overrides for tests and unusual setups; defaults come from constants.ts. */
  config?: Partial<{
    baseUrl: string;
    migrationsDir: string;
    logPath: string;
    retryAttempts: number;
    retryBaseDelayMs: number;
    verifyTimeoutMs: number;
    verifyIntervalMs: number;
  }>;
};

export type ReleaseOutcome = 'success' | 'skipped' | 'blocked' | 'failed' | 'aborted';

/** A failure at a named step; everything after the prechecks turns into a 'failed' release. */
class StepError extends Error {
  constructor(
    readonly step: string,
    message: string,
  ) {
    super(message);
  }
}

function lastLine(text: string): string {
  return text.trim().split('\n').filter(Boolean).at(-1) ?? '';
}

async function run(deps: DeployDeps, step: string, cmd: string, args: string[]): Promise<ExecResult> {
  let result: ExecResult;
  try {
    result = await deps.exec(cmd, args);
  } catch (err) {
    throw new StepError(step, `${cmd} could not be started: ${(err as Error).message}`);
  }
  if (result.code !== 0) {
    throw new StepError(step, `${cmd} ${args.join(' ')} exited with ${result.code}: ${lastLine(result.stderr || result.stdout)}`);
  }
  return result;
}

/** Pending migration file names from `wrangler d1 migrations list` output. */
export function parsePendingMigrations(output: string): string[] {
  return [...new Set(output.match(/\b\d{4}_[\w.-]*?\.sql\b/g) ?? [])].sort();
}

/**
 * Releases HEAD to `env`: prechecks -> build -> scan pending migrations -> skip if already live ->
 * apply migrations -> publish (retried) -> verify /health -> tag and record. No automatic rollback.
 */
export async function runRelease(env: DeployEnv, deps: DeployDeps): Promise<ReleaseOutcome> {
  const cfg = {
    baseUrl: ENV_BASE_URLS[env],
    migrationsDir: MIGRATIONS_DIR,
    logPath: DEPLOYMENT_LOG_PATH,
    retryAttempts: DEPLOY_RETRY_ATTEMPTS,
    retryBaseDelayMs: DEPLOY_RETRY_BASE_DELAY_MS,
    verifyTimeoutMs: HEALTH_VERIFY_TIMEOUT_MS,
    verifyIntervalMs: HEALTH_VERIFY_INTERVAL_MS,
    ...deps.config,
  };
  const { log, git } = deps;
  const abort = (reason: string): ReleaseOutcome => {
    log(`✖ Release to ${env} aborted: ${reason}`);
    return 'aborted';
  };

  // Prechecks: nothing has been attempted yet, so aborts write no log row.
  let sha: string;
  let version: string;
  let operator: string;
  try {
    if (!(await git.isClean())) return abort('the working tree has uncommitted changes');
    sha = await git.headSha();
    const semverTag = (await git.tagsAtHead()).filter((t) => SEMVER_TAG.test(t)).sort().at(-1);
    if (env === 'production') {
      const branch = await git.currentBranch();
      if (branch !== RELEASE_BRANCH) {
        return abort(`production releases must come from ${RELEASE_BRANCH} (current branch: ${branch})`);
      }
      if (!semverTag) return abort('HEAD has no version tag (vX.Y.Z); tag the release first');
      if (!deps.isTTY) return abort('production releases need an interactive terminal to confirm');
      if (!(await deps.confirm(`Release ${semverTag} (${sha.slice(0, 7)}) to production? [y/N] `))) {
        return abort('not confirmed');
      }
    }
    version = semverTag ?? sha.slice(0, 7);
    operator = (await git.userName().catch(() => '')) || 'unknown';
  } catch (err) {
    return abort(`precheck failed: ${(err as Error).message}`);
  }

  const startedAt = new Date(deps.now()).toISOString();
  const entry = (status: LogEntry['status']): LogEntry => ({
    deployId: `${env}-${releaseStamp(startedAt)}`,
    operator,
    environment: env,
    gitSha: sha,
    timestamp: startedAt,
    status,
    version,
  });
  const record = async (status: LogEntry['status']) => {
    await recordRelease(entry(status), { fs: deps.fs, git, tag: status === 'success', logPath: cfg.logPath });
    log(`Recorded ${status} in ${cfg.logPath}`);
  };

  log(`Releasing ${version} (${sha}) to ${env} as ${operator}`);
  try {
    log('▸ Building');
    await run(deps, 'build', 'bun', ['run', 'build']);

    log('▸ Listing pending migrations');
    const listed = await run(deps, 'list migrations', 'wrangler', [
      'd1', 'migrations', 'list', 'DB', '--env', env, '--remote',
    ]);
    const pending = parsePendingMigrations(`${listed.stdout}\n${listed.stderr}`);
    const files = [];
    for (const name of pending) {
      try {
        files.push({ name, sql: await deps.fs.readFile(`${cfg.migrationsDir}/${name}`) });
      } catch (err) {
        throw new StepError('safety scan', `cannot read ${cfg.migrationsDir}/${name}: ${(err as Error).message}`);
      }
    }

    const findings = scanMigrations(files);
    const policy = applyScanPolicy(env, findings);
    if (policy === 'block') {
      for (const f of findings) log(`✖ Irreversible change: ${describeFinding(f)}`);
      log(`✖ Production release refused: ${findings.map((f) => f.file).filter((f, i, a) => a.indexOf(f) === i).join(', ')} contains irreversible data changes`);
      await record('blocked');
      return 'blocked';
    }
    if (policy === 'warn') {
      for (const f of findings) log(`⚠ Warning: irreversible change in ${describeFinding(f)} (continuing: staging)`);
    } else {
      log(`✔ Safety scan: ${pending.length} pending migration(s), no irreversible changes`);
    }

    const deployedSha = await fetchDeployedSha(cfg.baseUrl, deps.fetch);
    if (shouldSkipRelease({ deployedSha, targetSha: sha, pendingMigrations: pending.length })) {
      log(`✔ Already deployed: ${env} is serving ${sha} with no pending migrations. Nothing to do.`);
      await record('skipped');
      return 'skipped';
    }

    if (pending.length > 0) {
      log(`▸ Applying ${pending.length} migration(s): ${pending.join(', ')}`);
      await run(deps, 'apply migrations', 'wrangler', [
        'd1', 'migrations', 'apply', 'DB', '--env', env, '--remote',
      ]);
    }

    const deployedAt = new Date(deps.now()).toISOString();
    log('▸ Publishing');
    try {
      await withRetry(
        () =>
          run(deps, 'publish', 'wrangler', [
            'deploy', '--env', env,
            '--var', `APP_VERSION:${version}`,
            '--var', `GIT_SHA:${sha}`,
            '--var', `DEPLOYED_AT:${deployedAt}`,
          ]),
        {
          attempts: cfg.retryAttempts,
          baseDelayMs: cfg.retryBaseDelayMs,
          sleep: deps.sleep,
          onAttempt: (n, err) =>
            log(
              err === undefined
                ? `  publish attempt ${n}/${cfg.retryAttempts} succeeded`
                : `  publish attempt ${n}/${cfg.retryAttempts} failed: ${(err as Error).message}`,
            ),
        },
      );
    } catch (err) {
      throw new StepError('publish', `all ${cfg.retryAttempts} attempts failed (${(err as Error).message})`);
    }

    log(`▸ Waiting for ${cfg.baseUrl}/health to report ${sha}`);
    const verified = await verifyHealth({
      baseUrl: cfg.baseUrl,
      expectedSha: sha,
      env,
      timeoutMs: cfg.verifyTimeoutMs,
      intervalMs: cfg.verifyIntervalMs,
      fetch: deps.fetch,
      sleep: deps.sleep,
      now: deps.now,
    });
    if (!verified.ok) throw new StepError('verify health', verified.message);

    await record('success');
    log(`✔ ${env} is live: version ${version}, revision ${sha}`);
    return 'success';
  } catch (err) {
    const step = err instanceof StepError ? err.step : 'release';
    log(`✖ Release to ${env} failed at step "${step}": ${(err as Error).message}`);
    log('  No automatic rollback was attempted.');
    try {
      await record('failed');
    } catch (recordErr) {
      log(`✖ Could not record the failure: ${(recordErr as Error).message}`);
    }
    return 'failed';
  }
}
