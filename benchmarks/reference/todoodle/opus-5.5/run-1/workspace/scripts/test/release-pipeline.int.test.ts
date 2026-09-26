import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runRelease } from '../deploy/pipeline.ts';
import { M0001_WORKSPACES } from './fixtures/migrations.ts';
import { OLD_SHA, ReleaseHarness, type RepoOptions } from './support/release-harness.ts';

const DANGEROUS_FILE = '0005_drop_legacy.sql';
const DANGEROUS_SQL = '-- Migration number: 0005\nCREATE TABLE notes (id TEXT PRIMARY KEY);\nDROP TABLE tasks;\n';

let harness: ReleaseHarness;

async function setup(env: 'staging' | 'production', opts: RepoOptions = {}) {
  harness = new ReleaseHarness(opts);
  const baseUrl = await harness.startHealthServer(env);
  return { baseUrl, h: harness };
}

afterEach(async () => {
  await harness?.dispose();
});

const wranglerCalls = (h: ReleaseHarness) => h.calls().filter((c) => c.startsWith('wrangler'));

describe('release pipeline (fake wrangler, real git, fs and health server)', () => {
  it('TC-L01 staging happy path: build, list, apply, deploy with injected vars; tag; CSV success', async () => {
    const { h, baseUrl } = await setup('staging', { migrations: { '0001_workspaces.sql': M0001_WORKSPACES } });
    h.setPending(['0001_workspaces.sql']);
    const sha = h.headSha;

    const outcome = await runRelease('staging', h.deps(baseUrl));

    expect(outcome).toBe('success');
    expect(h.calls()).toEqual([
      'build',
      'wrangler d1 migrations list DB --env staging --remote',
      'wrangler d1 migrations apply DB --env staging --remote',
      `wrangler deploy --env staging --var APP_VERSION:v1.2.0 --var GIT_SHA:${sha} --var DEPLOYED_AT:2026-09-25T12:34:56.000Z`,
    ]);
    expect(h.deployTags()).toEqual(['deploy/staging/20260925-123456']);
    const rows = h.logRows()!;
    expect(rows).toHaveLength(2);
    expect(rows[1]).toBe(
      `staging-20260925-123456,Test Operator,staging,${sha},2026-09-25T12:34:56.000Z,success,v1.2.0`,
    );
    expect(h.output()).toContain('Safety scan: ok.');
    expect(h.output()).toContain(`Released: staging is live with version v1.2.0, revision ${sha}.`);
  });

  it('TC-L02 production with a dirty tree aborts before any wrangler call; no CSV row; no tag', async () => {
    const { h, baseUrl } = await setup('production');
    writeFileSync(path.join(h.repo, 'scratch.txt'), 'uncommitted');
    const rowsBefore = h.logRows();

    expect(await runRelease('production', h.deps(baseUrl))).toBe('aborted');
    expect(h.calls()).toEqual([]);
    expect(h.logRows()).toEqual(rowsBefore);
    expect(h.deployTags()).toEqual([]);
    expect(h.output()).toContain('uncommitted changes');
  });

  it('TC-L03 production without a semver tag at HEAD aborts before any wrangler call', async () => {
    const { h, baseUrl } = await setup('production', { semverTag: null });
    expect(await runRelease('production', h.deps(baseUrl))).toBe('aborted');
    expect(h.calls()).toEqual([]);
    expect(h.logRows()).toHaveLength(1);
    expect(h.output()).toContain('semver tag');
  });

  it('TC-L04 production from a branch other than main aborts before any wrangler call', async () => {
    const { h, baseUrl } = await setup('production', { branch: 'feature/x' });
    expect(await runRelease('production', h.deps(baseUrl))).toBe('aborted');
    expect(h.calls()).toEqual([]);
    expect(h.logRows()).toHaveLength(1);
    expect(h.output()).toContain('must come from main');
  });

  it('production without an interactive terminal aborts', async () => {
    const { h, baseUrl } = await setup('production');
    expect(await runRelease('production', h.deps(baseUrl, { isTTY: false }))).toBe('aborted');
    expect(h.calls()).toEqual([]);
  });

  it('production not confirmed by the operator aborts', async () => {
    const { h, baseUrl } = await setup('production');
    expect(await runRelease('production', h.deps(baseUrl, { confirm: async () => false }))).toBe('aborted');
    expect(h.calls()).toEqual([]);
  });

  it('TC-L05 / TC-S08 production with a dangerous migration is blocked, names the file, never applies or deploys', async () => {
    const { h, baseUrl } = await setup('production', { migrations: { [DANGEROUS_FILE]: DANGEROUS_SQL } });
    h.setPending([DANGEROUS_FILE]);

    expect(await runRelease('production', h.deps(baseUrl))).toBe('blocked');

    expect(h.output()).toContain(`${DANGEROUS_FILE}:3 contains DROP TABLE`);
    const calls = wranglerCalls(h);
    expect(calls.some((c) => c.includes('migrations apply'))).toBe(false);
    expect(calls.some((c) => c.startsWith('wrangler deploy'))).toBe(false);
    const rows = h.logRows()!;
    expect(rows).toHaveLength(2);
    expect(rows[1]).toContain(',production,');
    expect(rows[1]).toContain(',blocked,');
    expect(h.deployTags()).toEqual([]);
  });

  it('TC-S09 staging with the same dangerous migration warns naming the file and releases', async () => {
    const { h, baseUrl } = await setup('staging', { migrations: { [DANGEROUS_FILE]: DANGEROUS_SQL } });
    h.setPending([DANGEROUS_FILE]);

    expect(await runRelease('staging', h.deps(baseUrl))).toBe('success');
    expect(h.output()).toContain('Safety scan: WARNING');
    expect(h.output()).toContain(DANGEROUS_FILE);
    expect(wranglerCalls(h).some((c) => c.includes('migrations apply'))).toBe(true);
    expect(h.logRows()![1]).toContain(',success,');
  });

  it('TC-L06 staging already serving HEAD with nothing pending: already deployed, no deploy, CSV skipped', async () => {
    const { h, baseUrl } = await setup('staging');
    h.healthMode = 'head';

    expect(await runRelease('staging', h.deps(baseUrl))).toBe('skipped');
    expect(h.output()).toContain('already deployed');
    expect(wranglerCalls(h).some((c) => c.startsWith('wrangler deploy'))).toBe(false);
    expect(h.logRows()![1]).toContain(',skipped,');
    expect(h.deployTags()).toEqual([]);
  });

  it('TC-L07 publish fails twice then succeeds: 3 deploy calls, every attempt shown, success', async () => {
    const { h, baseUrl } = await setup('staging');
    h.setDeployFailures(2);

    expect(await runRelease('staging', h.deps(baseUrl))).toBe('success');
    expect(wranglerCalls(h).filter((c) => c.startsWith('wrangler deploy'))).toHaveLength(3);
    expect(h.output()).toContain('Publish attempt 1/3: failed');
    expect(h.output()).toContain('Publish attempt 2/3: failed');
    expect(h.output()).toContain('Publish attempt 3/3: ok');
    expect(h.output()).toContain('Service unavailable');
    expect(h.sleeps.slice(0, 2)).toEqual([5000, 10_000]);
  });

  it('TC-L08 publish fails 3 times: exit failed, CSV failed, no deploy tag', async () => {
    const { h, baseUrl } = await setup('staging');
    h.setDeployFailures(3);

    expect(await runRelease('staging', h.deps(baseUrl))).toBe('failed');
    expect(wranglerCalls(h).filter((c) => c.startsWith('wrangler deploy'))).toHaveLength(3);
    expect(h.output()).toContain('Publish attempt 3/3: failed');
    expect(h.output()).toContain('FAILED at publish');
    expect(h.logRows()![1]).toContain(',failed,');
    expect(h.deployTags()).toEqual([]);
  });

  it('TC-L09 health never reports the new sha: failed naming staging, CSV failed, no rollback', async () => {
    const { h, baseUrl } = await setup('staging');
    h.healthMode = 'never-updates';

    expect(await runRelease('staging', h.deps(baseUrl))).toBe('failed');
    expect(h.output()).toMatch(/FAILED at verify health: staging did not report revision/);
    expect(h.output()).toContain(OLD_SHA);
    expect(h.output()).toContain('No automatic rollback');
    expect(h.calls().some((c) => c.includes('rollback'))).toBe(false);
    expect(h.logRows()![1]).toContain(',failed,');
    expect(h.deployTags()).toEqual([]);
  });

  it('a failing build is recorded as failed and nothing is published', async () => {
    const { h, baseUrl } = await setup('staging');
    writeFileSync(
      path.join(h.repo, 'package.json'),
      JSON.stringify({ name: 'todoodle', private: true, scripts: { build: 'exit 3' } }),
    );
    h.git('commit', '--quiet', '-am', 'break build');

    expect(await runRelease('staging', h.deps(baseUrl))).toBe('failed');
    expect(wranglerCalls(h)).toEqual([]);
    expect(h.output()).toContain('FAILED at build');
    expect(h.logRows()![1]).toContain(',failed,');
  });
});

describe('release record (real filesystem and git)', () => {
  it('TC-V06 creates the log with header and row when it does not exist', async () => {
    const { h, baseUrl } = await setup('staging', { existingLogRows: null });
    expect(h.logRows()).toBeNull();

    expect(await runRelease('staging', h.deps(baseUrl))).toBe('success');
    const rows = h.logRows()!;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toBe('deploy_id,operator,environment,git_sha,timestamp,status,version');
  });

  it('TC-V06 appends to an existing log: 1 row before, 2 rows after', async () => {
    const earlier = `staging-20260901-000000,Someone Else,staging,${OLD_SHA},2026-09-01T00:00:00.000Z,success,v1.1.0`;
    const { h, baseUrl } = await setup('staging', { existingLogRows: [earlier] });
    expect(h.logRows()!.slice(1)).toEqual([earlier]);

    expect(await runRelease('staging', h.deps(baseUrl))).toBe('success');
    const rows = h.logRows()!.slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toBe(earlier);
  });

  it('TC-V07 tags HEAD deploy/staging/YYYYMMDD-HHMMSS after success', async () => {
    const { h, baseUrl } = await setup('staging');
    expect(await runRelease('staging', h.deps(baseUrl))).toBe('success');
    const tag = 'deploy/staging/20260925-123456';
    expect(h.git('rev-list', '-n', '1', tag)).toBe(h.headSha);
    expect(h.output()).toContain(`Tagged ${tag} (no git remote configured; not pushed).`);
  });

  it('pushes the deploy tag when a remote exists', async () => {
    const { h, baseUrl } = await setup('staging');
    const remote = path.join(h.root, 'remote.git');
    h.git('init', '--quiet', '--bare', remote);
    h.git('remote', 'add', 'origin', remote);

    expect(await runRelease('staging', h.deps(baseUrl))).toBe('success');
    const remoteTags = h.git('ls-remote', '--tags', 'origin');
    expect(remoteTags).toContain('refs/tags/deploy/staging/20260925-123456');
  });

  it('a second release after the log was appended is not blocked by the dirty log', async () => {
    const { h, baseUrl } = await setup('staging');
    expect(await runRelease('staging', h.deps(baseUrl))).toBe('success');
    h.healthMode = 'head';
    expect(await runRelease('staging', h.deps(baseUrl))).toBe('skipped');
  });
});
