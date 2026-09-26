import {
  DEPLOY_RETRY_ATTEMPTS,
  DEPLOY_RETRY_BASE_DELAY_MS,
  type DeployEnvironment,
  ENV_BASE_URLS,
  HEALTH_VERIFY_INTERVAL_MS,
  HEALTH_VERIFY_TIMEOUT_MS,
  MIGRATIONS_DIR,
  RELEASE_BRANCH,
  SEMVER_TAG,
} from './constants.ts';
import { fetchDeployedSha, shouldSkipRelease } from './idempotency.ts';
import { type ReleaseStatus, deployStamp, recordRelease } from './record.ts';
import { withRetry } from './retry.ts';
import { applyScanPolicy, describeFinding, scanMigrations } from './safety-scan.ts';
import type { FetchLike, FsLike, GitLike } from './types.ts';
import { verifyHealth } from './verify.ts';

export type ExecResult = { code: number; stdout: string; stderr: string };

export type DeployDeps = {
  exec: (cmd: string, args: string[]) => Promise<ExecResult>;
  fetch: FetchLike;
  fs: FsLike;
  git: GitLike;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  log: (line: string) => void;
  isTTY: boolean;
  confirm: (q: string) => Promise<boolean>;
  /** Overrides ENV_BASE_URLS[env] (used by tests to point at a local health server). */
  baseUrl?: string;
};

export type ReleaseOutcome = ReleaseStatus | 'aborted';

class StepFailed extends Error {
  constructor(
    readonly step: string,
    detail: string,
  ) {
    super(detail);
  }
}

function lastLines(text: string, n = 5): string {
  return text.trim().split('\n').slice(-n).join('\n');
}

/** Pending migration file names from `wrangler d1 migrations list` output (table or "No migrations"). */
export function parsePendingMigrations(output: string): string[] {
  return [...new Set(output.match(/\b\d{4}_[\w.-]+?\.sql\b/g) ?? [])].sort();
}

/**
 * Releases HEAD to an environment. Every attempted release (blocked, skipped, failed, success) is
 * recorded in the deployment log; precheck failures abort before anything is attempted and record nothing.
 * There is no automatic rollback.
 */
export async function runRelease(env: DeployEnvironment, deps: DeployDeps): Promise<ReleaseOutcome> {
  const { log, git } = deps;
  const run = async (step: string, cmd: string, args: string[]) => {
    const result = await deps.exec(cmd, args);
    if (result.code !== 0) {
      throw new StepFailed(step, `\`${cmd} ${args.join(' ')}\` exited with ${result.code}\n${lastLines(result.stderr || result.stdout)}`);
    }
    return result;
  };

  // ---- Prechecks: abort without recording anything.
  log(`Releasing to ${env}`);
  if (!(await git.isClean())) {
    log('Aborted: the working tree has uncommitted changes. Commit or stash them first.');
    return 'aborted';
  }
  const sha = await git.headSha();
  const semverTag = (await git.tagsAtHead()).find((t) => SEMVER_TAG.test(t));
  if (env === 'production') {
    const branch = await git.currentBranch();
    if (branch !== RELEASE_BRANCH) {
      log(`Aborted: production releases must come from ${RELEASE_BRANCH} (currently on ${branch}).`);
      return 'aborted';
    }
    if (!semverTag) {
      log('Aborted: production releases need a semver tag (vX.Y.Z) at HEAD.');
      return 'aborted';
    }
    if (!deps.isTTY) {
      log('Aborted: production releases must be confirmed in an interactive terminal.');
      return 'aborted';
    }
    if (!(await deps.confirm(`Release ${semverTag} (${sha.slice(0, 7)}) to production?`))) {
      log('Aborted: not confirmed.');
      return 'aborted';
    }
  }

  const version = semverTag ?? sha.slice(0, 7);
  const releasedAt = new Date(deps.now()).toISOString();
  const operator = (await git.userName()).trim() || 'unknown';
  const baseUrl = deps.baseUrl ?? ENV_BASE_URLS[env];
  const record = (status: ReleaseStatus) =>
    recordRelease(
      { deployId: `${env}-${deployStamp(releasedAt)}`, operator, environment: env, gitSha: sha, timestamp: releasedAt, status, version },
      { fs: deps.fs, git, tag: status === 'success', log },
    );
  log(`Version ${version}, revision ${sha}, operator ${operator}`);

  try {
    log('Building...');
    await run('build', 'bun', ['run', 'build']);

    log('Checking pending migrations...');
    const list = await run('list migrations', 'wrangler', ['d1', 'migrations', 'list', 'DB', '--env', env, '--remote']);
    const pending = parsePendingMigrations(list.stdout);
    log(pending.length === 0 ? 'No pending migrations.' : `Pending migrations: ${pending.join(', ')}`);

    const files = [];
    for (const name of pending) {
      try {
        files.push({ name, sql: await deps.fs.readFile(`${MIGRATIONS_DIR}/${name}`) });
      } catch (err) {
        throw new StepFailed('safety scan', `cannot read ${MIGRATIONS_DIR}/${name}: ${(err as Error).message}`);
      }
    }
    const findings = scanMigrations(files);
    const policy = applyScanPolicy(env, findings);
    if (policy === 'block') {
      log(`Safety scan: BLOCKED. Irreversible data changes cannot be released to production:`);
      for (const f of findings) log(`  ${describeFinding(f)}`);
      await record('blocked');
      return 'blocked';
    }
    if (policy === 'warn') {
      log(`Safety scan: WARNING. Irreversible data changes will be released to ${env}:`);
      for (const f of findings) log(`  ${describeFinding(f)}`);
    } else {
      log('Safety scan: ok.');
    }

    const deployedSha = await fetchDeployedSha(baseUrl, deps.fetch);
    if (shouldSkipRelease({ deployedSha, targetSha: sha, pendingMigrations: pending.length })) {
      log(`${env} is already deployed at ${version} (${sha}). Nothing to do.`);
      await record('skipped');
      return 'skipped';
    }

    if (pending.length > 0) {
      log('Applying migrations...');
      await run('apply migrations', 'wrangler', ['d1', 'migrations', 'apply', 'DB', '--env', env, '--remote']);
    }

    const deployArgs = [
      'deploy',
      '--env', env,
      '--var', `APP_VERSION:${version}`,
      '--var', `GIT_SHA:${sha}`,
      '--var', `DEPLOYED_AT:${releasedAt}`,
    ];
    try {
      await withRetry(() => run('publish', 'wrangler', deployArgs), {
        attempts: DEPLOY_RETRY_ATTEMPTS,
        baseDelayMs: DEPLOY_RETRY_BASE_DELAY_MS,
        sleep: deps.sleep,
        onAttempt: (n, err) =>
          log(`Publish attempt ${n}/${DEPLOY_RETRY_ATTEMPTS}: ${err ? `failed\n${(err as Error).message}` : 'ok'}`),
      });
    } catch (err) {
      throw new StepFailed('publish', `all ${DEPLOY_RETRY_ATTEMPTS} attempts failed: ${(err as Error).message}`);
    }

    log(`Verifying ${baseUrl}/health reports ${sha}...`);
    const verified = await verifyHealth({
      baseUrl,
      expectedSha: sha,
      env,
      timeoutMs: HEALTH_VERIFY_TIMEOUT_MS,
      intervalMs: HEALTH_VERIFY_INTERVAL_MS,
      fetch: deps.fetch,
      sleep: deps.sleep,
      now: deps.now,
    });
    if (!verified.ok) throw new StepFailed('verify health', verified.message);

    await record('success');
    log(`Released: ${env} is live with version ${version}, revision ${sha}.`);
    return 'success';
  } catch (err) {
    const step = err instanceof StepFailed ? err.step : 'release';
    log(`Release to ${env} FAILED at ${step}: ${(err as Error).message}`);
    log('No automatic rollback was performed.');
    await record('failed');
    return 'failed';
  }
}
