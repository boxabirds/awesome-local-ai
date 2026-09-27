import { CountsSchema, TaskListResponse } from '@todoodle/shared/schemas';
import { describe, expect, it } from 'vitest';
import { TASK_NAMES } from '../fixtures/tasks';
import { createdTask, getCounts, listTasks, markCompleted, markDeleted, taskRows } from '../task-helpers';
import { createWorkspace } from '../workspace-helpers';

describe('GET /api/w/:id/tasks', () => {
  it('TC-25 lists only this workspace’s open, non-deleted tasks in sortOrder order', async () => {
    const a = await createWorkspace();
    const b = await createWorkspace(a.cookie);
    const milk = await createdTask(a.workspace.id, a.cookie, { name: TASK_NAMES.milk });
    const done = await createdTask(a.workspace.id, a.cookie, { name: 'Done already' });
    const invoice = await createdTask(a.workspace.id, a.cookie, { name: TASK_NAMES.invoice });
    const removed = await createdTask(a.workspace.id, a.cookie, { name: 'Deleted' });
    const mum = await createdTask(a.workspace.id, a.cookie, { name: TASK_NAMES.mum });
    await createdTask(b.workspace.id, b.cookie, { name: TASK_NAMES.dentist });
    await markCompleted(done.id);
    await markDeleted(removed.id);
    const before = await taskRows();

    const res = await listTasks(a.workspace.id, a.cookie);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const { tasks } = TaskListResponse.parse(await res.json());
    expect(tasks.map((t) => t.id)).toEqual([milk.id, invoice.id, mum.id]);
    expect(tasks.every((t) => t.workspaceId === a.workspace.id && t.completedAt === null)).toBe(true);
    expect(await taskRows()).toEqual(before);
  });

  it('list defaults to inbox when the parameter is missing', async () => {
    const { workspace, cookie } = await createWorkspace();
    const milk = await createdTask(workspace.id, cookie, { name: TASK_NAMES.milk });
    const res = await listTasks(workspace.id, cookie, '');
    expect(res.status).toBe(200);
    expect(TaskListResponse.parse(await res.json()).tasks.map((t) => t.id)).toEqual([milk.id]);
  });

  it('TC-26 an unknown list is 400 validation', async () => {
    const { workspace, cookie } = await createWorkspace();
    const res = await listTasks(workspace.id, cookie, '?list=bogus');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'validation' });
  });

  it('TC-27 an empty workspace lists []', async () => {
    const { workspace, cookie } = await createWorkspace();
    const res = await listTasks(workspace.id, cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tasks: [] });
  });
});

describe('GET /api/w/:id/counts', () => {
  it('TC-28 counts 3 open tasks when 1 is completed and 1 deleted', async () => {
    const { workspace, cookie } = await createWorkspace();
    const created = [];
    for (const name of ['A', 'B', 'C', 'D', 'E']) created.push(await createdTask(workspace.id, cookie, { name }));
    await markCompleted(created[0]!.id);
    await markDeleted(created[4]!.id);
    const before = await taskRows();
    const res = await getCounts(workspace.id, cookie);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(CountsSchema.parse(await res.json())).toEqual({ inbox: 3 });
    expect(await taskRows()).toEqual(before);
  });

  it('counts only this workspace', async () => {
    const a = await createWorkspace();
    const b = await createWorkspace(a.cookie);
    await createdTask(b.workspace.id, b.cookie, { name: TASK_NAMES.milk });
    expect(await (await getCounts(a.workspace.id, a.cookie)).json()).toEqual({ inbox: 0 });
  });
});

describe('list and counts auth', () => {
  it('TC-29 without a cookie both are 404 not_found', async () => {
    const { workspace } = await createWorkspace();
    for (const res of [await listTasks(workspace.id, null), await getCounts(workspace.id, null)]) {
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: 'not_found' });
    }
  });

  it('a cookie for another workspace is 404 for both', async () => {
    const a = await createWorkspace();
    const b = await createWorkspace();
    expect((await listTasks(a.workspace.id, b.cookie)).status).toBe(404);
    expect((await getCounts(a.workspace.id, b.cookie)).status).toBe(404);
  });
});
