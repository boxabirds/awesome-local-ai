import { applyD1Migrations, env, reset } from 'cloudflare:test';
import type { Task } from '@todoodle/shared/schemas';
import { afterEach, describe, expect, it } from 'vitest';
import { newTaskId } from '../fixtures/tasks.ts';
import { createDated, member } from '../support/dates.ts';
import { type LiveClient, connectLive, framesAfter } from '../support/live.ts';
import { deleteTask, listTasks, patchTask, postTask, taskRow } from '../support/tasks.ts';
import { Browser, seedWorkspace } from '../support/workspaces.ts';

// Story 8, dates.due_date_field: POST and PATCH with dueDate against real D1 and the real WorkspaceRoom. Every
// mutating case checks the row before and after, and whether task.upserted was broadcast.

let sockets: LiveClient[] = [];
afterEach(() => {
  for (const socket of sockets) socket.close();
  sockets = [];
});

async function watch(browser: Browser, id: string): Promise<LiveClient> {
  const client = await connectLive(browser, id);
  sockets.push(client);
  return client;
}

function upserts(frames: string[]) {
  return frames.map((frame) => JSON.parse(frame) as { type: string; entity: Task; version: number }).filter((event) => event.type === 'task.upserted');
}

describe('dates.due_date_field: PATCH', () => {
  it('TC-36 sets a due date: 200, row null -> 2026-10-01, version +1, task.upserted broadcast', async () => {
    const { browser, id } = await member();
    const taskId = await createDated(browser, id, 'Renew passport', null);
    expect((await taskRow(taskId))).toMatchObject({ due_date: null, version: 1 });
    const live = await watch(browser, id);
    const res = await patchTask(browser, id, taskId, { dueDate: '2026-10-01' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { task: Task }).task).toMatchObject({ dueDate: '2026-10-01', version: 2 });
    expect(await taskRow(taskId)).toMatchObject({ due_date: '2026-10-01', version: 2 });
    const events = upserts(await live.waitForFrames(1));
    expect(events).toHaveLength(1);
    expect(events[0]!.entity).toMatchObject({ id: taskId, dueDate: '2026-10-01' });
    expect(events[0]!.version).toBe(2);
  });

  it('TC-37 null clears a date: row after null, version +1', async () => {
    const { browser, id } = await member();
    const taskId = await createDated(browser, id, 'Renew passport', '2026-09-25');
    const res = await patchTask(browser, id, taskId, { dueDate: null });
    expect(res.status).toBe(200);
    expect(await taskRow(taskId)).toMatchObject({ due_date: null, version: 2 });
  });

  it('the same date again is a no-op: no version bump, no broadcast', async () => {
    const { browser, id } = await member();
    const taskId = await createDated(browser, id, 'Renew passport', '2026-09-25');
    const live = await watch(browser, id);
    expect((await patchTask(browser, id, taskId, { dueDate: '2026-09-25' })).status).toBe(200);
    expect(await taskRow(taskId)).toMatchObject({ due_date: '2026-09-25', version: 1 });
    expect(upserts(await framesAfter(live, 300))).toEqual([]);
  });

  it.each([
    ['TC-38 not a calendar date', { dueDate: '2027-02-29' }],
    ['TC-39 a number', { dueDate: 20260925 }],
    ['a word', { dueDate: 'tomorrow' }],
    ['out of range', { dueDate: '1969-12-31' }],
  ])('%s: 400 validation, row and version unchanged, no broadcast', async (_label, body) => {
    const { browser, id } = await member();
    const taskId = await createDated(browser, id, 'Renew passport', '2026-09-25');
    const live = await watch(browser, id);
    const res = await patchTask(browser, id, taskId, body);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'validation' });
    expect(await taskRow(taskId)).toMatchObject({ due_date: '2026-09-25', version: 1 });
    expect(upserts(await framesAfter(live, 300))).toEqual([]);
  });

  it('TC-40 a soft-deleted task: 410 gone, row unchanged', async () => {
    const { browser, id } = await member();
    const taskId = await createDated(browser, id, 'Renew passport', '2026-09-25');
    expect((await deleteTask(browser, id, taskId)).status).toBe(204);
    const before = await taskRow(taskId);
    const res = await patchTask(browser, id, taskId, { dueDate: '2026-10-01' });
    expect(res.status).toBe(410);
    expect(await taskRow(taskId)).toEqual(before);
  });

  it("TC-41 another workspace's task: 404 not_found, their row unchanged", async () => {
    const mine = await member();
    const theirs = await member();
    const taskId = await createDated(theirs.browser, theirs.id, 'Theirs', '2026-09-25');
    const res = await patchTask(mine.browser, mine.id, taskId, { dueDate: '2026-10-01' });
    expect(res.status).toBe(404);
    expect(await taskRow(taskId)).toMatchObject({ due_date: '2026-09-25', version: 1 });
  });

  it('TC-42 no workspace cookie: 404 not_found (architecture section 4)', async () => {
    const { browser, id } = await member();
    const taskId = await createDated(browser, id, 'Renew passport', '2026-09-25');
    const res = await patchTask(new Browser(), id, taskId, { dueDate: '2026-10-01' });
    expect(res.status).toBe(404);
    expect(await taskRow(taskId)).toMatchObject({ due_date: '2026-09-25', version: 1 });
  });
});

describe('dates.due_date_field: POST (client-generated ids)', () => {
  it("TC-43 creates a dated task: 201, row due_date set, id is the client's", async () => {
    const { browser, id } = await member();
    const taskId = newTaskId();
    const live = await watch(browser, id);
    const res = await postTask(browser, id, { id: taskId, name: 'Pay council tax', dueDate: '2026-09-25' });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { task: Task }).task).toMatchObject({ id: taskId, dueDate: '2026-09-25' });
    expect(await taskRow(taskId)).toMatchObject({ id: taskId, due_date: '2026-09-25' });
    expect(upserts(await live.waitForFrames(1))[0]!.entity).toMatchObject({ id: taskId, dueDate: '2026-09-25' });
  });

  it("TC-44 dueDate 'tomorrow': 400, no row", async () => {
    const { browser, id } = await member();
    const taskId = newTaskId();
    const res = await postTask(browser, id, { id: taskId, name: 'Pay council tax', dueDate: 'tomorrow' });
    expect(res.status).toBe(400);
    expect(await taskRow(taskId)).toBeNull();
  });

  it('TC-100 a retry with the same id and body returns the stored task: one row, due_date unchanged', async () => {
    const { browser, id } = await member();
    const body = { id: newTaskId(), name: 'Pay council tax', dueDate: '2026-09-25' };
    expect((await postTask(browser, id, body)).status).toBe(201);
    const live = await watch(browser, id);
    const retry = await postTask(browser, id, body);
    expect(retry.status).toBe(200);
    expect(((await retry.json()) as { task: Task }).task).toMatchObject({ id: body.id, dueDate: '2026-09-25', version: 1 });
    const { results } = await env.DB.prepare('SELECT due_date FROM tasks WHERE workspace_id = ?').bind(id).all();
    expect(results).toEqual([{ due_date: '2026-09-25' }]);
    expect(upserts(await framesAfter(live, 300))).toEqual([]);
    // Story 5's id_conflict rule is unaffected: the same id from another workspace is still 409.
    const other = await member();
    expect((await postTask(other.browser, other.id, body)).status).toBe(409);
  });

  it('an undated create stores NULL and answers dueDate null', async () => {
    const { browser, id } = await member();
    const taskId = newTaskId();
    const res = await postTask(browser, id, { id: taskId, name: 'Buy milk' });
    expect(((await res.json()) as { task: Task }).task.dueDate).toBeNull();
    expect(await taskRow(taskId)).toMatchObject({ due_date: null });
  });
});

describe('dates.due_date_field: migration 0004', () => {
  it("TC-46 applied on a database holding story 5's tasks: every row kept, due_date NULL", async () => {
    await reset();
    const migrations = env.TEST_MIGRATIONS;
    await applyD1Migrations(env.DB, migrations.filter((m) => !m.name.startsWith('0004')));
    const { workspace, secret } = await seedWorkspace();
    // Story 5's rows, inserted in their shape (no due_date column yet).
    for (const [index, name] of ['Buy milk', 'Call Mum 📞', 'Renew passport'].entries()) {
      await env.DB.prepare('INSERT INTO tasks (id, workspace_id, name, description, sort_order) VALUES (?, ?, ?, ?, ?)')
        .bind((index + 1).toString(16).padStart(32, '0'), workspace.id, name, index === 0 ? 'Semi-skimmed' : '', index + 1)
        .run();
    }
    const before = (await env.DB.prepare('SELECT * FROM tasks ORDER BY sort_order').all()).results;
    expect(before).toHaveLength(3);
    await applyD1Migrations(env.DB, migrations.filter((m) => m.name.startsWith('0004')));
    const after = (await env.DB.prepare('SELECT * FROM tasks ORDER BY sort_order').all<Record<string, unknown>>()).results;
    expect(after.map(({ due_date: _due, ...rest }) => rest)).toEqual(before);
    expect(after.map((row) => row.due_date)).toEqual([null, null, null]);
    // The API reads them as undated tasks.
    const browser = new Browser();
    expect((await browser.open(secret)).status).toBe(200);
    const list = (await (await listTasks(browser, workspace.id)).json()) as { tasks: Task[] };
    expect(list.tasks.map((task) => [task.name, task.dueDate])).toEqual([
      ['Buy milk', null],
      ['Call Mum 📞', null],
      ['Renew passport', null],
    ]);
  });
});
