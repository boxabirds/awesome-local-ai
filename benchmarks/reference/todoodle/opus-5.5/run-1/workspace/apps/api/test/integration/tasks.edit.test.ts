import { TASK_DESCRIPTION_MAX, TASK_NAME_MAX } from '@todoodle/shared/limits';
import { LiveEvent } from '@todoodle/shared/events';
import { TaskListResponse, TaskResponse } from '@todoodle/shared/schemas';
import { describe, expect, it } from 'vitest';
import { CLIENT_ID_HEADER } from '../../src/live/broadcast.ts';
import { DESCRIPTION_AT_LIMIT, DESCRIPTION_OVER_LIMIT, MULTI_LINE_DESCRIPTION, NAME_AT_LIMIT, NAME_OVER_LIMIT, newTaskId } from '../fixtures/tasks.ts';
import { CLIENT } from '../support/http.ts';
import { connectLive, framesAfter, type LiveClient } from '../support/live.ts';
import { type PriorState, listTasks, member, patchTask, seedRealisticWorkspaces, taskInState, taskRow, taskRows } from '../support/tasks.ts';
import { JSON_CLIENT } from '../support/workspaces.ts';

// Story 6, design Matrices A (edit rows), B and C: PATCH name/description and GET include_completed,
// against real D1 and a real WorkspaceRoom.

const NO_EVENT_WAIT_MS = 300;
const CLIENT_X = '6f1c2a4e-9b3d-4c7a-8e21-5d0f9a7b3c11';
const CLIENT_Y = '0b7d1e2f-3a4c-4d5e-8f60-718293a4b5c6';

async function setup(state: PriorState = 'Open') {
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

async function nextEvent(socket: LiveClient) {
  const [frame] = await socket.waitForFrames(1);
  socket.close();
  return LiveEvent.parse(JSON.parse(frame!));
}

describe('tasks.edit: PATCH /tasks/:id x prior state (Matrix A)', () => {
  it.each(['Open', 'Completed'] as const)('TC-I11/TC-I12 %s -> 200 trimmed name; name updated, state kept, version +1, task.upserted', async (state) => {
    const { browser, ws, taskId, before, socket } = await setup(state);
    const res = await patchTask(browser, ws, taskId, { name: '  Book dentist for Tuesday 9am  ' });
    expect(res.status).toBe(200);
    const { task } = TaskResponse.parse(await res.json());
    expect(task).toMatchObject({ name: 'Book dentist for Tuesday 9am', completedAt: before.completed_at, version: before.version + 1 });
    expect(await taskRow(taskId)).toMatchObject({
      name: 'Book dentist for Tuesday 9am',
      description: before.description,
      completed_at: before.completed_at,
      sort_order: before.sort_order,
      deleted: 0,
      version: before.version + 1,
    });
    expect(await nextEvent(socket)).toMatchObject({ type: 'task.upserted', version: before.version + 1, entity: { id: taskId, name: 'Book dentist for Tuesday 9am' } });
  });

  it.each(['DeletedOpen', 'DeletedCompleted'] as const)('TC-I13/TC-I14 %s -> 410 gone; unchanged; no event', async (state) => {
    const { browser, ws, taskId, before, socket } = await setup(state);
    const res = await patchTask(browser, ws, taskId, { name: 'Too late' });
    expect(res.status).toBe(410);
    expect(await res.json()).toMatchObject({ error: 'gone' });
    expect(await taskRow(taskId)).toEqual(before);
    await expectNoEvent(socket);
  });

  it('TC-I15 Missing -> 404 not_found', async () => {
    const { browser, ws, socket } = await setup();
    const before = await taskRows();
    const res = await patchTask(browser, ws, newTaskId(), { name: 'Nobody' });
    expect(res.status).toBe(404);
    expect(await taskRows()).toEqual(before);
    await expectNoEvent(socket);
  });
});

describe('tasks.edit: input boundaries and validation (Matrix B)', () => {
  it('TC-I28 a 1-char name -> 200 saved', async () => {
    const { browser, ws, taskId, socket } = await setup();
    expect((await patchTask(browser, ws, taskId, { name: 'x' })).status).toBe(200);
    expect((await taskRow(taskId))?.name).toBe('x');
    socket.close();
  });

  it('TC-I29 a name of exactly TASK_NAME_MAX -> 200 saved exactly', async () => {
    const { browser, ws, taskId, socket } = await setup();
    expect((await patchTask(browser, ws, taskId, { name: NAME_AT_LIMIT })).status).toBe(200);
    expect((await taskRow(taskId))?.name).toBe(NAME_AT_LIMIT);
    expect(NAME_AT_LIMIT).toHaveLength(TASK_NAME_MAX);
    socket.close();
  });

  it('TC-I30 a name of TASK_NAME_MAX + 1 -> 400 validation; row unchanged; no event', async () => {
    const { browser, ws, taskId, before, socket } = await setup();
    const res = await patchTask(browser, ws, taskId, { name: NAME_OVER_LIMIT });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'validation' });
    expect(await taskRow(taskId)).toEqual(before);
    await expectNoEvent(socket);
  });

  it.each([
    ['TC-I31 empty string', ''],
    ['TC-I32 whitespace only', '  \t '],
  ])('%s name -> 200, name and version unchanged, no event', async (_label, name) => {
    const { browser, ws, taskId, before, socket } = await setup();
    const res = await patchTask(browser, ws, taskId, { name });
    expect(res.status).toBe(200);
    expect(TaskResponse.parse(await res.json()).task).toMatchObject({ name: before.name, version: before.version });
    expect(await taskRow(taskId)).toEqual(before);
    await expectNoEvent(socket);
  });

  it('TC-I33 blank name plus a valid description -> 200; description updated, name unchanged, version +1', async () => {
    const { browser, ws, taskId, before, socket } = await setup();
    const res = await patchTask(browser, ws, taskId, { name: ' ', description: MULTI_LINE_DESCRIPTION });
    expect(res.status).toBe(200);
    expect(await taskRow(taskId)).toMatchObject({ name: before.name, description: MULTI_LINE_DESCRIPTION, version: before.version + 1 });
    expect(await nextEvent(socket)).toMatchObject({ type: 'task.upserted', entity: { name: before.name, description: MULTI_LINE_DESCRIPTION } });
  });

  it('TC-I34 an empty description clears it', async () => {
    const { browser, ws, taskId, before, socket } = await setup();
    expect(before.description).not.toBe('');
    expect((await patchTask(browser, ws, taskId, { description: '' })).status).toBe(200);
    expect(await taskRow(taskId)).toMatchObject({ description: '', version: before.version + 1 });
    socket.close();
  });

  it('TC-I35 a description of exactly TASK_DESCRIPTION_MAX -> 200 saved', async () => {
    const { browser, ws, taskId, socket } = await setup();
    expect((await patchTask(browser, ws, taskId, { description: DESCRIPTION_AT_LIMIT })).status).toBe(200);
    expect((await taskRow(taskId))?.description).toHaveLength(TASK_DESCRIPTION_MAX);
    socket.close();
  });

  it('TC-I36 a description of TASK_DESCRIPTION_MAX + 1 -> 400; row unchanged', async () => {
    const { browser, ws, taskId, before, socket } = await setup();
    expect((await patchTask(browser, ws, taskId, { description: DESCRIPTION_OVER_LIMIT })).status).toBe(400);
    expect(await taskRow(taskId)).toEqual(before);
    await expectNoEvent(socket);
  });

  it('TC-I37 an empty JSON object -> 400 validation; row unchanged', async () => {
    const { browser, ws, taskId, before, socket } = await setup();
    const res = await patchTask(browser, ws, taskId, {});
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'validation' });
    expect(await taskRow(taskId)).toEqual(before);
    await expectNoEvent(socket);
  });

  it('TC-I38 an unknown field completedAt -> 400; the lifecycle cannot be tampered with through PATCH', async () => {
    const { browser, ws, taskId, before, socket } = await setup();
    const res = await patchTask(browser, ws, taskId, { name: 'Sneaky', completedAt: '2026-09-26T10:00:00.000Z' });
    expect(res.status).toBe(400);
    expect(await taskRow(taskId)).toEqual(before);
    await expectNoEvent(socket);
  });

  it('a bodyless PATCH or invalid JSON -> 400; row unchanged', async () => {
    const { browser, ws, taskId, before, socket } = await setup();
    expect((await browser.fetch(`/api/w/${ws}/tasks/${taskId}`, { method: 'PATCH', headers: CLIENT })).status).toBe(400);
    expect((await patchTask(browser, ws, taskId, '{"name":')).status).toBe(400);
    expect(await taskRow(taskId)).toEqual(before);
    await expectNoEvent(socket);
  });

  it('TC-I40 a name with emoji and RTL text is stored byte-exact', async () => {
    const { browser, ws, taskId, socket } = await setup();
    const name = 'שלום 👋 — call the landlord about the لوحة 🏠';
    const res = await patchTask(browser, ws, taskId, { name });
    expect(res.status).toBe(200);
    expect(TaskResponse.parse(await res.json()).task.name).toBe(name);
    expect((await taskRow(taskId))?.name).toBe(name);
    socket.close();
  });
});

describe('tasks.edit and tasks.list_completed: cross-cutting (Matrix C)', () => {
  it('TC-I44 PATCH with a text/plain body -> 415 unsupported_media_type; nothing changed', async () => {
    const { browser, ws, taskId, before, socket } = await setup();
    const res = await patchTask(browser, ws, taskId, JSON.stringify({ name: 'Plain' }), { ...CLIENT, 'Content-Type': 'text/plain' });
    expect(res.status).toBe(415);
    expect(await res.json()).toMatchObject({ error: 'unsupported_media_type' });
    expect(await taskRow(taskId)).toEqual(before);
    await expectNoEvent(socket);
  });

  it('TC-I47 last write wins: client X then client Y rename -> final name from Y, version +2, two events in order', async () => {
    const { browser, ws, taskId, before, socket } = await setup();
    const x = await patchTask(browser, ws, taskId, { name: 'From X' }, { ...JSON_CLIENT, [CLIENT_ID_HEADER]: CLIENT_X });
    expect(x.status).toBe(200);
    const y = await patchTask(browser, ws, taskId, { name: 'From Y' }, { ...JSON_CLIENT, [CLIENT_ID_HEADER]: CLIENT_Y });
    expect(y.status).toBe(200);
    expect(await taskRow(taskId)).toMatchObject({ name: 'From Y', version: before.version + 2 });
    const frames = await socket.waitForFrames(2);
    socket.close();
    const events = frames.map((frame) => LiveEvent.parse(JSON.parse(frame)));
    expect(events.map((e) => [e.originClientId, e.version, (e.entity as { name?: string }).name])).toEqual([
      [CLIENT_X, before.version + 1, 'From X'],
      [CLIENT_Y, before.version + 2, 'From Y'],
    ]);
  });

  it('TC-I26 list default: only open tasks, by sort_order ascending', async () => {
    const { a, ids, completed, deletedOpen, deletedCompleted } = await seedRealisticWorkspaces();
    const before = await taskRows();
    const res = await listTasks(a.browser, a.id);
    expect(res.status).toBe(200);
    const { tasks } = TaskListResponse.parse(await res.json());
    const hidden = new Set([...completed, deletedOpen, deletedCompleted]);
    expect(tasks.map((t) => t.id)).toEqual(ids.filter((id) => !hidden.has(id)));
    expect(tasks.every((t) => t.completedAt === null)).toBe(true);
    const orders = tasks.map((t) => t.sortOrder);
    expect(orders).toEqual(orders.toSorted((x, y) => x - y));
    expect(await taskRows()).toEqual(before);
  });

  it('TC-I27 include_completed=true: open by sort_order, then completed by completed_at desc; no deleted', async () => {
    const { a, ids, completed, deletedOpen, deletedCompleted } = await seedRealisticWorkspaces();
    const res = await listTasks(a.browser, a.id, '?list=inbox&include_completed=true');
    expect(res.status).toBe(200);
    const { tasks } = TaskListResponse.parse(await res.json());
    const hidden = new Set([...completed, deletedOpen, deletedCompleted]);
    // completed_at: ids[1] 09-20, ids[6] 09-24, ids[9] 09-22 -> most recent first.
    expect(tasks.map((t) => t.id)).toEqual([...ids.filter((id) => !hidden.has(id)), ids[6], ids[9], ids[1]]);
    expect(tasks.some((t) => t.id === deletedOpen || t.id === deletedCompleted)).toBe(false);
  });

  it('include_completed=false is the default list', async () => {
    const { a } = await seedRealisticWorkspaces();
    const off = TaskListResponse.parse(await (await listTasks(a.browser, a.id, '?list=inbox&include_completed=false')).json());
    const plain = TaskListResponse.parse(await (await listTasks(a.browser, a.id)).json());
    expect(off).toEqual(plain);
  });

  it('TC-I39 include_completed=yes -> 400 validation', async () => {
    const { browser, id } = await member();
    const res = await listTasks(browser, id, '?list=inbox&include_completed=yes');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'validation' });
  });
});
