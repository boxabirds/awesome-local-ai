import { env } from 'cloudflare:test';
import { PROJECT_COLORS } from '@todoodle/shared/limits';
import type { TodayResponse, TodayTask } from '@todoodle/shared/schemas';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dueOnOrBeforeSql } from '../../src/db/tasks.ts';
import { createDated, getCountsWith, getToday, member } from '../support/dates.ts';
import { createProject as seedProject, deleteProject } from '../support/projects.ts';
import { lifecycle } from '../support/tasks.ts';
import { Browser, JSON_CLIENT } from '../support/workspaces.ts';

// Story 8, today.query: GET /api/w/:id/today?date= against real D1. The server takes the viewer's date and never
// uses its own clock. Read-only: every case checks the rows are unchanged afterwards.

async function today(browser: Browser, id: string, query: string): Promise<TodayResponse> {
  const res = await getToday(browser, id, query);
  expect(res.status).toBe(200);
  return (await res.json()) as TodayResponse;
}

const names = (tasks: TodayTask[]) => tasks.map((task) => task.name);

async function snapshot(id: string) {
  return (await env.DB.prepare('SELECT id, due_date, version, deleted, completed_at FROM tasks WHERE workspace_id = ? ORDER BY id').bind(id).all()).results;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('today.query: membership (TC-12..TC-20)', () => {
  it('TC-12 due the day before the viewer date: overdue', async () => {
    const { browser, id } = await member();
    await createDated(browser, id, 'Renew passport', '2026-09-25');
    const body = await today(browser, id, '?date=2026-09-26');
    expect(body.date).toBe('2026-09-26');
    expect(names(body.overdue)).toEqual(['Renew passport']);
    expect(body.today).toEqual([]);
  });

  it('TC-13 due after the viewer date: not in Today', async () => {
    const { browser, id } = await member();
    await createDated(browser, id, 'Renew passport', '2026-09-25');
    expect(await today(browser, id, '?date=2026-09-24')).toEqual({ date: '2026-09-24', overdue: [], today: [], completed: [] });
  });

  it('TC-14 / TC-15 completed today: hidden by default, only in completed[] with includeCompleted=1', async () => {
    const { browser, id } = await member();
    const done = await createDated(browser, id, 'Pay council tax', '2026-09-25');
    await createDated(browser, id, 'Buy milk', '2026-09-25');
    expect((await lifecycle(browser, id, done, 'complete')).status).toBe(200);
    const before = await snapshot(id);
    const plain = await today(browser, id, '?date=2026-09-25');
    expect(names(plain.today)).toEqual(['Buy milk']);
    expect(plain.completed).toEqual([]);
    const withCompleted = await today(browser, id, '?date=2026-09-25&includeCompleted=1');
    expect(names(withCompleted.today)).toEqual(['Buy milk']);
    expect(names(withCompleted.completed)).toEqual(['Pay council tax']);
    expect(await snapshot(id)).toEqual(before);
  });

  it('TC-16 a soft-deleted task is not in Today', async () => {
    const { browser, id } = await member();
    const gone = await createDated(browser, id, 'Deleted', '2026-09-25');
    await browser.fetch(`/api/w/${id}/tasks/${gone}`, { method: 'DELETE', headers: { 'X-Todoodle-Client': 'web' } });
    expect((await today(browser, id, '?date=2026-09-25')).today).toEqual([]);
  });

  it('TC-17 a task in a deleted project is not in Today (not even Overdue)', async () => {
    const { browser, id } = await member();
    const project = await seedProject(browser, id, 'Old stuff');
    await createDated(browser, id, 'In the project', '2026-09-20', project);
    expect(names((await today(browser, id, '?date=2026-09-25')).overdue)).toEqual(['In the project']);
    expect((await deleteProject(browser, id, project)).status).toBe(200);
    expect(await today(browser, id, '?date=2026-09-25')).toEqual({ date: '2026-09-25', overdue: [], today: [], completed: [] });
  });

  it('TC-18 / TC-19 each task says where it lives: project name and colour, or null for the Inbox', async () => {
    const { browser, id } = await member();
    const project = await seedProject(browser, id, 'Work', 'red');
    await createDated(browser, id, 'Send the report', '2026-09-25', project);
    await createDated(browser, id, 'Buy milk', '2026-09-25');
    const body = await today(browser, id, '?date=2026-09-25');
    expect(body.today.map((t) => [t.name, t.projectId, t.projectName, t.projectColor])).toEqual([
      ['Send the report', project, 'Work', 'red'],
      ['Buy milk', null, null, null],
    ]);
  });

  it('TC-20 another workspace\'s tasks never appear (isolation)', async () => {
    const a = await member();
    const b = await member();
    await createDated(b.browser, b.id, 'Theirs', '2026-09-25');
    expect(await today(a.browser, a.id, '?date=2026-09-25')).toEqual({ date: '2026-09-25', overdue: [], today: [], completed: [] });
  });

  it('orders Overdue by due date then sort order, and Today by sort order', async () => {
    const { browser, id } = await member();
    await createDated(browser, id, 'Late B', '2026-09-24');
    await createDated(browser, id, 'Today 1', '2026-09-25');
    await createDated(browser, id, 'Late A', '2026-09-01');
    await createDated(browser, id, 'Late B2', '2026-09-24');
    await createDated(browser, id, 'Today 2', '2026-09-25');
    await createDated(browser, id, 'Undated', null);
    const body = await today(browser, id, '?date=2026-09-25');
    expect(names(body.overdue)).toEqual(['Late A', 'Late B', 'Late B2']);
    expect(names(body.today)).toEqual(['Today 1', 'Today 2']);
  });
});

describe('today.query: validation and access', () => {
  it.each(['', '?date=', '?date=2026-02-30', '?date=2026-9-5', '?date=tomorrow', '?date=2026-09-25&includeCompleted=yes'])(
    'TC-45 %j -> 400 validation',
    async (query) => {
      const { browser, id } = await member();
      const res = await getToday(browser, id, query);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: 'validation' });
    },
  );

  it('no workspace cookie -> 404 not_found', async () => {
    const { id } = await member();
    const res = await getToday(new Browser(), id, '?date=2026-09-25');
    expect(res.status).toBe(404);
  });

  it('TC-95 the server clock is never used: with the Worker clock at 2030 the viewer date decides; no date is 400', async () => {
    const { browser, id } = await member();
    for (const name of ['Renew passport', 'Pay council tax', 'Buy milk']) await createDated(browser, id, name, '2026-09-25');
    const before = await snapshot(id);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
    expect(new Date().getUTCFullYear()).toBe(2030);
    const body = await today(browser, id, '?date=2026-09-25');
    expect(names(body.today)).toEqual(['Renew passport', 'Pay council tax', 'Buy milk']);
    expect(body.overdue).toEqual([]);
    const missing = await getToday(browser, id, '');
    expect(missing.status).toBe(400);
    const counts = (await (await getCountsWith(browser, id)).json()) as Record<string, unknown>;
    expect(counts).not.toHaveProperty('today');
    vi.useRealTimers();
    expect(await snapshot(id)).toEqual(before);
  });
});

describe('TC-93 performance: 5,000 open tasks', () => {
  it('GET today and GET counts?date answer with p95 < 300 ms over 20 runs; the plan uses idx_tasks_ws_due', async () => {
    const { browser, id } = await member();
    // 50 coloured projects (one soft-deleted with its tasks, as story 7 deletes them), 5,000 open tasks:
    // 2,000 due on or before the date (the past 60 days and today), the rest in the next 90 days or undated,
    // plus completed and soft-deleted ones.
    const projects = Array.from({ length: 50 }, (_, i) => ({
      id: (i + 1).toString(16).padStart(32, 'a'),
      name: `Project ${i + 1}`,
      color: PROJECT_COLORS[i % PROJECT_COLORS.length]!.key,
      deleted: i === 49,
    }));
    const day = (offset: number) => new Date(Date.UTC(2026, 8, 25 + offset)).toISOString().slice(0, 10);
    const tasks = Array.from({ length: 5_300 }, (_, i) => ({
      id: (i + 1).toString(16).padStart(32, '0'),
      name: ['Renew passport', 'Pay council tax', 'Book dentist', 'Water the plants'][i % 4] + ` ${i}`,
      description: i % 10 === 0 ? 'Ask about:\n- the Tuesday slot' : '',
      projectId: i % 3 === 0 ? null : projects[i % 49]!.id,
      dueDate: i < 2_000 ? day(-(i % 61)) : i < 4_000 ? day(1 + (i % 90)) : i < 5_000 ? null : day(-(i % 5)),
      ...(i >= 5_000 && i < 5_200 ? { completedAt: '2026-09-24T10:00:00.000Z' } : {}),
      ...(i >= 5_200 ? { deleted: true } : {}),
    }));
    tasks.push(
      ...Array.from({ length: 20 }, (_, i) => ({ id: (i + 1).toString(16).padStart(32, 'c'), name: `Deleted project task ${i}`, description: '', projectId: projects[49]!.id, dueDate: day(-1) })),
    );
    const seeded = await browser.fetch('/test/seed', { method: 'POST', headers: JSON_CLIENT, body: JSON.stringify({ workspaceId: id, projects, tasks }) });
    expect(seeded.status).toBe(201);

    const timings = { today: [] as number[], counts: [] as number[] };
    let first: TodayResponse | null = null;
    let counts: Record<string, unknown> | null = null;
    for (let run = 0; run < 20; run++) {
      let start = performance.now();
      const res = await getToday(browser, id, '?date=2026-09-25');
      first ??= (await res.json()) as TodayResponse;
      if (run > 0) await res.body?.cancel();
      timings.today.push(performance.now() - start);
      start = performance.now();
      const countsRes = await getCountsWith(browser, id, '?date=2026-09-25');
      counts ??= (await countsRes.json()) as Record<string, unknown>;
      if (run > 0) await countsRes.body?.cancel();
      timings.counts.push(performance.now() - start);
    }
    const p95 = (values: number[]) => values.toSorted((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1]!;
    expect(first!.overdue.length + first!.today.length).toBe(2_000);
    expect(counts!.today).toBe(2_000);
    expect(p95(timings.today), `today p95 ${p95(timings.today).toFixed(1)} ms`).toBeLessThan(300);
    expect(p95(timings.counts), `counts p95 ${p95(timings.counts).toFixed(1)} ms`).toBeLessThan(300);

    const plan = await env.DB.prepare(`EXPLAIN QUERY PLAN ${dueOnOrBeforeSql(false)}`).bind(id, '2026-09-25').all<{ detail: string }>();
    expect(plan.results.map((row) => row.detail).join('\n')).toMatch(/idx_tasks_ws_due/);
  }, 120_000);
});
