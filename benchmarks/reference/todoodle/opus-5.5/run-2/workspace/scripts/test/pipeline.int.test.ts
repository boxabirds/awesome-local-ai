import { afterEach, describe, expect, it } from 'vitest';
import { runRelease } from '../deploy/pipeline';
import { DANGEROUS_BY_PATTERN, SAFE_0001_WORKSPACES } from './fixtures/migrations';
import { createReleaseSandbox, OPERATOR, type ReleaseSandbox } from './release-fixture';

const DROP_TABLE_SQL = DANGEROUS_BY_PATTERN.find((d) => d.pattern === 'DROP TABLE')?.sql ?? '';

let sandbox: ReleaseSandbox | undefined;
afterEach(async () => {
  await sandbox?.cleanup();
  sandbox = undefined;
});

async function setup(...args: Parameters<typeof createReleaseSandbox>) {
  sandbox = await createReleaseSandbox(...args);
  return sandbox;
}

function csvFields(row: string | undefined) {
  const [deployId, operator, environment, gitSha, timestamp, status, version] = (row ?? '').split(',');
  return { deployId, operator, environment, gitSha, timestamp, status, version };
}

describe('release pipeline end to end', () => {
  it('TC-L01 / TC-V07 staging happy path: order, --var injection, tag and success row', async () => {
    const s = await setup({ migrations: { '0001_workspaces.sql': SAFE_0001_WORKSPACES } });
    const outcome = await runRelease('staging', s.deps({ FAKE_WRANGLER_PENDING: '0001_workspaces.sql' }));

    expect(outcome).toBe('success');
    const calls = s.calls();
    expect(calls).toHaveLength(4);
    expect(calls[0]).toBe('build');
    expect(calls[1]).toBe('wrangler d1 migrations list DB --env staging --remote');
    expect(calls[2]).toBe('wrangler d1 migrations apply DB --env staging --remote');
    expect(calls[3]).toMatch(
      new RegExp(
        `^wrangler deploy --env staging --var APP_VERSION:v1\\.2\\.0 --var GIT_SHA:${s.headSha} --var DEPLOYED_AT:\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$`,
      ),
    );

    expect(s.liveSha()).toBe(s.headSha);
    const tags = s.deployTags();
    expect(tags).toHaveLength(1);
    expect(tags[0]).toMatch(/^deploy\/staging\/\d{8}-\d{6}$/);
    expect(s.tagsAtHead()).toContain(tags[0]);
    expect(s.remoteTags()).toContain(tags[0]);

    const rows = s.logRows();
    expect(rows).toHaveLength(1);
    expect(csvFields(rows[0])).toMatchObject({
      operator: OPERATOR,
      environment: 'staging',
      gitSha: s.headSha,
      status: 'success',
      version: 'v1.2.0',
    });
    expect(s.output.join('\n')).toContain(`staging is live: version v1.2.0, revision ${s.headSha}`);
  });

  it('TC-L02 production with a dirty tree aborts before any wrangler call, no row, no tag', async () => {
    const s = await setup();
    s.makeDirty();
    expect(await runRelease('production', s.deps())).toBe('aborted');
    expect(s.calls()).toEqual([]);
    expect(s.logRows()).toEqual([]);
    expect(s.deployTags()).toEqual([]);
    expect(s.output.join('\n')).toContain('uncommitted changes');
  });

  it('TC-L03 production without a semver tag at HEAD aborts before any wrangler call', async () => {
    const s = await setup({ semverTag: null });
    expect(await runRelease('production', s.deps())).toBe('aborted');
    expect(s.calls()).toEqual([]);
    expect(s.logRows()).toEqual([]);
    expect(s.output.join('\n')).toContain('no version tag');
  });

  it('TC-L04 production from a branch other than main aborts before any wrangler call', async () => {
    const s = await setup({ branch: 'feature/new-thing' });
    expect(await runRelease('production', s.deps())).toBe('aborted');
    expect(s.calls()).toEqual([]);
    expect(s.logRows()).toEqual([]);
    expect(s.output.join('\n')).toContain('feature/new-thing');
  });

  it('production without an interactive confirmation aborts', async () => {
    const s = await setup();
    expect(await runRelease('production', s.deps({}, { confirm: async () => false }))).toBe('aborted');
    expect(await runRelease('production', s.deps({}, { isTTY: false }))).toBe('aborted');
    expect(s.calls()).toEqual([]);
  });

  it('TC-L05 / TC-S08 production with a dangerous migration is blocked, naming the file', async () => {
    const s = await setup({ migrations: { '0005_drop_projects.sql': DROP_TABLE_SQL } });
    const outcome = await runRelease('production', s.deps({ FAKE_WRANGLER_PENDING: '0005_drop_projects.sql' }));

    expect(outcome).toBe('blocked');
    expect(s.output.join('\n')).toContain('0005_drop_projects.sql');
    const calls = s.calls();
    expect(calls.some((c) => c.includes('migrations apply'))).toBe(false);
    expect(calls.some((c) => c.startsWith('wrangler deploy'))).toBe(false);
    expect(s.logRows().map((r) => csvFields(r).status)).toEqual(['blocked']);
    expect(s.deployTags()).toEqual([]);
  });

  it('TC-S09 staging with the same dangerous migration warns, names the file and continues', async () => {
    const s = await setup({ migrations: { '0005_drop_projects.sql': DROP_TABLE_SQL } });
    const outcome = await runRelease('staging', s.deps({ FAKE_WRANGLER_PENDING: '0005_drop_projects.sql' }));

    expect(outcome).toBe('success');
    expect(s.output.find((l) => l.includes('Warning'))).toContain('0005_drop_projects.sql');
    expect(s.calls().some((c) => c.includes('migrations apply'))).toBe(true);
    expect(s.logRows().map((r) => csvFields(r).status)).toEqual(['success']);
  });

  it('TC-L06 revision already live with nothing pending: already deployed, no deploy, skipped row', async () => {
    const s = await setup();
    s.setLiveSha(s.headSha);
    const outcome = await runRelease('staging', s.deps());

    expect(outcome).toBe('skipped');
    expect(s.output.join('\n')).toContain('Already deployed');
    expect(s.calls().some((c) => c.startsWith('wrangler deploy'))).toBe(false);
    expect(s.calls().some((c) => c.includes('migrations apply'))).toBe(false);
    expect(s.logRows().map((r) => csvFields(r).status)).toEqual(['skipped']);
    expect(s.deployTags()).toEqual([]);
  });

  it('TC-L07 publish fails twice then succeeds: 3 deploy calls, every attempt shown', async () => {
    const s = await setup();
    const outcome = await runRelease('staging', s.deps({ FAKE_WRANGLER_DEPLOY: 'fail,fail,ok' }));

    expect(outcome).toBe('success');
    expect(s.calls().filter((c) => c.startsWith('wrangler deploy'))).toHaveLength(3);
    const attempts = s.output.filter((l) => l.includes('publish attempt'));
    expect(attempts).toHaveLength(3);
    expect(attempts[0]).toContain('attempt 1/3 failed');
    expect(attempts[0]).toContain('Service unavailable');
    expect(attempts[1]).toContain('attempt 2/3 failed');
    expect(attempts[2]).toContain('attempt 3/3 succeeded');
    expect(s.logRows().map((r) => csvFields(r).status)).toEqual(['success']);
  });

  it('TC-L08 publish fails 3 times: failed row, no deploy tag', async () => {
    const s = await setup();
    const outcome = await runRelease('staging', s.deps({ FAKE_WRANGLER_DEPLOY: 'fail' }));

    expect(outcome).toBe('failed');
    expect(s.calls().filter((c) => c.startsWith('wrangler deploy'))).toHaveLength(3);
    expect(s.output.filter((l) => l.includes('publish attempt'))).toHaveLength(3);
    expect(s.logRows().map((r) => csvFields(r).status)).toEqual(['failed']);
    expect(s.deployTags()).toEqual([]);
  });

  it('TC-L09 health never shows the new sha: fails naming staging, failed row, no rollback', async () => {
    const s = await setup();
    const outcome = await runRelease('staging', s.deps({ FAKE_WRANGLER_NO_GO_LIVE: '1' }));

    expect(outcome).toBe('failed');
    const failure = s.output.find((l) => l.includes('failed at step'));
    expect(failure).toContain('staging');
    expect(failure).toContain('verify health');
    const calls = s.calls();
    expect(calls.filter((c) => c.startsWith('wrangler deploy'))).toHaveLength(1);
    expect(calls.some((c) => /rollback/.test(c))).toBe(false);
    expect(s.logRows().map((r) => csvFields(r).status)).toEqual(['failed']);
    expect(s.deployTags()).toEqual([]);
  });

  it('a clean tree with only the deployment log changed is still releasable', async () => {
    const s = await setup();
    expect(await runRelease('staging', s.deps({ FAKE_WRANGLER_NO_GO_LIVE: '1' }))).toBe('failed');
    expect(await runRelease('staging', s.deps())).toBe('success');
    expect(s.logRows().map((r) => csvFields(r).status)).toEqual(['failed', 'success']);
  });
});
