import { SELF } from 'cloudflare:test';
import { TaskSchema } from '@todoodle/shared/schemas';
import { describe, expect, it } from 'vitest';
import type { TaskRow } from '../../src/db/tasks';
import { newTaskId, TASK_NAMES } from '../fixtures/tasks';
import { CLIENT_HEADERS, ORIGIN } from '../helpers';
import {
  CLIENT_X,
  closeSocketsAfterEach,
  deleteTask,
  expectFrames,
  lifecycle,
  live,
  nextEvent,
  patchTask,
  type PriorState,
  rawRow,
  setState,
  taskFrom,
} from '../lifecycle-helpers';
import { createdTask, listTasks } from '../task-helpers';
import { createWorkspace } from '../workspace-helpers';

closeSocketsAfterEach();

type Op = 'complete' | 'reopen' | 'delete' | 'restore';
type Expect = {
  tc: string;
  op: Op;
  prior: PriorState | 'Missing';
  status: 200 | 204 | 404 | 410;
  after?: PriorState;
  bump?: boolean;
  event?: 'task.upserted' | 'task.deleted' | 'task.restored';
};

// Design Matrix A (operation x prior state), rows TC-I01..TC-I10 and TC-I16..TC-I25.
const MATRIX: Expect[] = [
  { tc: 'TC-I01', op: 'complete', prior: 'Open', status: 200, after: 'Completed', bump: true, event: 'task.upserted' },
  { tc: 'TC-I02', op: 'complete', prior: 'Completed', status: 200, after: 'Completed' },
  { tc: 'TC-I03', op: 'complete', prior: 'DeletedOpen', status: 410, after: 'DeletedOpen' },
  { tc: 'TC-I04', op: 'complete', prior: 'DeletedCompleted', status: 410, after: 'DeletedCompleted' },
  { tc: 'TC-I05', op: 'complete', prior: 'Missing', status: 404 },
  { tc: 'TC-I06', op: 'reopen', prior: 'Open', status: 200, after: 'Open' },
  { tc: 'TC-I07', op: 'reopen', prior: 'Completed', status: 200, after: 'Open', bump: true, event: 'task.upserted' },
  { tc: 'TC-I08', op: 'reopen', prior: 'DeletedOpen', status: 410, after: 'DeletedOpen' },
  { tc: 'TC-I09', op: 'reopen', prior: 'DeletedCompleted', status: 410, after: 'DeletedCompleted' },
  { tc: 'TC-I10', op: 'reopen', prior: 'Missing', status: 404 },
  { tc: 'TC-I16', op: 'delete', prior: 'Open', status: 204, after: 'DeletedOpen', bump: true, event: 'task.deleted' },
  { tc: 'TC-I17', op: 'delete', prior: 'Completed', status: 204, after: 'DeletedCompleted', bump: true, event: 'task.deleted' },
  { tc: 'TC-I18', op: 'delete', prior: 'DeletedOpen', status: 204, after: 'DeletedOpen' },
  { tc: 'TC-I19', op: 'delete', prior: 'DeletedCompleted', status: 204, after: 'DeletedCompleted' },
  { tc: 'TC-I20', op: 'delete', prior: 'Missing', status: 404 },
  { tc: 'TC-I21', op: 'restore', prior: 'Open', status: 200, after: 'Open' },
  { tc: 'TC-I22', op: 'restore', prior: 'Completed', status: 200, after: 'Completed' },
  { tc: 'TC-I23', op: 'restore', prior: 'DeletedOpen', status: 200, after: 'Open', bump: true, event: 'task.restored' },
  { tc: 'TC-I24', op: 'restore', prior: 'DeletedCompleted', status: 200, after: 'Completed', bump: true, event: 'task.restored' },
  { tc: 'TC-I25', op: 'restore', prior: 'Missing', status: 404 },
];

function stateOf(row: TaskRow): PriorState {
  const done = row.completed_at !== null;
  if (row.deleted) return done ? 'DeletedCompleted' : 'DeletedOpen';
  return done ? 'Completed' : 'Open';
}

function run(op: Op, workspaceId: string, cookie: string | null, taskId: string, headers?: Record<string, string>) {
  return op === 'delete' ? deleteTask(workspaceId, cookie, taskId, headers) : lifecycle(workspaceId, cookie, taskId, op, { headers });
}

describe('Matrix A: complete, reopen, delete and restore by prior state', () => {
  it.each(MATRIX)('$tc $op on $prior -> $status', async ({ op, prior, status, after, bump, event }) => {
    const { workspace, cookie } = await createWorkspace();
    // A neighbour, so an unintended row change would show.
    const neighbour = await createdTask(workspace.id, cookie, { name: TASK_NAMES.invoice });
    const task = await createdTask(workspace.id, cookie, { name: TASK_NAMES.milk, description: 'Semi-skimmed\n2 pints' });
    const taskId = prior === 'Missing' ? newTaskId() : task.id;
    if (prior !== 'Missing') await setState(task.id, prior);
    const before = await rawRow(task.id);
    const neighbourBefore = await rawRow(neighbour.id);
    const socket = await live(workspace.id, cookie);

    const res = await run(op, workspace.id, cookie, taskId, { ...CLIENT_HEADERS, 'X-Todoodle-Client-Id': CLIENT_X });
    expect(res.status).toBe(status);
    const rowAfter = await rawRow(task.id);
    expect(await rawRow(neighbour.id)).toEqual(neighbourBefore);

    if (prior === 'Missing') {
      expect(await res.json()).toMatchObject({ error: 'not_found' });
      // No row was affected: the real task is untouched.
      expect(rowAfter).toEqual(before);
      await expectFrames(socket, 0);
      return;
    }
    if (status === 410) expect(await res.json()).toMatchObject({ error: 'gone' });
    if (status === 204) expect(await res.text()).toBe('');

    expect(stateOf(rowAfter!)).toBe(after);
    expect(rowAfter!.sort_order).toBe(before!.sort_order);
    expect(rowAfter!.name).toBe(before!.name);
    expect(rowAfter!.description).toBe(before!.description);
    expect(rowAfter!.version).toBe(before!.version + (bump ? 1 : 0));

    if (!bump) {
      // Noops and refusals change nothing at all.
      expect(rowAfter).toEqual(before);
    } else if (op === 'complete') {
      expect(rowAfter!.completed_at).not.toBeNull();
      expect(new Date(rowAfter!.completed_at!).getTime()).not.toBeNaN();
    } else if (op === 'delete') {
      expect(rowAfter!.deleted_at).not.toBeNull();
      // Other columns unchanged (completed_at kept for a completed task).
      expect({ ...rowAfter, deleted: 0, deleted_at: null, version: before!.version }).toEqual(before);
    } else if (op === 'restore') {
      expect(rowAfter!.deleted_at).toBeNull();
      expect(rowAfter!.completed_at).toBe(before!.completed_at);
    }

    if (status === 200) {
      const body = await taskFrom(res);
      expect(body.id).toBe(task.id);
      expect(body.version).toBe(rowAfter!.version);
      expect(body.completedAt).toBe(rowAfter!.completed_at);
    }

    if (event) {
      const received = await nextEvent(socket);
      expect(received.type).toBe(event);
      expect(received.version).toBe(rowAfter!.version);
      expect((received.entity as { id: string }).id).toBe(task.id);
      await expectFrames(socket, 1);
    } else {
      await expectFrames(socket, 0);
    }
  });
});

describe('Matrix C: access and cross-cutting', () => {
  it('TC-I41 a task of workspace B is 404 for all five operations while authenticated for A; B row unchanged', async () => {
    const a = await createWorkspace();
    const b = await createWorkspace(a.cookie);
    const bTask = await createdTask(b.workspace.id, b.cookie, { name: TASK_NAMES.mum });
    const before = await rawRow(bTask.id);
    const aSocket = await live(a.workspace.id, a.cookie);
    const bSocket = await live(b.workspace.id, b.cookie);
    // The shared cookie remembers both; the path names A, the task belongs to B.
    const responses = [
      await lifecycle(a.workspace.id, b.cookie, bTask.id, 'complete'),
      await lifecycle(a.workspace.id, b.cookie, bTask.id, 'reopen'),
      await lifecycle(a.workspace.id, b.cookie, bTask.id, 'restore'),
      await deleteTask(a.workspace.id, b.cookie, bTask.id),
      await patchTask(a.workspace.id, b.cookie, bTask.id, { name: 'Hijacked' }),
    ];
    for (const res of responses) {
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: 'not_found' });
    }
    expect(await rawRow(bTask.id)).toEqual(before);
    await expectFrames(aSocket, 0);
    expect(bSocket.frames).toEqual([]);
  });

  it('TC-I42 without the tdl_ws cookie every operation is 404 and nothing changes', async () => {
    const { workspace, cookie } = await createWorkspace();
    const task = await createdTask(workspace.id, cookie, { name: TASK_NAMES.milk });
    const before = await rawRow(task.id);
    for (const res of [
      await lifecycle(workspace.id, null, task.id, 'complete'),
      await lifecycle(workspace.id, null, task.id, 'reopen'),
      await lifecycle(workspace.id, null, task.id, 'restore'),
      await deleteTask(workspace.id, null, task.id),
      await patchTask(workspace.id, null, task.id, { name: 'x' }),
    ]) {
      expect(res.status).toBe(404);
    }
    expect(await rawRow(task.id)).toEqual(before);
  });

  it('TC-I43 a mutation without X-Todoodle-Client is 403 forbidden_client and nothing changes', async () => {
    const { workspace, cookie } = await createWorkspace();
    const task = await createdTask(workspace.id, cookie, { name: TASK_NAMES.milk });
    const before = await rawRow(task.id);
    for (const res of [
      await lifecycle(workspace.id, cookie, task.id, 'complete', { headers: { 'X-Todoodle-Client': '' } }),
      await lifecycle(workspace.id, cookie, task.id, 'reopen', { headers: { 'X-Todoodle-Client': 'curl' } }),
      await lifecycle(workspace.id, cookie, task.id, 'restore', { headers: { 'X-Todoodle-Client': '' } }),
      await deleteTask(workspace.id, cookie, task.id, {}),
      await patchTask(workspace.id, cookie, task.id, { name: 'x' }, { headers: {} }),
    ]) {
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ error: 'forbidden_client' });
    }
    expect(await rawRow(task.id)).toEqual(before);
  });

  it('TC-I45 the broadcast carries originClientId from X-Todoodle-Client-Id and the new version', async () => {
    const { workspace, cookie } = await createWorkspace();
    const task = await createdTask(workspace.id, cookie, { name: TASK_NAMES.milk });
    const socket = await live(workspace.id, cookie);
    const res = await lifecycle(workspace.id, cookie, task.id, 'complete', {
      headers: { ...CLIENT_HEADERS, 'X-Todoodle-Client-Id': CLIENT_X },
    });
    const completed = await taskFrom(res);
    const event = await nextEvent(socket);
    expect(event).toMatchObject({ type: 'task.upserted', originClientId: CLIENT_X, version: completed.version });
    expect(TaskSchema.parse(event.entity)).toEqual(completed);
    expect(completed.version).toBe(task.version + 1);

    await deleteTask(workspace.id, cookie, task.id, { ...CLIENT_HEADERS, 'X-Todoodle-Client-Id': CLIENT_X });
    expect(await nextEvent(socket, 1)).toEqual({
      type: 'task.deleted',
      entity: { id: task.id },
      version: completed.version + 1,
      originClientId: CLIENT_X,
    });
  });

  it('TC-I46 reopen puts the task back where it was: A,B,C; complete B; reopen B -> A,B,C', async () => {
    const { workspace, cookie } = await createWorkspace();
    const a = await createdTask(workspace.id, cookie, { name: 'A' });
    const b = await createdTask(workspace.id, cookie, { name: 'B' });
    const c = await createdTask(workspace.id, cookie, { name: 'C' });
    const ids = async () => ((await (await listTasks(workspace.id, cookie)).json()) as { tasks: { id: string }[] }).tasks.map((t) => t.id);
    expect((await lifecycle(workspace.id, cookie, b.id, 'complete')).status).toBe(200);
    expect(await ids()).toEqual([a.id, c.id]);
    expect((await lifecycle(workspace.id, cookie, b.id, 'reopen')).status).toBe(200);
    expect(await ids()).toEqual([a.id, b.id, c.id]);
  });

  it('TC-I48 delete is a soft delete: the raw row stays with deleted=1, deleted_at set and its fields intact', async () => {
    const { workspace, cookie } = await createWorkspace();
    const task = await createdTask(workspace.id, cookie, { name: TASK_NAMES.dentist, description: 'Morning\nBring the letter' });
    const before = await rawRow(task.id);
    expect((await deleteTask(workspace.id, cookie, task.id)).status).toBe(204);
    const row = await rawRow(task.id);
    expect(row).not.toBeNull();
    expect(row).toMatchObject({ deleted: 1, name: before!.name, description: before!.description, sort_order: before!.sort_order });
    expect(row!.deleted_at).not.toBeNull();
    // The test route shows the same row (e2e TC-E04 uses it).
    const raw = await (await fetchRaw(task.id)).json();
    expect(raw).toMatchObject({ task: { id: task.id, deleted: 1 } });
    // Gone from every list.
    const listed = (await (await listTasks(workspace.id, cookie, '?list=inbox&include_completed=true')).json()) as { tasks: unknown[] };
    expect(listed.tasks).toEqual([]);
  });

  it('TC-I49 two concurrent restores: both 200, version +1 once, one task.restored', async () => {
    const { workspace, cookie } = await createWorkspace();
    const task = await createdTask(workspace.id, cookie, { name: TASK_NAMES.milk });
    await deleteTask(workspace.id, cookie, task.id);
    const before = await rawRow(task.id);
    const socket = await live(workspace.id, cookie);
    const [r1, r2] = await Promise.all([
      lifecycle(workspace.id, cookie, task.id, 'restore'),
      lifecycle(workspace.id, cookie, task.id, 'restore'),
    ]);
    expect([r1.status, r2.status]).toEqual([200, 200]);
    const after = await rawRow(task.id);
    expect(after!.version).toBe(before!.version + 1);
    expect(after!.deleted).toBe(0);
    expect((await nextEvent(socket)).type).toBe('task.restored');
    await expectFrames(socket, 1);
  });

  it('TC-I50 bodyless POST complete, reopen, restore and bodyless DELETE with only the client header are accepted', async () => {
    const { workspace, cookie } = await createWorkspace();
    const task = await createdTask(workspace.id, cookie, { name: TASK_NAMES.milk });
    const bare = (action: string, method = 'POST') =>
      fetchWith(`/api/w/${workspace.id}/tasks/${task.id}${action}`, { method, headers: { ...CLIENT_HEADERS, Cookie: cookie } });
    expect((await bare('/complete')).status).toBe(200);
    expect((await bare('/reopen')).status).toBe(200);
    expect((await bare('', 'DELETE')).status).toBe(204);
    expect((await bare('/restore')).status).toBe(200);
    expect(await rawRow(task.id)).toMatchObject({ deleted: 0, completed_at: null, version: task.version + 4 });
  });

  it('a lifecycle POST with an empty JSON object body is accepted; any other body is 400', async () => {
    const { workspace, cookie } = await createWorkspace();
    const task = await createdTask(workspace.id, cookie, { name: TASK_NAMES.milk });
    expect((await lifecycle(workspace.id, cookie, task.id, 'complete', { body: {} })).status).toBe(200);
    const before = await rawRow(task.id);
    const res = await lifecycle(workspace.id, cookie, task.id, 'reopen', { body: { completedAt: null } });
    expect(res.status).toBe(400);
    expect(await rawRow(task.id)).toEqual(before);
  });

  it('a lifecycle POST with a text/plain body is 415 and changes nothing', async () => {
    const { workspace, cookie } = await createWorkspace();
    const task = await createdTask(workspace.id, cookie, { name: TASK_NAMES.milk });
    const before = await rawRow(task.id);
    const res = await lifecycle(workspace.id, cookie, task.id, 'complete', { body: '{}', headers: { ...CLIENT_HEADERS, 'Content-Type': 'text/plain' } });
    expect(res.status).toBe(415);
    expect(await rawRow(task.id)).toEqual(before);
  });
});

function fetchWith(path: string, init: RequestInit) {
  return SELF.fetch(`${ORIGIN}${path}`, init);
}
function fetchRaw(id: string) {
  return SELF.fetch(`${ORIGIN}/test/tasks/${id}/raw`);
}
