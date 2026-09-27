import { describe, expect, it } from 'vitest';
import { buildHealth } from '@todoodle/shared/health';
import { formatCsvRow, type LogEntry } from '../deploy/record';
import { verifyHealth } from '../deploy/verify';

const OLD = 'a3f9c2e1b4d5f60718293a4b5c6d7e8f90a1b2c3';
const NEW = 'b41e07d9c2a85f3e6d1c0b9a8f7e6d5c4b3a2918';

type Step = { sha: string } | { status: number } | { throws: true };

/** Fake clock + scripted /health responses (bodies produced by the real buildHealth). */
function scenario(steps: Step[], opts: { timeoutMs?: number; intervalMs?: number } = {}) {
  let clock = 0;
  let fetches = 0;
  const sleeps: number[] = [];
  const fetchFn = (async () => {
    const step = steps[Math.min(fetches, steps.length - 1)];
    fetches++;
    if (!step || 'throws' in step) throw new TypeError('fetch failed');
    if ('status' in step) return new Response('upstream error', { status: step.status });
    return Response.json(buildHealth({ ENVIRONMENT: 'staging', APP_VERSION: 'v1.2.0', GIT_SHA: step.sha }));
  }) as unknown as typeof fetch;
  const run = () =>
    verifyHealth({
      baseUrl: 'https://staging.test',
      expectedSha: NEW,
      env: 'staging',
      timeoutMs: opts.timeoutMs ?? 30_000,
      intervalMs: opts.intervalMs ?? 2_000,
      fetch: fetchFn,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
      now: () => clock,
    });
  return { run, sleeps, fetches: () => fetches };
}

describe('verifyHealth', () => {
  it('TC-V01 target sha on the first poll -> ok after 1 fetch', async () => {
    const s = scenario([{ sha: NEW }]);
    expect(await s.run()).toEqual({ ok: true });
    expect(s.fetches()).toBe(1);
    expect(s.sleeps).toEqual([]);
  });

  it('TC-V02 old sha then target -> ok after 2 fetches and 1 sleep', async () => {
    const s = scenario([{ sha: OLD }, { sha: NEW }]);
    expect(await s.run()).toEqual({ ok: true });
    expect(s.fetches()).toBe(2);
    expect(s.sleeps).toEqual([2_000]);
  });

  it('TC-V03 old sha until timeout -> failure naming env and last seen sha', async () => {
    const s = scenario([{ sha: OLD }], { timeoutMs: 10_000, intervalMs: 2_000 });
    const result = await s.run();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.lastSeenSha).toBe(OLD);
    expect(result.message).toContain('staging');
    expect(result.message).toContain(OLD);
    expect(s.fetches()).toBe(6);
  });

  it('TC-V04 fetch throws, then 500, then target -> ok', async () => {
    const s = scenario([{ throws: true }, { status: 500 }, { sha: NEW }]);
    expect(await s.run()).toEqual({ ok: true });
    expect(s.fetches()).toBe(3);
  });

  it('never reached -> last seen sha is null', async () => {
    const s = scenario([{ throws: true }], { timeoutMs: 4_000 });
    const result = await s.run();
    expect(result).toMatchObject({ ok: false, lastSeenSha: null });
  });
});

describe('formatCsvRow', () => {
  const entry: LogEntry = {
    deployId: 'staging-20260927-101500',
    operator: 'Sam Lee',
    environment: 'staging',
    gitSha: NEW,
    timestamp: '2026-09-27T10:15:00.000Z',
    status: 'success',
    version: 'v1.2.0',
  };

  it('writes fields in header order', () => {
    expect(formatCsvRow(entry)).toBe(
      `staging-20260927-101500,Sam Lee,staging,${NEW},2026-09-27T10:15:00.000Z,success,v1.2.0`,
    );
  });

  it('TC-V05 quotes and escapes an operator like Doe, "J"', () => {
    expect(formatCsvRow({ ...entry, operator: 'Doe, "J"' })).toBe(
      `staging-20260927-101500,"Doe, ""J""",staging,${NEW},2026-09-27T10:15:00.000Z,success,v1.2.0`,
    );
  });

  it('quotes fields containing newlines', () => {
    expect(formatCsvRow({ ...entry, operator: 'a\nb' })).toContain('"a\nb"');
  });
});
