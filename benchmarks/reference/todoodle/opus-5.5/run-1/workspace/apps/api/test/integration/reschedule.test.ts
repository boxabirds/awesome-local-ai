import { env } from 'cloudflare:test';
import { RESCHEDULE_MAX_IDS } from '@todoodle/shared/limits';
import type { RescheduleResponse, RestoreDueDatesResponse } from '@todoodle/shared/schemas';
import { afterEach, describe, expect, it } from 'vitest';
import { newTaskId } from '../fixtures/tasks.ts';
import { createDated, dueState, member, reschedule, restoreDueDates } from '../support/dates.ts';
import { connectLive, framesAfter, type LiveClient } from '../support/live.ts';
import { deleteTask, lifecycle, patchTask } from '../support/tasks.ts';
import { JSON_CLIENT } from '../support/workspaces.ts';

// Story 8, today.reschedule: POST tasks/reschedule (id-scoped) and tasks/due-dates/restore (version-guarded
// undo) against real D1 and the real WorkspaceRoom. Every mutating case checks rows before and after and whether
// a tasks.bulk was broadcast.

const TO = '2026-09-25';
let sockets: LiveClient[] = [];
afterEach(() => {
  for (const socket of sockets) socket.close();
  sockets = [];
});

async function watch(browser: Parameters<typeof connectLive>[0], id: string): Promise<LiveClient> {
  const client = await connectLive(browser, id);
  sockets.push(client);
  return client;
}

function bulkFrames(frames: string[]) {
  return frames.map((frame) => JSON.parse(frame) as { type: string; entity: { ids: string[] } }).filter((event) => event.type === 'tasks.bulk');
}

describe('today.reschedule: reschedule overdue', () => {
  it('TC-58 (run first) json_each works in D1: reschedule then restore round-trips', async () => {
    const { browser, id } = await member();
    const a = await createDated(browser, id, 'Renew passport', '2026-09-20');
    const b = await createDated(browser, id, 'Pay council tax', '2026-09-24');
    const moved = (await (await reschedule(browser, id, { ids: [a, b], to: TO })).json()) as RescheduleResponse;
    expect(await dueState([a, b])).toEqual({ [a]: [TO, 2, 0], [b]: [TO, 2, 0] });
    const res = await restoreDueDates(browser, id, {
      items: moved.changed.map((c) => ({ id: c.id, dueDate: c.previousDueDate, expectedVersion: c.version })),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as RestoreDueDatesResponse;
    expect(body.skipped).toEqual([]);
    expect(body.restored.map((r) => r.id).sort()).toEqual([a, b].sort());
    expect(await dueState([a, b])).toEqual({ [a]: ['2026-09-20', 3, 0], [b]: ['2026-09-24', 3, 0] });
  });

  it('TC-47 moves both overdue tasks, versions +1, previous dates returned, one tasks.bulk', async () => {
    const { browser, id } = await member();
    const a = await createDated(browser, id, 'Renew passport', '2026-09-20');
    const b = await createDated(browser, id, 'Pay council tax', '2026-09-24');
    expect(await dueState([a, b])).toEqual({ [a]: ['2026-09-20', 1, 0], [b]: ['2026-09-24', 1, 0] });
    const live = await watch(browser, id);
    const res = await reschedule(browser, id, { ids: [a, b], to: TO });
    expect(res.status).toBe(200);
    const body = (await res.json()) as RescheduleResponse;
    expect(body.skipped).toEqual([]);
    expect(body.changed.toSorted((x, y) => x.previousDueDate.localeCompare(y.previousDueDate))).toEqual([
      { id: a, previousDueDate: '2026-09-20', dueDate: TO, version: 2 },
      { id: b, previousDueDate: '2026-09-24', dueDate: TO, version: 2 },
    ]);
    expect(await dueState([a, b])).toEqual({ [a]: [TO, 2, 0], [b]: [TO, 2, 0] });
    const frames = bulkFrames(await live.waitForFrames(1));
    expect(frames).toHaveLength(1);
    expect(frames[0]!.entity.ids.toSorted()).toEqual([a, b].toSorted());
  });

  it('TC-48 only the listed ids move: an overdue task the viewer did not see keeps its date', async () => {
    const { browser, id } = await member();
    const a = await createDated(browser, id, 'Renew passport', '2026-09-20');
    const c = await createDated(browser, id, 'Added by a collaborator', '2026-09-19');
    await reschedule(browser, id, { ids: [a], to: TO });
    expect(await dueState([a, c])).toEqual({ [a]: [TO, 2, 0], [c]: ['2026-09-19', 1, 0] });
  });

  it.each([
    ['TC-49 completed since load', 'completed'],
    ['TC-50 soft-deleted since load', 'deleted'],
    ['TC-51 due in the future', 'future'],
    ['TC-52 already due today', 'today'],
  ] as const)('%s: unchanged, skipped, no broadcast', async (_label, state) => {
    const { browser, id } = await member();
    const due = state === 'future' ? '2026-09-30' : state === 'today' ? TO : '2026-09-20';
    const a = await createDated(browser, id, 'Renew passport', due);
    if (state === 'completed') expect((await lifecycle(browser, id, a, 'complete')).status).toBe(200);
    if (state === 'deleted') expect((await deleteTask(browser, id, a)).status).toBe(204);
    const before = await dueState([a]);
    const live = await watch(browser, id);
    const res = await reschedule(browser, id, { ids: [a], to: TO });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ changed: [], skipped: [a] });
    expect(await dueState([a])).toEqual(before);
    expect(bulkFrames(await framesAfter(live, 300))).toEqual([]);
  });

  it('TC-53 another workspace\'s task: unchanged and skipped like any other (existence not leaked)', async () => {
    const w1 = await member();
    const w2 = await member();
    const a = await createDated(w2.browser, w2.id, 'Theirs', '2026-09-20');
    const unknown = newTaskId();
    const res = await reschedule(w1.browser, w1.id, { ids: [a, unknown], to: TO });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ changed: [], skipped: [a, unknown] });
    expect(await dueState([a])).toEqual({ [a]: ['2026-09-20', 1, 0] });
  });

  it.each([
    ['TC-54 empty ids', { ids: [], to: TO }],
    ['TC-55 RESCHEDULE_MAX_IDS + 1 ids', { ids: Array.from({ length: RESCHEDULE_MAX_IDS + 1 }, () => newTaskId()), to: TO }],
    ['TC-57 invalid to', { ids: ['PLACEHOLDER'], to: '2026-02-30' }],
    ['duplicate ids', { ids: ['PLACEHOLDER', 'PLACEHOLDER'], to: TO }],
    ['missing to', { ids: ['PLACEHOLDER'] }],
  ])('%s: 400 validation, nothing changed', async (_label, body) => {
    const { browser, id } = await member();
    const a = await createDated(browser, id, 'Renew passport', '2026-09-20');
    const payload = JSON.parse(JSON.stringify(body).replaceAll('PLACEHOLDER', a));
    const res = await reschedule(browser, id, payload);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'validation' });
    expect(await dueState([a])).toEqual({ [a]: ['2026-09-20', 1, 0] });
  });

  it('TC-56 RESCHEDULE_MAX_IDS eligible ids move in one atomic batch', async () => {
    const { browser, id } = await member();
    const ids = Array.from({ length: RESCHEDULE_MAX_IDS }, () => newTaskId());
    const seed = await browser.fetch('/test/seed', {
      method: 'POST',
      headers: JSON_CLIENT,
      body: JSON.stringify({ workspaceId: id, tasks: ids.map((taskId, i) => ({ id: taskId, name: `Overdue ${i}`, dueDate: '2026-09-01' })) }),
    });
    expect(seed.status).toBe(201);
    const res = await reschedule(browser, id, { ids, to: TO });
    expect(res.status).toBe(200);
    const body = (await res.json()) as RescheduleResponse;
    expect(body.changed).toHaveLength(RESCHEDULE_MAX_IDS);
    expect(body.skipped).toEqual([]);
    const { results } = await env.DB.prepare('SELECT due_date, COUNT(*) AS n FROM tasks WHERE workspace_id = ? GROUP BY due_date')
      .bind(id)
      .all<{ due_date: string; n: number }>();
    expect(results).toEqual([{ due_date: TO, n: RESCHEDULE_MAX_IDS }]);
  });

  it('TC-63 a failing batch writes nothing: 500 internal, every row unchanged, no broadcast', async () => {
    const { browser, id } = await member();
    const a = await createDated(browser, id, 'Renew passport', '2026-09-20');
    const b = await createDated(browser, id, 'Pay council tax', '2026-09-24');
    const before = await dueState([a, b]);
    // A test-only trigger aborts the UPDATE statement inside the batch.
    await env.DB.prepare(
      `CREATE TRIGGER abort_reschedule BEFORE UPDATE OF due_date ON tasks WHEN NEW.id = '${b}' BEGIN SELECT RAISE(ABORT, 'injected'); END`,
    ).run();
    try {
      const live = await watch(browser, id);
      const res = await reschedule(browser, id, { ids: [a, b], to: TO });
      expect(res.status).toBe(500);
      expect(await res.json()).toMatchObject({ error: 'internal' });
      expect(await dueState([a, b])).toEqual(before);
      expect(bulkFrames(await framesAfter(live, 300))).toEqual([]);
    } finally {
      await env.DB.prepare('DROP TRIGGER abort_reschedule').run();
    }
  });
});

describe('today.reschedule: undo (version-guarded restore)', () => {
  async function rescheduled() {
    const { browser, id } = await member();
    const a = await createDated(browser, id, 'Renew passport', '2026-09-20');
    const b = await createDated(browser, id, 'Pay council tax', '2026-09-24');
    const body = (await (await reschedule(browser, id, { ids: [a, b], to: TO })).json()) as RescheduleResponse;
    const items = body.changed.map((c) => ({ id: c.id, dueDate: c.previousDueDate, expectedVersion: c.version }));
    return { browser, id, a, b, items };
  }

  it('TC-58 restores both previous dates, versions +1, one tasks.bulk', async () => {
    const { browser, id, a, b, items } = await rescheduled();
    const live = await watch(browser, id);
    const res = await restoreDueDates(browser, id, { items });
    const body = (await res.json()) as RestoreDueDatesResponse;
    expect(body.restored.toSorted((x, y) => (x.dueDate ?? '').localeCompare(y.dueDate ?? ''))).toEqual([
      { id: a, dueDate: '2026-09-20', version: 3 },
      { id: b, dueDate: '2026-09-24', version: 3 },
    ]);
    expect(body.skipped).toEqual([]);
    expect(await dueState([a, b])).toEqual({ [a]: ['2026-09-20', 3, 0], [b]: ['2026-09-24', 3, 0] });
    expect(bulkFrames(await live.waitForFrames(1))).toHaveLength(1);
  });

  it('TC-59 a task a collaborator changed since is left alone and reported as changed', async () => {
    const { browser, id, a, b, items } = await rescheduled();
    expect((await patchTask(browser, id, b, { name: 'Pay council tax (online)' })).status).toBe(200);
    const res = await restoreDueDates(browser, id, { items });
    const body = (await res.json()) as RestoreDueDatesResponse;
    expect(body.restored.map((r) => r.id)).toEqual([a]);
    expect(body.skipped).toEqual([{ id: b, reason: 'changed' }]);
    expect(await dueState([a, b])).toEqual({ [a]: ['2026-09-20', 3, 0], [b]: [TO, 3, 0] });
  });

  it('TC-60 a task a collaborator deleted since stays deleted and is reported as gone', async () => {
    const { browser, id, a, b, items } = await rescheduled();
    expect((await deleteTask(browser, id, a)).status).toBe(204);
    const res = await restoreDueDates(browser, id, { items });
    const body = (await res.json()) as RestoreDueDatesResponse;
    expect(body.restored.map((r) => r.id)).toEqual([b]);
    expect(body.skipped).toEqual([{ id: a, reason: 'gone' }]);
    expect(await dueState([a, b])).toEqual({ [a]: [TO, 3, 1], [b]: ['2026-09-24', 3, 0] });
  });

  it('an unknown id and another workspace\'s task are gone; nothing broadcast when nothing was restored', async () => {
    const { browser, id } = await member();
    const other = await member();
    const theirs = await createDated(other.browser, other.id, 'Theirs', '2026-09-20');
    const unknown = newTaskId();
    const live = await watch(browser, id);
    const res = await restoreDueDates(browser, id, {
      items: [
        { id: theirs, dueDate: '2026-01-01', expectedVersion: 1 },
        { id: unknown, dueDate: '2026-01-01', expectedVersion: 1 },
      ],
    });
    expect(await res.json()).toEqual({ restored: [], skipped: [{ id: theirs, reason: 'gone' }, { id: unknown, reason: 'gone' }] });
    expect(await dueState([theirs])).toEqual({ [theirs]: ['2026-09-20', 1, 0] });
    expect(bulkFrames(await framesAfter(live, 300))).toEqual([]);
  });

  it.each([
    ['TC-61 empty items', { items: [] }],
    ['TC-61 more than RESCHEDULE_MAX_IDS items', { items: Array.from({ length: RESCHEDULE_MAX_IDS + 1 }, () => ({ id: newTaskId(), dueDate: null, expectedVersion: 1 })) }],
    ['non-integer version', { items: [{ id: 'PLACEHOLDER', dueDate: '2026-09-20', expectedVersion: 1.5 }] }],
    ['invalid date', { items: [{ id: 'PLACEHOLDER', dueDate: '2026-02-30', expectedVersion: 2 }] }],
    ['duplicate ids', { items: [{ id: 'PLACEHOLDER', dueDate: '2026-09-20', expectedVersion: 2 }, { id: 'PLACEHOLDER', dueDate: '2026-09-20', expectedVersion: 2 }] }],
  ])('%s: 400, nothing changed', async (_label, body) => {
    const { browser, id, a, b } = await rescheduled();
    const before = await dueState([a, b]);
    const res = await restoreDueDates(browser, id, JSON.parse(JSON.stringify(body).replaceAll('PLACEHOLDER', a)));
    expect(res.status).toBe(400);
    expect(await dueState([a, b])).toEqual(before);
  });
});
