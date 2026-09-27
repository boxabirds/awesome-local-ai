import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEPLOYMENT_LOG_HEADER, DEPLOYMENT_LOG_PATH } from '../deploy/constants';
import { createFs } from '../deploy/deps';
import { formatCsvRow, type LogEntry, recordRelease } from '../deploy/record';
import type { GitLike } from '../deploy/types';

const entry: LogEntry = {
  deployId: 'staging-20260927-101500',
  operator: 'Doe, "J"',
  environment: 'staging',
  gitSha: 'b41e07d9c2a85f3e6d1c0b9a8f7e6d5c4b3a2918',
  timestamp: '2026-09-27T10:15:00.000Z',
  status: 'failed',
  version: 'v1.2.0',
};

const noGit = new Proxy({} as GitLike, {
  get: () => () => {
    throw new Error('git must not be used when tag is false');
  },
});

let dir: string;
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const lines = () => readFileSync(join(dir, DEPLOYMENT_LOG_PATH), 'utf8').split('\n').filter(Boolean);

describe('recordRelease on a real filesystem (TC-V06)', () => {
  it('creates the log with its header when missing', async () => {
    dir = mkdtempSync(join(tmpdir(), 'todoodle-log-'));
    await recordRelease(entry, { fs: createFs(dir), git: noGit, tag: false });
    expect(lines()).toEqual([DEPLOYMENT_LOG_HEADER, formatCsvRow(entry)]);
  });

  it('appends to an existing log: 1 row before, 2 rows after', async () => {
    dir = mkdtempSync(join(tmpdir(), 'todoodle-log-'));
    mkdirSync(join(dir, 'docs', 'ops'), { recursive: true });
    const first = formatCsvRow({ ...entry, deployId: 'staging-20260926-090000', status: 'success' });
    writeFileSync(join(dir, DEPLOYMENT_LOG_PATH), `${DEPLOYMENT_LOG_HEADER}\n${first}\n`);
    expect(lines().slice(1)).toHaveLength(1);

    await recordRelease(entry, { fs: createFs(dir), git: noGit, tag: false });

    expect(lines().slice(1)).toEqual([first, formatCsvRow(entry)]);
  });
});
