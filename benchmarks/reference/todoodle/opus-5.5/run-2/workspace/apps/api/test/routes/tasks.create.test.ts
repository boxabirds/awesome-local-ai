import { LiveEvent } from '@todoodle/shared/events';
import { TaskSchema, type Task } from '@todoodle/shared/schemas';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DESCRIPTION_AT_LIMIT,
  DESCRIPTION_OVER_LIMIT,
  MULTILINE_DESCRIPTION,
  NAME_AT_LIMIT,
  NAME_OVER_LIMIT,
  newTaskId,
  TASK_NAMES,
} from '../fixtures/tasks';
import { connectLive, type LiveClient, sleep } from '../live-helpers';
import { countTaskRows, createTask, createTaskAsText, listTasks, markDeleted, taskRows } from '../task-helpers';
import { cookieFor, createWorkspace, post } from '../workspace-helpers';

const CLIENT_X = '6c1f7a52-3d4e-4f8a-9b0c-1d2e3f4a5b6c';
/** Long enough for a broadcast (waitUntil) to have arrived if one was sent. */
const NO_FRAME_WAIT_MS = 400;

const sockets: LiveClient[] = [];
afterEach(() => sockets.splice(0).forEach((s) => s.close()));
async function live(workspaceId: string, cookie: string) {
  const client = await connectLive(workspaceId, cookie);
  sockets.push(client);
  return client;
}

async function taskFrom(res: Response): Promise<Task> {
  return TaskSchema.parse(((await res.json()) as { task: unknown }).task);
}

async function expectValidationError(res: Response) {
  expect(res.status).toBe(400);
  expect(await res.json()).toMatchObject({ error: 'validation' });
}

describe('POST /api/w/:id/tasks', () => {
  it('TC-01 creates a task: 201 with name, empty description, sortOrder 1, version 1, open', async () => {
    const { workspace, cookie } = await createWorkspace();
    expect(await countTaskRows()).toBe(0);
    const id = newTaskId();
    const res = await createTask(workspace.id, cookie, { id, name: TASK_NAMES.milk });
    expect(res.status).toBe(201);
    const task = await taskFrom(res);
    expect(task).toMatchObject({ id, workspaceId: workspace.id, name: 'Buy milk', description: '', sortOrder: 1, version: 1, completedAt: null });
    expect(await taskRows()).toEqual([expect.objectContaining({ id, name: 'Buy milk' })]);
  });

  it('TC-02 trims the name before storing', async () => {
    const { workspace, cookie } = await createWorkspace();
    const res = await createTask(workspace.id, cookie, { name: '  Buy milk  ' });
    expect(res.status).toBe(201);
    expect((await taskFrom(res)).name).toBe('Buy milk');
    expect((await taskRows())[0]?.name).toBe('Buy milk');
  });

  it('TC-03 an empty name is 400 validation on name; nothing stored', async () => {
    const { workspace, cookie } = await createWorkspace();
    await expectValidationError(await createTask(workspace.id, cookie, { name: '' }));
    expect(await countTaskRows()).toBe(0);
  });

  it('TC-04 a name of spaces and a tab is 400; nothing stored', async () => {
    const { workspace, cookie } = await createWorkspace();
    await expectValidationError(await createTask(workspace.id, cookie, { name: '  \t ' }));
    expect(await countTaskRows()).toBe(0);
  });

  it('TC-05 a 1-character name is created', async () => {
    const { workspace, cookie } = await createWorkspace();
    expect((await createTask(workspace.id, cookie, { name: 'x' })).status).toBe(201);
    expect(await countTaskRows()).toBe(1);
  });

  it('TC-06 a name exactly at the limit is stored in full', async () => {
    const { workspace, cookie } = await createWorkspace();
    expect((await createTask(workspace.id, cookie, { name: NAME_AT_LIMIT })).status).toBe(201);
    expect((await taskRows())[0]?.name).toHaveLength(NAME_AT_LIMIT.length);
  });

  it('TC-07 a name one over the limit is 400; nothing stored', async () => {
    const { workspace, cookie } = await createWorkspace();
    await expectValidationError(await createTask(workspace.id, cookie, { name: NAME_OVER_LIMIT }));
    expect(await countTaskRows()).toBe(0);
  });

  it('TC-08 a description exactly at the limit is created', async () => {
    const { workspace, cookie } = await createWorkspace();
    expect((await createTask(workspace.id, cookie, { name: 'n', description: DESCRIPTION_AT_LIMIT })).status).toBe(201);
    expect((await taskRows())[0]?.description).toHaveLength(DESCRIPTION_AT_LIMIT.length);
  });

  it('TC-09 a description one over the limit is 400; nothing stored', async () => {
    const { workspace, cookie } = await createWorkspace();
    await expectValidationError(await createTask(workspace.id, cookie, { name: 'n', description: DESCRIPTION_OVER_LIMIT }));
    expect(await countTaskRows()).toBe(0);
  });

  it('TC-10 emoji name and multi-line description round-trip byte-identical', async () => {
    const { workspace, cookie } = await createWorkspace();
    const res = await createTask(workspace.id, cookie, { name: TASK_NAMES.mum, description: MULTILINE_DESCRIPTION });
    expect(res.status).toBe(201);
    expect(await taskFrom(res)).toMatchObject({ name: 'Call Mum 📞', description: MULTILINE_DESCRIPTION });
    const listed = ((await (await listTasks(workspace.id, cookie)).json()) as { tasks: Task[] }).tasks;
    expect(listed[0]).toMatchObject({ name: 'Call Mum 📞', description: MULTILINE_DESCRIPTION });
  });

  it('TC-11 a replay of the same id is 200 with the existing task, version unchanged', async () => {
    const { workspace, cookie } = await createWorkspace();
    const id = newTaskId();
    const first = await taskFrom(await createTask(workspace.id, cookie, { id, name: TASK_NAMES.milk }));
    const replay = await createTask(workspace.id, cookie, { id, name: TASK_NAMES.milk });
    expect(replay.status).toBe(200);
    expect(await taskFrom(replay)).toEqual(first);
    expect(await taskRows()).toEqual([expect.objectContaining({ id, version: 1 })]);
  });

  it('TC-12 a replay with a different name returns the ORIGINAL name and never overwrites', async () => {
    const { workspace, cookie } = await createWorkspace();
    const id = newTaskId();
    await createTask(workspace.id, cookie, { id, name: TASK_NAMES.milk });
    const replay = await createTask(workspace.id, cookie, { id, name: 'Buy oat milk', description: 'changed' });
    expect(replay.status).toBe(200);
    expect(await taskFrom(replay)).toMatchObject({ name: 'Buy milk', description: '' });
    expect(await taskRows()).toEqual([expect.objectContaining({ name: 'Buy milk', description: '', version: 1 })]);
  });

  it('TC-13 an id soft-deleted in this workspace is 410 gone; the row stays deleted', async () => {
    const { workspace, cookie } = await createWorkspace();
    const id = newTaskId();
    await createTask(workspace.id, cookie, { id, name: TASK_NAMES.milk });
    await markDeleted(id);
    const res = await createTask(workspace.id, cookie, { id, name: TASK_NAMES.milk });
    expect(res.status).toBe(410);
    expect(await res.json()).toMatchObject({ error: 'gone' });
    expect(await taskRows()).toEqual([expect.objectContaining({ id, deleted: 1 })]);
  });

  it('TC-14 an id used in another workspace is 409 id_conflict; the other row is untouched', async () => {
    const a = await createWorkspace();
    const b = await createWorkspace(a.cookie);
    const id = newTaskId();
    await createTask(a.workspace.id, a.cookie, { id, name: TASK_NAMES.invoice });
    const before = await taskRows(a.workspace.id);
    const res = await createTask(b.workspace.id, b.cookie, { id, name: 'Hijack' });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'id_conflict' });
    expect(await taskRows(a.workspace.id)).toEqual(before);
    expect(await countTaskRows(b.workspace.id)).toBe(0);
  });

  it('TC-15 a malformed id is 400 validation; nothing stored', async () => {
    const { workspace, cookie } = await createWorkspace();
    await expectValidationError(await createTask(workspace.id, cookie, { id: 'ABC', name: TASK_NAMES.milk }));
    await expectValidationError(await createTask(workspace.id, cookie, { id: newTaskId().toUpperCase(), name: TASK_NAMES.milk }));
    expect(await countTaskRows()).toBe(0);
  });

  it('a body that is not JSON at all is 400 validation', async () => {
    const { workspace, cookie } = await createWorkspace();
    const res = await post(`/api/w/${workspace.id}/tasks`, { cookie, body: '{not json' });
    await expectValidationError(res);
  });

  it('TC-16 no cookie is 404 not_found; nothing stored', async () => {
    const { workspace } = await createWorkspace();
    const res = await createTask(workspace.id, null, { name: TASK_NAMES.milk });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'not_found' });
    expect(await countTaskRows()).toBe(0);
  });

  it('TC-17 a cookie for another workspace is 404; nothing stored in either', async () => {
    const a = await createWorkspace();
    const b = await createWorkspace();
    const res = await createTask(a.workspace.id, b.cookie, { name: TASK_NAMES.milk });
    expect(res.status).toBe(404);
    expect(await countTaskRows()).toBe(0);
    // A forged entry with the wrong secret for A is refused the same way.
    const forged = cookieFor([{ id: a.workspace.id, s: b.secret, t: 1 }]);
    expect((await createTask(a.workspace.id, forged, { name: TASK_NAMES.milk })).status).toBe(404);
    expect(await countTaskRows()).toBe(0);
  });

  it('TC-18 without the X-Todoodle-Client header it is 403 forbidden_client', async () => {
    const { workspace, cookie } = await createWorkspace();
    const res = await createTask(workspace.id, cookie, { name: TASK_NAMES.milk }, { 'X-Todoodle-Client': '' });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'forbidden_client' });
    expect(await countTaskRows()).toBe(0);
  });

  it('TC-19 a text/plain body with the CSRF header is 415 unsupported_media_type', async () => {
    const { workspace, cookie } = await createWorkspace();
    const res = await createTaskAsText(workspace.id, cookie, { id: newTaskId(), name: TASK_NAMES.milk });
    expect(res.status).toBe(415);
    expect(await res.json()).toMatchObject({ error: 'unsupported_media_type' });
    expect(await countTaskRows()).toBe(0);
  });

  it('TC-20 three sequential creates get sortOrder 1, 2, 3 and list as A, B, C', async () => {
    const { workspace, cookie } = await createWorkspace();
    const orders = [];
    for (const name of ['A', 'B', 'C']) orders.push((await taskFrom(await createTask(workspace.id, cookie, { name }))).sortOrder);
    expect(orders).toEqual([1, 2, 3]);
    const listed = ((await (await listTasks(workspace.id, cookie)).json()) as { tasks: Task[] }).tasks;
    expect(listed.map((t) => t.name)).toEqual(['A', 'B', 'C']);
  });

  it('TC-21 ten concurrent creates make ten rows with distinct sortOrder values', async () => {
    const { workspace, cookie } = await createWorkspace();
    const responses = await Promise.all(Array.from({ length: 10 }, (_, i) => createTask(workspace.id, cookie, { name: `Task ${i}` })));
    expect(responses.map((r) => r.status)).toEqual(Array(10).fill(201));
    const rows = await taskRows(workspace.id);
    expect(rows).toHaveLength(10);
    expect(new Set(rows.map((r) => r.sort_order)).size).toBe(10);
  });
});

describe('POST /api/w/:id/tasks broadcasts', () => {
  it('TC-22 a create sends exactly one task.upserted with the origin client id echoed', async () => {
    const { workspace, cookie } = await createWorkspace();
    const socket = await live(workspace.id, cookie);
    const res = await createTask(workspace.id, cookie, { name: TASK_NAMES.milk }, { 'X-Todoodle-Client-Id': CLIENT_X });
    const task = await taskFrom(res);
    const event = LiveEvent.parse(JSON.parse(await socket.nextFrame(0)));
    expect(event).toEqual({ type: 'task.upserted', entity: task, version: 1, originClientId: CLIENT_X });
    await sleep(NO_FRAME_WAIT_MS);
    expect(socket.frames).toHaveLength(1);
  });

  it('TC-23 a replay broadcasts nothing', async () => {
    const { workspace, cookie } = await createWorkspace();
    const id = newTaskId();
    await createTask(workspace.id, cookie, { id, name: TASK_NAMES.milk });
    const socket = await live(workspace.id, cookie);
    expect((await createTask(workspace.id, cookie, { id, name: TASK_NAMES.milk })).status).toBe(200);
    await sleep(NO_FRAME_WAIT_MS);
    expect(socket.frames).toEqual([]);
  });

  it('TC-24 an invalid create broadcasts nothing', async () => {
    const { workspace, cookie } = await createWorkspace();
    const socket = await live(workspace.id, cookie);
    expect((await createTask(workspace.id, cookie, { name: '' })).status).toBe(400);
    await sleep(NO_FRAME_WAIT_MS);
    expect(socket.frames).toEqual([]);
  });
});
