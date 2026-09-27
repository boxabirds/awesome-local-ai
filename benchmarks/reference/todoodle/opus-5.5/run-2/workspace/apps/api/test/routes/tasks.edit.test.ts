import { TaskListResponse } from '@todoodle/shared/schemas';
import { describe, expect, it } from 'vitest';
import type { TaskRow } from '../../src/db/tasks';
import {
  DESCRIPTION_AT_LIMIT,
  DESCRIPTION_OVER_LIMIT,
  NAME_AT_LIMIT,
  NAME_OVER_LIMIT,
  newTaskId,
  TASK_NAMES,
} from '../fixtures/tasks';
import { CLIENT_HEADERS } from '../helpers';
import {
  CLIENT_X,
  CLIENT_Y,
  closeSocketsAfterEach,
  expectFrames,
  live,
  nextEvent,
  patchTask,
  type PriorState,
  rawRow,
  seedRealistic,
  setState,
  taskFrom,
} from '../lifecycle-helpers';
import { createdTask, listTasks } from '../task-helpers';
import { createWorkspace } from '../workspace-helpers';

closeSocketsAfterEach();

async function oneTask(prior: PriorState = 'Open') {
  const { workspace, cookie } = await createWorkspace();
  const task = await createdTask(workspace.id, cookie, { name: TASK_NAMES.milk, description: 'Semi-skimmed\n2 pints' });
  await setState(task.id, prior);
  const before = (await rawRow(task.id))!;
  const socket = await live(workspace.id, cookie);
  return { workspace, cookie, task, before, socket };
}

async function expectUnchanged(id: string, before: TaskRow) {
  expect(await rawRow(id)).toEqual(before);
}

describe('Matrix A: edit name by prior state', () => {
  it.each([
    ['TC-I11', 'Open'],
    ['TC-I12', 'Completed'],
  ] as const)('%s edit name on %s: 200 trimmed, version +1, task.upserted', async (_tc, prior) => {
    const { workspace, cookie, task, before, socket } = await oneTask(prior);
    const res = await patchTask(workspace.id, cookie, task.id, { name: '  Buy oat milk  ' });
    expect(res.status).toBe(200);
    const body = await taskFrom(res);
    expect(body.name).toBe('Buy oat milk');
    const after = (await rawRow(task.id))!;
    expect(after).toMatchObject({
      name: 'Buy oat milk',
      description: before.description,
      completed_at: before.completed_at,
      sort_order: before.sort_order,
      deleted: 0,
      version: before.version + 1,
    });
    expect(after.updated_at).not.toBe(before.updated_at);
    const event = await nextEvent(socket);
    expect(event).toMatchObject({ type: 'task.upserted', version: before.version + 1, entity: { id: task.id, name: 'Buy oat milk' } });
    await expectFrames(socket, 1);
  });

  it.each([
    ['TC-I13', 'DeletedOpen'],
    ['TC-I14', 'DeletedCompleted'],
  ] as const)('%s edit name on %s: 410 gone, nothing changes', async (_tc, prior) => {
    const { workspace, cookie, task, before, socket } = await oneTask(prior);
    const res = await patchTask(workspace.id, cookie, task.id, { name: 'Resurrected' });
    expect(res.status).toBe(410);
    expect(await res.json()).toMatchObject({ error: 'gone' });
    await expectUnchanged(task.id, before);
    await expectFrames(socket, 0);
  });

  it('TC-I15 edit name on a missing task: 404 not_found', async () => {
    const { workspace, cookie, task, before, socket } = await oneTask();
    const res = await patchTask(workspace.id, cookie, newTaskId(), { name: 'Nobody' });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'not_found' });
    await expectUnchanged(task.id, before);
    await expectFrames(socket, 0);
  });
});

describe('Matrix B: input boundaries and validation', () => {
  it('TC-I28 a 1-character name is saved', async () => {
    const { workspace, cookie, task } = await oneTask();
    const res = await patchTask(workspace.id, cookie, task.id, { name: 'x' });
    expect(res.status).toBe(200);
    expect((await rawRow(task.id))!.name).toBe('x');
  });

  it('TC-I29 a name of exactly TASK_NAME_MAX is saved exactly', async () => {
    const { workspace, cookie, task } = await oneTask();
    const res = await patchTask(workspace.id, cookie, task.id, { name: NAME_AT_LIMIT });
    expect(res.status).toBe(200);
    expect((await rawRow(task.id))!.name).toBe(NAME_AT_LIMIT);
  });

  it('TC-I30 a name of TASK_NAME_MAX + 1 is 400 validation; row unchanged, no broadcast', async () => {
    const { workspace, cookie, task, before, socket } = await oneTask();
    const res = await patchTask(workspace.id, cookie, task.id, { name: NAME_OVER_LIMIT });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'validation' });
    await expectUnchanged(task.id, before);
    await expectFrames(socket, 0);
  });

  it.each([
    ['TC-I31', ''],
    ['TC-I32', ' \t  '],
  ])('%s a blank name keeps the previous name: 200, version unchanged, no broadcast', async (_tc, name) => {
    const { workspace, cookie, task, before, socket } = await oneTask();
    const res = await patchTask(workspace.id, cookie, task.id, { name });
    expect(res.status).toBe(200);
    expect((await taskFrom(res)).name).toBe(TASK_NAMES.milk);
    await expectUnchanged(task.id, before);
    await expectFrames(socket, 0);
  });

  it('TC-I33 a blank name plus a valid description updates only the description, version +1', async () => {
    const { workspace, cookie, task, before, socket } = await oneTask();
    const res = await patchTask(workspace.id, cookie, task.id, { name: '  ', description: 'Oat, 1 litre' });
    expect(res.status).toBe(200);
    expect(await rawRow(task.id)).toMatchObject({ name: TASK_NAMES.milk, description: 'Oat, 1 litre', version: before.version + 1 });
    expect((await nextEvent(socket)).type).toBe('task.upserted');
  });

  it('TC-I34 an empty description clears it', async () => {
    const { workspace, cookie, task } = await oneTask();
    const res = await patchTask(workspace.id, cookie, task.id, { description: '' });
    expect(res.status).toBe(200);
    expect((await rawRow(task.id))!.description).toBe('');
  });

  it('TC-I35 a description of exactly TASK_DESCRIPTION_MAX is saved', async () => {
    const { workspace, cookie, task } = await oneTask();
    expect((await patchTask(workspace.id, cookie, task.id, { description: DESCRIPTION_AT_LIMIT })).status).toBe(200);
    expect((await rawRow(task.id))!.description).toBe(DESCRIPTION_AT_LIMIT);
  });

  it('TC-I36 a description of TASK_DESCRIPTION_MAX + 1 is 400 validation; row unchanged', async () => {
    const { workspace, cookie, task, before, socket } = await oneTask();
    const res = await patchTask(workspace.id, cookie, task.id, { description: DESCRIPTION_OVER_LIMIT });
    expect(res.status).toBe(400);
    await expectUnchanged(task.id, before);
    await expectFrames(socket, 0);
  });

  it('TC-I37 an empty JSON object is 400 validation', async () => {
    const { workspace, cookie, task, before } = await oneTask();
    const res = await patchTask(workspace.id, cookie, task.id, {});
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'validation' });
    await expectUnchanged(task.id, before);
  });

  it('TC-I38 an unknown field (completedAt) is 400: the lifecycle cannot be tampered with via PATCH', async () => {
    const { workspace, cookie, task, before, socket } = await oneTask();
    const res = await patchTask(workspace.id, cookie, task.id, { name: 'Done?', completedAt: '2026-09-27T10:00:00.000Z' });
    expect(res.status).toBe(400);
    await expectUnchanged(task.id, before);
    for (const body of [{ deleted: 1 }, { sortOrder: 0 }, { version: 99 }]) {
      expect((await patchTask(workspace.id, cookie, task.id, body)).status).toBe(400);
    }
    await expectUnchanged(task.id, before);
    await expectFrames(socket, 0);
  });

  it('TC-I39 include_completed=yes is 400 validation', async () => {
    const { workspace, cookie } = await createWorkspace();
    const res = await listTasks(workspace.id, cookie, '?list=inbox&include_completed=yes');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'validation' });
  });

  it('TC-I40 a name with emoji and RTL text is stored byte-exact', async () => {
    const { workspace, cookie, task } = await oneTask();
    const name = 'שלום 👋🏽 مرحبا — Café ☕️';
    const res = await patchTask(workspace.id, cookie, task.id, { name, description: 'עברית\nعربى 🎉' });
    expect(res.status).toBe(200);
    const row = (await rawRow(task.id))!;
    expect(row.name).toBe(name);
    expect(new TextEncoder().encode(row.name)).toEqual(new TextEncoder().encode(name));
    expect(row.description).toBe('עברית\nعربى 🎉');
  });

  it('TC-I44 PATCH with a text/plain body is 415 unsupported_media_type; nothing changes', async () => {
    const { workspace, cookie, task, before, socket } = await oneTask();
    const res = await patchTask(workspace.id, cookie, task.id, JSON.stringify({ name: 'Plain' }), { contentType: 'text/plain' });
    expect(res.status).toBe(415);
    expect(await res.json()).toMatchObject({ error: 'unsupported_media_type' });
    await expectUnchanged(task.id, before);
    await expectFrames(socket, 0);
  });

  it('PATCH with a body that is not JSON is 400', async () => {
    const { workspace, cookie, task, before } = await oneTask();
    expect((await patchTask(workspace.id, cookie, task.id, '{"name":')).status).toBe(400);
    await expectUnchanged(task.id, before);
  });

  it('the same values again are a noop: 200, no version bump, no broadcast', async () => {
    const { workspace, cookie, task, before, socket } = await oneTask();
    const res = await patchTask(workspace.id, cookie, task.id, { name: TASK_NAMES.milk, description: before.description });
    expect(res.status).toBe(200);
    await expectUnchanged(task.id, before);
    await expectFrames(socket, 0);
  });
});

describe('TC-I47 last write wins', () => {
  it('client X then client Y PATCH the name: Y wins, version +2, two events in order', async () => {
    const { workspace, cookie, task, before, socket } = await oneTask();
    const as = (clientId: string) => ({ headers: { ...CLIENT_HEADERS, 'X-Todoodle-Client-Id': clientId } });
    expect((await patchTask(workspace.id, cookie, task.id, { name: 'From X' }, as(CLIENT_X))).status).toBe(200);
    expect((await patchTask(workspace.id, cookie, task.id, { name: 'From Y' }, as(CLIENT_Y))).status).toBe(200);
    expect(await rawRow(task.id)).toMatchObject({ name: 'From Y', version: before.version + 2 });
    const first = await nextEvent(socket, 0);
    const second = await nextEvent(socket, 1);
    expect(first).toMatchObject({ originClientId: CLIENT_X, version: before.version + 1, entity: { name: 'From X' } });
    expect(second).toMatchObject({ originClientId: CLIENT_Y, version: before.version + 2, entity: { name: 'From Y' } });
    await expectFrames(socket, 2);
  });
});

describe('list with include_completed', () => {
  it('TC-I26 the default list has only open tasks, by sort_order', async () => {
    const seed = await seedRealistic();
    const res = await listTasks(seed.a.workspace.id, seed.a.cookie);
    expect(res.status).toBe(200);
    const { tasks } = TaskListResponse.parse(await res.json());
    expect(tasks.map((t) => t.id)).toEqual(seed.open.map((t) => t.id));
    expect(tasks.every((t) => t.completedAt === null)).toBe(true);
    // include_completed=false is the same.
    const explicit = TaskListResponse.parse(await (await listTasks(seed.a.workspace.id, seed.a.cookie, '?include_completed=false')).json());
    expect(explicit.tasks).toEqual(tasks);
  });

  it('TC-I27 include_completed=true: open by sort_order, then completed by completed_at desc; never deleted', async () => {
    const seed = await seedRealistic();
    const before = await rawRow(seed.deletedCompleted.id);
    const res = await listTasks(seed.a.workspace.id, seed.a.cookie, '?list=inbox&include_completed=true');
    expect(res.status).toBe(200);
    const { tasks } = TaskListResponse.parse(await res.json());
    const byRecent = seed.completed.toSorted((x, y) => (x.completedAt < y.completedAt ? 1 : -1));
    expect(tasks.map((t) => t.id)).toEqual([...seed.open.map((t) => t.id), ...byRecent.map((c) => c.task.id)]);
    expect(tasks.slice(seed.open.length).map((t) => t.completedAt)).toEqual(byRecent.map((c) => c.completedAt));
    expect(tasks.some((t) => t.id === seed.deletedOpen.id || t.id === seed.deletedCompleted.id)).toBe(false);
    expect(tasks.some((t) => seed.bTasks.some((b) => b.id === t.id))).toBe(false);
    // Read only.
    expect(await rawRow(seed.deletedCompleted.id)).toEqual(before);
  });
});
