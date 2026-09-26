import { TASK_DESCRIPTION_MAX, TASK_NAME_MAX } from '@todoodle/shared/limits';
import { LiveEvent } from '@todoodle/shared/events';
import { TaskResponse } from '@todoodle/shared/schemas';
import { describe, expect, it } from 'vitest';
import { CLIENT_ID_HEADER } from '../../src/live/broadcast.ts';
import {
  DESCRIPTION_AT_LIMIT,
  DESCRIPTION_OVER_LIMIT,
  MULTI_LINE_DESCRIPTION,
  NAME_AT_LIMIT,
  NAME_OVER_LIMIT,
  TASK_NAMES,
  newTaskId,
} from '../fixtures/tasks.ts';
import { CLIENT } from '../support/http.ts';
import { connectLive, framesAfter } from '../support/live.ts';
import { listTasks, markDeleted, member, postTask, taskRow, taskRows } from '../support/tasks.ts';
import { Browser, JSON_CLIENT, cookieFor } from '../support/workspaces.ts';

const CLIENT_X = '6f1c2a4e-9b3d-4c7a-8e21-5d0f9a7b3c11';

async function errorCode(res: Response): Promise<string> {
  return ((await res.json()) as { error: string }).error;
}

describe('tasks.create_api: valid input', () => {
  it("TC-01 'Buy milk' with no description -> 201 with defaults; 0 -> 1 row", async () => {
    const { browser, id } = await member();
    expect(await taskRows(id)).toHaveLength(0);
    const taskId = newTaskId();
    const res = await postTask(browser, id, { id: taskId, name: TASK_NAMES.milk });
    expect(res.status).toBe(201);
    const { task } = TaskResponse.parse(await res.json());
    expect(task).toMatchObject({
      id: taskId,
      workspaceId: id,
      name: 'Buy milk',
      description: '',
      sortOrder: 1,
      version: 1,
      completedAt: null,
    });
    const rows = await taskRows(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: taskId, name: 'Buy milk', description: '', sort_order: 1, deleted: 0 });
  });

  it('TC-02 the name is stored trimmed', async () => {
    const { browser, id } = await member();
    const taskId = newTaskId();
    const res = await postTask(browser, id, { id: taskId, name: '  Buy milk  ' });
    expect(res.status).toBe(201);
    expect((await taskRow(taskId))?.name).toBe('Buy milk');
  });

  it("TC-05 a 1-char name 'x' is accepted", async () => {
    const { browser, id } = await member();
    const res = await postTask(browser, id, { id: newTaskId(), name: 'x' });
    expect(res.status).toBe(201);
    expect(await taskRows(id)).toHaveLength(1);
  });

  it('TC-06 a name of exactly TASK_NAME_MAX chars is stored in full', async () => {
    const { browser, id } = await member();
    const taskId = newTaskId();
    const res = await postTask(browser, id, { id: taskId, name: NAME_AT_LIMIT });
    expect(res.status).toBe(201);
    expect((await taskRow(taskId))?.name).toHaveLength(TASK_NAME_MAX);
  });

  it('TC-08 a description of exactly TASK_DESCRIPTION_MAX chars is accepted', async () => {
    const { browser, id } = await member();
    const taskId = newTaskId();
    const res = await postTask(browser, id, { id: taskId, name: 'x', description: DESCRIPTION_AT_LIMIT });
    expect(res.status).toBe(201);
    expect((await taskRow(taskId))?.description).toHaveLength(TASK_DESCRIPTION_MAX);
  });

  it('TC-10 emoji name and multi-line description round-trip byte-identical', async () => {
    const { browser, id } = await member();
    const taskId = newTaskId();
    const res = await postTask(browser, id, { id: taskId, name: TASK_NAMES.mum, description: MULTI_LINE_DESCRIPTION });
    expect(res.status).toBe(201);
    const { task } = TaskResponse.parse(await res.json());
    expect(task.name).toBe(TASK_NAMES.mum);
    expect(task.description).toBe(MULTI_LINE_DESCRIPTION);
    const listed = (await (await listTasks(browser, id)).json()) as { tasks: Array<{ name: string; description: string }> };
    expect(listed.tasks[0]).toMatchObject({ name: TASK_NAMES.mum, description: MULTI_LINE_DESCRIPTION });
  });
});

describe('tasks.create_api: rejected input creates nothing', () => {
  it.each([
    ['TC-03 empty name', { name: '' }],
    ['TC-04 spaces and a tab', { name: '  \t  ' }],
    ['TC-07 name of TASK_NAME_MAX + 1 chars', { name: NAME_OVER_LIMIT }],
    ['TC-09 description of TASK_DESCRIPTION_MAX + 1 chars', { name: 'x', description: DESCRIPTION_OVER_LIMIT }],
  ])('%s -> 400 validation; 0 -> 0 rows', async (_label, fields) => {
    const { browser, id } = await member();
    const res = await postTask(browser, id, { id: newTaskId(), ...fields });
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe('validation');
    expect(await taskRows()).toHaveLength(0);
  });

  it.each([['ABC'], ['A'.repeat(32)], ['g'.repeat(32)], [123], [undefined]])('TC-15 id %s is rejected before lookup', async (bad) => {
    const { browser, id } = await member();
    const res = await postTask(browser, id, { id: bad, name: 'Buy milk' });
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe('validation');
    expect(await taskRows()).toHaveLength(0);
  });

  it('a body that is not valid JSON is 400', async () => {
    const { browser, id } = await member();
    const res = await postTask(browser, id, '{nope');
    expect(res.status).toBe(400);
    expect(await taskRows()).toHaveLength(0);
  });
});

describe('tasks.create_api: existing ids', () => {
  it('TC-11 a replay returns 200 with the existing task, version unchanged; 1 -> 1 row', async () => {
    const { browser, id } = await member();
    const taskId = newTaskId();
    const first = await postTask(browser, id, { id: taskId, name: 'Buy milk' });
    expect(first.status).toBe(201);
    const before = await taskRow(taskId);
    const replay = await postTask(browser, id, { id: taskId, name: 'Buy milk' });
    expect(replay.status).toBe(200);
    expect(TaskResponse.parse(await replay.json()).task).toMatchObject({ id: taskId, version: 1, sortOrder: 1 });
    expect(await taskRows(id)).toHaveLength(1);
    expect(await taskRow(taskId)).toEqual(before);
  });

  it('TC-12 a replay with a different name never overwrites: 200 with the ORIGINAL name', async () => {
    const { browser, id } = await member();
    const taskId = newTaskId();
    await postTask(browser, id, { id: taskId, name: 'Buy milk' });
    const replay = await postTask(browser, id, { id: taskId, name: 'Buy oat milk', description: 'changed' });
    expect(replay.status).toBe(200);
    expect(TaskResponse.parse(await replay.json()).task).toMatchObject({ name: 'Buy milk', description: '' });
    expect(await taskRow(taskId)).toMatchObject({ name: 'Buy milk', description: '', version: 1 });
  });

  it('TC-13 an id soft-deleted in this workspace -> 410 gone; the row stays deleted', async () => {
    const { browser, id } = await member();
    const taskId = newTaskId();
    await postTask(browser, id, { id: taskId, name: 'Buy milk' });
    await markDeleted(taskId);
    const res = await postTask(browser, id, { id: taskId, name: 'Buy milk' });
    expect(res.status).toBe(410);
    expect(await errorCode(res)).toBe('gone');
    expect(await taskRow(taskId)).toMatchObject({ deleted: 1, name: 'Buy milk' });
    expect(await taskRows(id)).toHaveLength(1);
  });

  it("TC-14 an id owned by another workspace -> 409 id_conflict; the other workspace's row is untouched", async () => {
    const other = await member();
    const mine = await member();
    const taskId = newTaskId();
    await postTask(other.browser, other.id, { id: taskId, name: 'Theirs' });
    const before = await taskRow(taskId);
    const res = await postTask(mine.browser, mine.id, { id: taskId, name: 'Mine' });
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe('id_conflict');
    expect(await taskRow(taskId)).toEqual(before);
    expect(await taskRows(other.id)).toHaveLength(1);
    expect(await taskRows(mine.id)).toHaveLength(0);
  });
});

describe('tasks.create_api: caller checks', () => {
  it('TC-16 no cookie -> 404 not_found; nothing written', async () => {
    const { id } = await member();
    const res = await postTask(new Browser(), id, { id: newTaskId(), name: 'Buy milk' });
    expect(res.status).toBe(404);
    expect(await errorCode(res)).toBe('not_found');
    expect(await taskRows()).toHaveLength(0);
  });

  it("TC-17 a cookie for another workspace -> 404; nothing written in either", async () => {
    const target = await member();
    const intruder = await member();
    const res = await postTask(intruder.browser, target.id, { id: newTaskId(), name: 'Buy milk' });
    expect(res.status).toBe(404);
    expect(await taskRows(target.id)).toHaveLength(0);
    expect(await taskRows(intruder.id)).toHaveLength(0);
  });

  it('a tampered secret for the right id is also 404', async () => {
    const { browser, id } = await member();
    const [entry] = browser.entries();
    const forged = new Browser(cookieFor([{ ...entry!, s: 'x'.repeat(43) }]));
    const res = await postTask(forged, id, { id: newTaskId(), name: 'Buy milk' });
    expect(res.status).toBe(404);
    expect(await taskRows()).toHaveLength(0);
  });

  it('TC-18 missing X-Todoodle-Client -> 403 forbidden_client', async () => {
    const { browser, id } = await member();
    const res = await postTask(browser, id, { id: newTaskId(), name: 'Buy milk' }, { 'Content-Type': 'application/json' });
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe('forbidden_client');
    expect(await taskRows()).toHaveLength(0);
  });

  it('TC-19 a JSON body sent as text/plain -> 415 unsupported_media_type', async () => {
    const { browser, id } = await member();
    const res = await postTask(browser, id, { id: newTaskId(), name: 'Buy milk' }, { ...CLIENT, 'Content-Type': 'text/plain' });
    expect(res.status).toBe(415);
    expect(await errorCode(res)).toBe('unsupported_media_type');
    expect(await taskRows()).toHaveLength(0);
  });
});

describe('tasks.create_api: ordering', () => {
  it('TC-20 three sequential creates get sortOrder 1, 2, 3 and list in that order', async () => {
    const { browser, id } = await member();
    const names = ['A', 'B', 'C'];
    for (const name of names) {
      expect((await postTask(browser, id, { id: newTaskId(), name })).status).toBe(201);
    }
    expect((await taskRows(id)).map((r) => [r.name, r.sort_order])).toEqual([
      ['A', 1],
      ['B', 2],
      ['C', 3],
    ]);
    const listed = (await (await listTasks(browser, id)).json()) as { tasks: Array<{ name: string }> };
    expect(listed.tasks.map((t) => t.name)).toEqual(names);
  });

  it('TC-21 10 concurrent creates -> 10 rows with 10 distinct sortOrder values', async () => {
    const { browser, id } = await member();
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => postTask(browser, id, { id: newTaskId(), name: `Task ${i}` })));
    expect(results.map((r) => r.status)).toEqual(Array(10).fill(201));
    const rows = await taskRows(id);
    expect(rows).toHaveLength(10);
    expect(new Set(rows.map((r) => r.sort_order)).size).toBe(10);
  });

  it('sort order continues after completed and deleted tasks (MAX spans the whole workspace)', async () => {
    const { browser, id } = await member();
    const a = newTaskId();
    await postTask(browser, id, { id: a, name: 'A' });
    await markDeleted(a);
    const b = newTaskId();
    await postTask(browser, id, { id: b, name: 'B' });
    expect((await taskRow(b))?.sort_order).toBe(2);
  });
});

describe('tasks.create_api: live broadcast', () => {
  it('TC-22 a create broadcasts exactly one task.upserted with the origin client id', async () => {
    const { browser, id } = await member();
    const socket = await connectLive(browser, id);
    const taskId = newTaskId();
    const res = await postTask(browser, id, { id: taskId, name: 'Buy milk' }, { ...JSON_CLIENT, [CLIENT_ID_HEADER]: CLIENT_X });
    expect(res.status).toBe(201);
    const { task } = TaskResponse.parse(await res.json());
    const [frame] = await socket.waitForFrames(1);
    expect(LiveEvent.parse(JSON.parse(frame!))).toEqual({ type: 'task.upserted', entity: task, version: 1, originClientId: CLIENT_X });
    expect(await framesAfter(socket, 300)).toHaveLength(1);
    socket.close();
  });

  it('TC-23 a replay broadcasts nothing', async () => {
    const { browser, id } = await member();
    const taskId = newTaskId();
    await postTask(browser, id, { id: taskId, name: 'Buy milk' });
    const socket = await connectLive(browser, id);
    const replay = await postTask(browser, id, { id: taskId, name: 'Buy milk' });
    expect(replay.status).toBe(200);
    expect(await framesAfter(socket, 300)).toEqual([]);
    socket.close();
  });

  it('TC-24 a rejected create broadcasts nothing', async () => {
    const { browser, id } = await member();
    const socket = await connectLive(browser, id);
    const res = await postTask(browser, id, { id: newTaskId(), name: '' });
    expect(res.status).toBe(400);
    expect(await framesAfter(socket, 300)).toEqual([]);
    socket.close();
  });
});
