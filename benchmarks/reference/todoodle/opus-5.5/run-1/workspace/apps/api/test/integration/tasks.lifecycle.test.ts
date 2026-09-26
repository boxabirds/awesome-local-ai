import { LiveEvent } from '@todoodle/shared/events';
import { TaskListResponse, TaskResponse } from '@todoodle/shared/schemas';
import { describe, expect, it } from 'vitest';
import type { TaskRow } from '../../src/db/tasks.ts';
import { CLIENT_ID_HEADER } from '../../src/live/broadcast.ts';
import { newTaskId } from '../fixtures/tasks.ts';
import { connectLive, framesAfter, type LiveClient } from '../support/live.ts';
import {
  ALL_OPERATIONS,
  type LifecycleOp,
  type PriorState,
  createTask,
  deleteTask,
  lifecycle,
  listTasks,
  member,
  seedRealisticWorkspaces,
  taskInState,
  taskRow,
  taskRows,
} from '../support/tasks.ts';
import { Browser } from '../support/workspaces.ts';

// Story 6, design Matrices A and C: complete, reopen, delete and restore against real D1 and a real
// WorkspaceRoom (a live socket captures broadcasts). Each case checks the response, the D1 row before and
// after, and whether an event was (or, within NO_EVENT_WAIT_MS, was not) broadcast.

/** How long a test waits to be sure no event was broadcast. */
const NO_EVENT_WAIT_MS = 300;
const CLIENT_X = '6f1c2a4e-9b3d-4c7a-8e21-5d0f9a7b3c11';

type Op = LifecycleOp | 'delete';

function run(browser: Browser, ws: string, id: string, op: Op, headers?: Record<string, string>) {
  return op === 'delete' ? deleteTask(browser, ws, id, headers) : lifecycle(browser, ws, id, op, headers);
}

async function setup(state: PriorState) {
  const { browser, id: ws } = await member();
  const taskId = await taskInState(browser, ws, state);
  const before = (await taskRow(taskId))!;
  const socket = await connectLive(browser, ws);
  return { browser, ws, taskId, before, socket };
}

async function expectNoEvent(socket: LiveClient) {
  expect(await framesAfter(socket, NO_EVENT_WAIT_MS)).toEqual([]);
  socket.close();
}

async function nextEvent(socket: LiveClient): Promise<LiveEvent> {
  const [frame] = await socket.waitForFrames(1);
  socket.close();
  return LiveEvent.parse(JSON.parse(frame!));
}

/** Columns every lifecycle call must leave alone. */
function untouched(row: TaskRow) {
  return { name: row.name, description: row.description, sort_order: row.sort_order, workspace_id: row.workspace_id, created_at: row.created_at };
}

describe('tasks.complete: POST /tasks/:id/complete (Matrix A)', () => {
  it('TC-I01 Open -> 200 with completedAt; Completed, sort_order unchanged, version +1, task.upserted', async () => {
    const { browser, ws, taskId, before, socket } = await setup('Open');
    const res = await lifecycle(browser, ws, taskId, 'complete');
    expect(res.status).toBe(200);
    const { task } = TaskResponse.parse(await res.json());
    expect(task.completedAt).toEqual(expect.any(String));
    expect(Number.isNaN(Date.parse(task.completedAt!))).toBe(false);
    const after = (await taskRow(taskId))!;
    expect(after).toMatchObject({ ...untouched(before), completed_at: task.completedAt, deleted: 0, version: before.version + 1 });
    const event = await nextEvent(socket);
    expect(event).toMatchObject({ type: 'task.upserted', version: before.version + 1, entity: { id: taskId, completedAt: task.completedAt } });
  });

  it('TC-I02 Completed -> 200 unchanged task; completed_at and version unchanged; no event', async () => {
    const { browser, ws, taskId, before, socket } = await setup('Completed');
    const res = await lifecycle(browser, ws, taskId, 'complete');
    expect(res.status).toBe(200);
    expect(TaskResponse.parse(await res.json()).task).toMatchObject({ id: taskId, completedAt: before.completed_at, version: before.version });
    expect(await taskRow(taskId)).toEqual(before);
    await expectNoEvent(socket);
  });

  it.each(['DeletedOpen', 'DeletedCompleted'] as const)('TC-I03/TC-I04 %s -> 410 gone; nothing changes; no event', async (state) => {
    const { browser, ws, taskId, before, socket } = await setup(state);
    const res = await lifecycle(browser, ws, taskId, 'complete');
    expect(res.status).toBe(410);
    expect(await res.json()).toMatchObject({ error: 'gone' });
    expect(await taskRow(taskId)).toEqual(before);
    await expectNoEvent(socket);
  });

  it('TC-I05 Missing -> 404 not_found; no row affected; no event', async () => {
    const { browser, ws, socket } = await setup('Open');
    const before = await taskRows();
    const res = await lifecycle(browser, ws, newTaskId(), 'complete');
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'not_found' });
    expect(await taskRows()).toEqual(before);
    await expectNoEvent(socket);
  });
});

describe('tasks.reopen: POST /tasks/:id/reopen (Matrix A)', () => {
  it('TC-I06 Open -> 200 unchanged; version unchanged; no event', async () => {
    const { browser, ws, taskId, before, socket } = await setup('Open');
    const res = await lifecycle(browser, ws, taskId, 'reopen');
    expect(res.status).toBe(200);
    expect(TaskResponse.parse(await res.json()).task).toMatchObject({ completedAt: null, version: before.version });
    expect(await taskRow(taskId)).toEqual(before);
    await expectNoEvent(socket);
  });

  it('TC-I07 Completed -> 200 completedAt null; Open, sort_order unchanged, version +1, task.upserted', async () => {
    const { browser, ws, taskId, before, socket } = await setup('Completed');
    const res = await lifecycle(browser, ws, taskId, 'reopen');
    expect(res.status).toBe(200);
    expect(TaskResponse.parse(await res.json()).task).toMatchObject({ completedAt: null, version: before.version + 1 });
    expect(await taskRow(taskId)).toMatchObject({ ...untouched(before), completed_at: null, deleted: 0, version: before.version + 1 });
    expect(await nextEvent(socket)).toMatchObject({ type: 'task.upserted', version: before.version + 1, entity: { id: taskId, completedAt: null } });
  });

  it.each(['DeletedOpen', 'DeletedCompleted'] as const)('TC-I08/TC-I09 %s -> 410 gone; nothing changes; no event', async (state) => {
    const { browser, ws, taskId, before, socket } = await setup(state);
    const res = await lifecycle(browser, ws, taskId, 'reopen');
    expect(res.status).toBe(410);
    expect(await taskRow(taskId)).toEqual(before);
    await expectNoEvent(socket);
  });

  it('TC-I10 Missing -> 404 not_found', async () => {
    const { browser, ws, socket } = await setup('Completed');
    const before = await taskRows();
    const res = await lifecycle(browser, ws, newTaskId(), 'reopen');
    expect(res.status).toBe(404);
    expect(await taskRows()).toEqual(before);
    await expectNoEvent(socket);
  });
});

describe('tasks.delete: DELETE /tasks/:id (Matrix A)', () => {
  it('TC-I16 Open -> 204; DeletedOpen with deleted_at set, other columns unchanged, version +1, task.deleted', async () => {
    const { browser, ws, taskId, before, socket } = await setup('Open');
    const res = await deleteTask(browser, ws, taskId);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    const after = (await taskRow(taskId))!;
    expect(after).toMatchObject({ ...untouched(before), completed_at: null, deleted: 1, version: before.version + 1 });
    expect(after.deleted_at).toEqual(expect.any(String));
    expect(await nextEvent(socket)).toEqual({ type: 'task.deleted', entity: { id: taskId }, version: before.version + 1, originClientId: null });
  });

  it('TC-I17 Completed -> 204; DeletedCompleted, completed_at kept', async () => {
    const { browser, ws, taskId, before, socket } = await setup('Completed');
    expect((await deleteTask(browser, ws, taskId)).status).toBe(204);
    expect(await taskRow(taskId)).toMatchObject({ ...untouched(before), completed_at: before.completed_at, deleted: 1, version: before.version + 1 });
    expect(await nextEvent(socket)).toMatchObject({ type: 'task.deleted', entity: { id: taskId } });
  });

  it.each(['DeletedOpen', 'DeletedCompleted'] as const)('TC-I18/TC-I19 %s -> 204 no-op; deleted_at and version unchanged; no event', async (state) => {
    const { browser, ws, taskId, before, socket } = await setup(state);
    expect((await deleteTask(browser, ws, taskId)).status).toBe(204);
    expect(await taskRow(taskId)).toEqual(before);
    await expectNoEvent(socket);
  });

  it('TC-I20 Missing -> 404 not_found', async () => {
    const { browser, ws, socket } = await setup('Open');
    const before = await taskRows();
    const res = await deleteTask(browser, ws, newTaskId());
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'not_found' });
    expect(await taskRows()).toEqual(before);
    await expectNoEvent(socket);
  });
});

describe('tasks.restore: POST /tasks/:id/restore (Matrix A)', () => {
  it.each(['Open', 'Completed'] as const)('TC-I21/TC-I22 %s -> 200 unchanged task; no event', async (state) => {
    const { browser, ws, taskId, before, socket } = await setup(state);
    const res = await lifecycle(browser, ws, taskId, 'restore');
    expect(res.status).toBe(200);
    expect(TaskResponse.parse(await res.json()).task).toMatchObject({ id: taskId, version: before.version, completedAt: before.completed_at });
    expect(await taskRow(taskId)).toEqual(before);
    await expectNoEvent(socket);
  });

  it('TC-I23 DeletedOpen -> 200; Open, deleted_at null, same sort_order, version +1, task.restored', async () => {
    const { browser, ws, taskId, before, socket } = await setup('DeletedOpen');
    const res = await lifecycle(browser, ws, taskId, 'restore');
    expect(res.status).toBe(200);
    const { task } = TaskResponse.parse(await res.json());
    expect(task).toMatchObject({ completedAt: null, version: before.version + 1, sortOrder: before.sort_order });
    expect(await taskRow(taskId)).toMatchObject({ ...untouched(before), deleted: 0, deleted_at: null, completed_at: null, version: before.version + 1 });
    expect(await nextEvent(socket)).toMatchObject({ type: 'task.restored', version: before.version + 1, entity: { id: taskId, sortOrder: before.sort_order } });
  });

  it('TC-I24 DeletedCompleted -> 200; Completed, completed_at kept', async () => {
    const { browser, ws, taskId, before, socket } = await setup('DeletedCompleted');
    const res = await lifecycle(browser, ws, taskId, 'restore');
    expect(res.status).toBe(200);
    expect(TaskResponse.parse(await res.json()).task.completedAt).toBe(before.completed_at);
    expect(await taskRow(taskId)).toMatchObject({ ...untouched(before), deleted: 0, deleted_at: null, completed_at: before.completed_at, version: before.version + 1 });
    expect(await nextEvent(socket)).toMatchObject({ type: 'task.restored', entity: { id: taskId, completedAt: before.completed_at } });
  });

  it('TC-I25 Missing -> 404 not_found', async () => {
    const { browser, ws, socket } = await setup('DeletedOpen');
    const before = await taskRows();
    const res = await lifecycle(browser, ws, newTaskId(), 'restore');
    expect(res.status).toBe(404);
    expect(await taskRows()).toEqual(before);
    await expectNoEvent(socket);
  });
});

describe('tasks lifecycle: access and cross-cutting (Matrix C)', () => {
  it('TC-I41 a task id from workspace B while authenticated for A -> 404 for all five operations; B row unchanged', async () => {
    const { a, b } = await seedRealisticWorkspaces();
    const bTask = await createTask(b.browser, b.id, 'Only in B');
    const before = await taskRow(bTask);
    const onB = await connectLive(b.browser, b.id);
    for (const op of ALL_OPERATIONS) {
      const viaA = await op.run(a.browser, a.id, bTask);
      expect(viaA.status, op.label).toBe(404);
      expect(await viaA.json()).toMatchObject({ error: 'not_found' });
    }
    expect(await taskRow(bTask)).toEqual(before);
    await expectNoEvent(onB);
  });

  it("TC-I41 (path) A's cookie against B's workspace path -> 404 for all five operations", async () => {
    const a = await member();
    const b = await member();
    const bTask = await createTask(b.browser, b.id, 'Only in B');
    const before = await taskRow(bTask);
    for (const op of ALL_OPERATIONS) expect((await op.run(a.browser, b.id, bTask)).status, op.label).toBe(404);
    expect(await taskRow(bTask)).toEqual(before);
  });

  it('TC-I42 no tdl_ws cookie -> 404 for every operation; nothing changed', async () => {
    const { browser, id } = await member();
    const taskId = await createTask(browser, id, 'Buy milk');
    const before = await taskRows();
    const stranger = new Browser();
    for (const op of ALL_OPERATIONS) {
      const res = await op.run(stranger, id, taskId);
      expect(res.status, op.label).toBe(404);
      expect(await res.json()).toMatchObject({ error: 'not_found' });
    }
    expect(await taskRows()).toEqual(before);
  });

  it('TC-I43 a mutation without X-Todoodle-Client -> 403 forbidden_client; nothing changed', async () => {
    const { browser, id } = await member();
    const taskId = await taskInState(browser, id, 'Completed');
    const before = await taskRows();
    for (const op of ['complete', 'reopen', 'restore', 'delete'] as const) {
      const res = await run(browser, id, taskId, op, {});
      expect(res.status, op).toBe(403);
      expect(await res.json()).toMatchObject({ error: 'forbidden_client' });
    }
    expect(await taskRows()).toEqual(before);
  });

  it('a lifecycle call with a non-empty JSON body -> 400; a text/plain body -> 415; nothing changed', async () => {
    const { browser, id } = await member();
    const taskId = await createTask(browser, id, 'Buy milk');
    const before = await taskRows();
    const bad = await browser.fetch(`/api/w/${id}/tasks/${taskId}/complete`, {
      method: 'POST',
      headers: { 'X-Todoodle-Client': 'web', 'Content-Type': 'application/json' },
      body: JSON.stringify({ completedAt: '2020-01-01T00:00:00.000Z' }),
    });
    expect(bad.status).toBe(400);
    const plain = await browser.fetch(`/api/w/${id}/tasks/${taskId}/complete`, {
      method: 'POST',
      headers: { 'X-Todoodle-Client': 'web', 'Content-Type': 'text/plain' },
      body: '{}',
    });
    expect(plain.status).toBe(415);
    expect(await plain.json()).toMatchObject({ error: 'unsupported_media_type' });
    const empty = await browser.fetch(`/api/w/${id}/tasks/${taskId}/complete`, {
      method: 'POST',
      headers: { 'X-Todoodle-Client': 'web', 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(empty.status).toBe(200);
    expect((await taskRow(taskId))?.completed_at).not.toBeNull();
    expect(before).toHaveLength(1);
  });

  it('TC-I45 the broadcast carries originClientId from X-Todoodle-Client-Id and the new version', async () => {
    const { browser, id } = await member();
    const taskId = await createTask(browser, id, 'Buy milk');
    const socket = await connectLive(browser, id);
    const res = await lifecycle(browser, id, taskId, 'complete', { 'X-Todoodle-Client': 'web', [CLIENT_ID_HEADER]: CLIENT_X });
    expect(res.status).toBe(200);
    const event = await nextEvent(socket);
    expect(event.originClientId).toBe(CLIENT_X);
    expect(event.version).toBe(2);
    expect(event.entity).toMatchObject({ id: taskId, version: 2 });
  });

  it('TC-I46 reopen position: A, B, C; complete B; reopen B -> list order A, B, C', async () => {
    const { browser, id } = await member();
    const [a, b, c] = [await createTask(browser, id, 'A'), await createTask(browser, id, 'B'), await createTask(browser, id, 'C')];
    expect((await lifecycle(browser, id, b, 'complete')).status).toBe(200);
    const middle = TaskListResponse.parse(await (await listTasks(browser, id)).json()).tasks.map((t) => t.id);
    expect(middle).toEqual([a, c]);
    expect((await lifecycle(browser, id, b, 'reopen')).status).toBe(200);
    const after = TaskListResponse.parse(await (await listTasks(browser, id)).json()).tasks.map((t) => t.id);
    expect(after).toEqual([a, b, c]);
  });

  it('TC-I48 retention: after delete the raw D1 row still exists with deleted=1, deleted_at set and every field intact', async () => {
    const { a, ids } = await seedRealisticWorkspaces();
    const target = ids[0]!;
    const before = (await taskRow(target))!;
    expect((await deleteTask(a.browser, a.id, target)).status).toBe(204);
    const raw = (await taskRow(target))!;
    expect(raw).toMatchObject({ ...untouched(before), completed_at: before.completed_at, deleted: 1 });
    expect(raw.deleted_at).toEqual(expect.any(String));
    // Gone from every read the app makes.
    for (const query of ['?list=inbox', '?list=inbox&include_completed=true']) {
      const { tasks } = TaskListResponse.parse(await (await listTasks(a.browser, a.id, query)).json());
      expect(tasks.some((t) => t.id === target)).toBe(false);
    }
    // And through the test-only raw read the e2e suite uses.
    const viaRoute = await a.browser.fetch(`/test/tasks/${target}/raw`);
    expect(viaRoute.status).toBe(200);
    expect(((await viaRoute.json()) as { task: TaskRow }).task).toMatchObject({ id: target, deleted: 1, name: before.name });
  });

  it('TC-I49 undo race: two concurrent restores -> both 200, version +1 once, one task.restored', async () => {
    const { browser, ws, taskId, before, socket } = await setup('DeletedOpen');
    const [first, second] = await Promise.all([lifecycle(browser, ws, taskId, 'restore'), lifecycle(browser, ws, taskId, 'restore')]);
    expect([first.status, second.status]).toEqual([200, 200]);
    expect((await taskRow(taskId))?.version).toBe(before.version + 1);
    const frames = await framesAfter(socket, NO_EVENT_WAIT_MS * 2);
    socket.close();
    expect(frames).toHaveLength(1);
    expect(LiveEvent.parse(JSON.parse(frames[0]!)).type).toBe('task.restored');
  });

  it('TC-I50 bodyless POST complete, reopen, restore and bodyless DELETE with only the client header are accepted', async () => {
    const { browser, id } = await member();
    const taskId = await createTask(browser, id, 'Buy milk');
    const steps: Array<[Op, number]> = [
      ['complete', 200],
      ['reopen', 200],
      ['delete', 204],
      ['restore', 200],
    ];
    for (const [op, status] of steps) {
      const res = await run(browser, id, taskId, op, { 'X-Todoodle-Client': 'web' });
      expect(res.status, op).toBe(status);
    }
    expect(await taskRow(taskId)).toMatchObject({ deleted: 0, completed_at: null, version: 5 });
  });

  it('a malformed task id is a plain 404', async () => {
    const { browser, id } = await member();
    expect((await lifecycle(browser, id, 'not-a-task', 'complete')).status).toBe(404);
    expect((await deleteTask(browser, id, 'NOT-HEX')).status).toBe(404);
  });
});
