import { CountsSchema, TaskListResponse } from '@todoodle/shared/schemas';
import { describe, expect, it } from 'vitest';
import { TASK_NAMES } from '../fixtures/tasks.ts';
import { createTask, getCounts, listTasks, markCompleted, markDeleted, member, taskRows } from '../support/tasks.ts';
import { Browser } from '../support/workspaces.ts';

describe('tasks.list_api: GET /api/w/:id/tasks', () => {
  it("TC-25 returns only this workspace's open, non-deleted tasks, ordered by sortOrder", async () => {
    const mine = await member();
    const other = await member();
    const milk = await createTask(mine.browser, mine.id, TASK_NAMES.milk);
    const done = await createTask(mine.browser, mine.id, 'Done already');
    const invoice = await createTask(mine.browser, mine.id, TASK_NAMES.invoice);
    const gone = await createTask(mine.browser, mine.id, 'Deleted');
    const mum = await createTask(mine.browser, mine.id, TASK_NAMES.mum);
    await createTask(other.browser, other.id, 'Not yours');
    await markCompleted(done);
    await markDeleted(gone);
    const before = await taskRows();

    const res = await listTasks(mine.browser, mine.id);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const { tasks } = TaskListResponse.parse(await res.json());
    expect(tasks.map((t) => t.id)).toEqual([milk, invoice, mum]);
    expect(tasks.every((t) => t.workspaceId === mine.id && t.completedAt === null)).toBe(true);
    expect(await taskRows()).toEqual(before);
  });

  it('a missing list parameter defaults to the Inbox', async () => {
    const { browser, id } = await member();
    const taskId = await createTask(browser, id, TASK_NAMES.milk);
    const { tasks } = TaskListResponse.parse(await (await listTasks(browser, id, '')).json());
    expect(tasks.map((t) => t.id)).toEqual([taskId]);
  });

  it('TC-26 list=bogus -> 400 validation', async () => {
    const { browser, id } = await member();
    const res = await listTasks(browser, id, '?list=bogus');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'validation' });
  });

  it('TC-27 an empty workspace -> 200 {tasks: []}', async () => {
    const { browser, id } = await member();
    const res = await listTasks(browser, id);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tasks: [] });
  });
});

describe('tasks.list_api: GET /api/w/:id/counts', () => {
  it('TC-28 3 open, 1 completed, 1 deleted -> {inbox: 3}', async () => {
    const { browser, id } = await member();
    for (const name of ['A', 'B', 'C']) await createTask(browser, id, name);
    await markCompleted(await createTask(browser, id, 'Done'));
    await markDeleted(await createTask(browser, id, 'Gone'));
    const other = await member();
    await createTask(other.browser, other.id, 'Elsewhere');
    const before = await taskRows();

    const res = await getCounts(browser, id);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(CountsSchema.parse(await res.json())).toEqual({ inbox: 3 });
    expect(await taskRows()).toEqual(before);
  });

  it('an empty workspace counts 0', async () => {
    const { browser, id } = await member();
    expect(await (await getCounts(browser, id)).json()).toEqual({ inbox: 0 });
  });

  it('TC-29 no cookie -> 404 not_found for list and counts', async () => {
    const { browser, id } = await member();
    await createTask(browser, id, TASK_NAMES.milk);
    const stranger = new Browser();
    for (const res of [await listTasks(stranger, id), await getCounts(stranger, id)]) {
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: 'not_found' });
    }
  });

  it("a cookie for another workspace cannot read this one's list or counts", async () => {
    const target = await member();
    const intruder = await member();
    await createTask(target.browser, target.id, TASK_NAMES.milk);
    expect((await listTasks(intruder.browser, target.id)).status).toBe(404);
    expect((await getCounts(intruder.browser, target.id)).status).toBe(404);
  });
});
