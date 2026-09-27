import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { countOpenTasks, insertTaskIdempotent, listOpenTasks } from '../../src/db/tasks';
import { newTaskId, TASK_NAMES } from '../fixtures/tasks';
import { countTaskRows, markCompleted, markDeleted, taskRows } from '../task-helpers';
import { createWorkspace } from '../workspace-helpers';

const db = () => env.DB;

async function insert(workspaceId: string, name: string, id = newTaskId()) {
  return insertTaskIdempotent(db(), { id, workspaceId, name, description: '' });
}

describe('tasks.store', () => {
  it('TC-32 migration 0002: table and index exist, FK to workspaces, no CHECK constraint', async () => {
    const table = await db()
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'tasks'")
      .first<{ sql: string }>();
    expect(table?.sql).toBeTruthy();
    expect(table!.sql).not.toMatch(/\bCHECK\b/i);
    const index = await db()
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_tasks_ws_open'")
      .first<{ sql: string }>();
    expect(index?.sql).toMatch(/tasks\s*\(\s*workspace_id,\s*deleted,\s*completed_at,\s*sort_order\s*\)/);
    const { results: fks } = await db().prepare('PRAGMA foreign_key_list(tasks)').all<{ table: string; from: string; to: string }>();
    expect(fks).toEqual([expect.objectContaining({ table: 'workspaces', from: 'workspace_id', to: 'id' })]);
    const { results: cols } = await db().prepare('PRAGMA table_info(tasks)').all<{ name: string; dflt_value: string | null; pk: number }>();
    expect(cols.find((c) => c.name === 'id')).toMatchObject({ pk: 1, dflt_value: null });
  });

  it('TC-01 a new id is created with sortOrder 1, version 1, open', async () => {
    const { workspace } = await createWorkspace();
    expect(await countTaskRows()).toBe(0);
    const result = await insert(workspace.id, TASK_NAMES.milk);
    expect(result.status).toBe('created');
    expect(result.task).toMatchObject({ name: 'Buy milk', description: '', sort_order: 1, version: 1, completed_at: null, deleted: 0 });
    expect(await countTaskRows()).toBe(1);
  });

  it('TC-11 replaying the same id in the same workspace returns the existing row unchanged', async () => {
    const { workspace } = await createWorkspace();
    const id = newTaskId();
    await insert(workspace.id, TASK_NAMES.milk, id);
    const replay = await insert(workspace.id, TASK_NAMES.milk, id);
    expect(replay.status).toBe('replayed');
    expect(replay.task).toMatchObject({ id, version: 1 });
    expect(await countTaskRows()).toBe(1);
  });

  it('TC-12 a replay with a different name never overwrites', async () => {
    const { workspace } = await createWorkspace();
    const id = newTaskId();
    await insert(workspace.id, TASK_NAMES.milk, id);
    const replay = await insert(workspace.id, 'Something else', id);
    expect(replay.task?.name).toBe('Buy milk');
    expect((await taskRows())[0]).toMatchObject({ name: 'Buy milk', version: 1 });
  });

  it('TC-13 an id that exists here but is soft-deleted is gone', async () => {
    const { workspace } = await createWorkspace();
    const id = newTaskId();
    await insert(workspace.id, TASK_NAMES.milk, id);
    await markDeleted(id);
    expect((await insert(workspace.id, TASK_NAMES.milk, id)).status).toBe('gone');
    expect((await taskRows())[0]).toMatchObject({ deleted: 1 });
  });

  it('TC-14 an id that exists in another workspace is a conflict; neither workspace changes', async () => {
    const a = await createWorkspace();
    const b = await createWorkspace();
    const id = newTaskId();
    await insert(a.workspace.id, TASK_NAMES.milk, id);
    const result = await insert(b.workspace.id, 'Hijack', id);
    expect(result).toEqual({ status: 'conflict' });
    expect(await taskRows(a.workspace.id)).toEqual([expect.objectContaining({ name: 'Buy milk', version: 1 })]);
    expect(await countTaskRows(b.workspace.id)).toBe(0);
  });

  it('TC-20 sequential inserts get sortOrder 1, 2, 3 and list in that order', async () => {
    const { workspace } = await createWorkspace();
    for (const name of ['A', 'B', 'C']) await insert(workspace.id, name);
    const rows = await listOpenTasks(db(), workspace.id, { list: 'inbox' });
    expect(rows.map((r) => [r.name, r.sort_order])).toEqual([['A', 1], ['B', 2], ['C', 3]]);
  });

  it('TC-21 ten concurrent inserts get ten distinct sortOrder values', async () => {
    const { workspace } = await createWorkspace();
    await Promise.all(Array.from({ length: 10 }, (_, i) => insert(workspace.id, `Task ${i}`)));
    const rows = await taskRows(workspace.id);
    expect(rows).toHaveLength(10);
    expect(new Set(rows.map((r) => r.sort_order)).size).toBe(10);
  });

  it('sortOrder continues after completed and deleted tasks (MAX spans the whole workspace)', async () => {
    const { workspace } = await createWorkspace();
    const first = await insert(workspace.id, 'A');
    const second = await insert(workspace.id, 'B');
    await markCompleted(first.task!.id);
    await markDeleted(second.task!.id);
    expect((await insert(workspace.id, 'C')).task?.sort_order).toBe(3);
  });

  it('sortOrder is per workspace', async () => {
    const a = await createWorkspace();
    const b = await createWorkspace();
    await insert(a.workspace.id, 'A1');
    await insert(a.workspace.id, 'A2');
    expect((await insert(b.workspace.id, 'B1')).task?.sort_order).toBe(1);
  });

  it('TC-25 listOpenTasks returns only this workspace’s open, non-deleted tasks', async () => {
    const a = await createWorkspace();
    const b = await createWorkspace();
    const open1 = await insert(a.workspace.id, 'Open 1');
    const done = await insert(a.workspace.id, 'Done');
    const gone = await insert(a.workspace.id, 'Deleted');
    const open2 = await insert(a.workspace.id, 'Open 2');
    await insert(b.workspace.id, 'Other workspace');
    await markCompleted(done.task!.id);
    await markDeleted(gone.task!.id);
    const rows = await listOpenTasks(db(), a.workspace.id, { list: 'inbox' });
    expect(rows.map((r) => r.id)).toEqual([open1.task!.id, open2.task!.id]);
  });

  it('TC-27 an empty workspace lists nothing', async () => {
    const { workspace } = await createWorkspace();
    expect(await listOpenTasks(db(), workspace.id, { list: 'inbox' })).toEqual([]);
  });

  it('TC-28 countOpenTasks counts 3 open of 5 (1 completed, 1 deleted)', async () => {
    const { workspace } = await createWorkspace();
    const created = [];
    for (const name of ['A', 'B', 'C', 'D', 'E']) created.push(await insert(workspace.id, name));
    await markCompleted(created[1]!.task!.id);
    await markDeleted(created[3]!.task!.id);
    expect(await countOpenTasks(db(), workspace.id)).toEqual({ inbox: 3 });
  });
});
