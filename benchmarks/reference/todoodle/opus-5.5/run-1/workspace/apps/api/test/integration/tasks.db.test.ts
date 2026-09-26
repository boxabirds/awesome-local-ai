import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { countOpenTasks, insertTaskIdempotent, listOpenTasks } from '../../src/db/tasks.ts';
import { TASK_NAMES, newTaskId } from '../fixtures/tasks.ts';
import { markCompleted, markDeleted, taskRow, taskRows } from '../support/tasks.ts';
import { seedWorkspace } from '../support/workspaces.ts';

const db = () => env.DB;

async function workspaceId(): Promise<string> {
  return (await seedWorkspace()).workspace.id;
}

describe('tasks.store: migration 0002', () => {
  it('TC-32 creates the tasks table and index, references workspaces, and has no CHECK constraint', async () => {
    const { results: columns } = await db().prepare('PRAGMA table_info(tasks)').all<{ name: string; notnull: number; pk: number; dflt_value: string | null }>();
    expect(columns.map((c) => c.name)).toEqual([
      'id',
      'workspace_id',
      'name',
      'description',
      'sort_order',
      'completed_at',
      'version',
      'created_at',
      'updated_at',
      'deleted',
      'deleted_at',
    ]);
    const id = columns.find((c) => c.name === 'id');
    expect(id?.pk).toBe(1);
    expect(id?.dflt_value).toBeNull();

    const { results: fks } = await db().prepare('PRAGMA foreign_key_list(tasks)').all<{ table: string; from: string; to: string }>();
    expect(fks).toEqual([expect.objectContaining({ table: 'workspaces', from: 'workspace_id', to: 'id' })]);

    const { results: indexCols } = await db().prepare('PRAGMA index_info(idx_tasks_ws_open)').all<{ name: string }>();
    expect(indexCols.map((c) => c.name)).toEqual(['workspace_id', 'deleted', 'completed_at', 'sort_order']);

    const sql = await db().prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'tasks'").first<{ sql: string }>();
    expect(sql?.sql).not.toMatch(/CHECK/i);
  });
});

describe('tasks.store: insertTaskIdempotent', () => {
  it('TC-01 inserts a new task with sort_order 1 and version 1', async () => {
    const ws = await workspaceId();
    const id = newTaskId();
    const result = await insertTaskIdempotent(db(), { id, workspaceId: ws, name: TASK_NAMES.milk, description: '' });
    expect(result).toMatchObject({ status: 'created', task: { id, name: 'Buy milk', sort_order: 1, version: 1, completed_at: null } });
    expect(await taskRows()).toHaveLength(1);
  });

  it('TC-11/TC-12 a replay reports replayed with the stored row and writes nothing', async () => {
    const ws = await workspaceId();
    const id = newTaskId();
    await insertTaskIdempotent(db(), { id, workspaceId: ws, name: 'Original', description: '' });
    const before = await taskRow(id);
    const result = await insertTaskIdempotent(db(), { id, workspaceId: ws, name: 'Changed', description: 'x' });
    expect(result).toEqual({ status: 'replayed', task: before });
    expect(await taskRow(id)).toEqual(before);
  });

  it('TC-13 a soft-deleted id reports gone', async () => {
    const ws = await workspaceId();
    const id = newTaskId();
    await insertTaskIdempotent(db(), { id, workspaceId: ws, name: 'A', description: '' });
    await markDeleted(id);
    expect(await insertTaskIdempotent(db(), { id, workspaceId: ws, name: 'A', description: '' })).toEqual({ status: 'gone' });
    expect(await taskRow(id)).toMatchObject({ deleted: 1 });
  });

  it("TC-14 another workspace's id reports conflict and leaves its row alone", async () => {
    const theirs = await workspaceId();
    const mine = await workspaceId();
    const id = newTaskId();
    await insertTaskIdempotent(db(), { id, workspaceId: theirs, name: 'Theirs', description: '' });
    const before = await taskRow(id);
    expect(await insertTaskIdempotent(db(), { id, workspaceId: mine, name: 'Mine', description: '' })).toEqual({ status: 'conflict' });
    expect(await taskRow(id)).toEqual(before);
    expect(await taskRows(mine)).toHaveLength(0);
  });

  it('TC-20 sequential inserts get 1, 2, 3; sort orders are per workspace', async () => {
    const ws = await workspaceId();
    const other = await workspaceId();
    await insertTaskIdempotent(db(), { id: newTaskId(), workspaceId: other, name: 'X', description: '' });
    for (const name of ['A', 'B', 'C']) await insertTaskIdempotent(db(), { id: newTaskId(), workspaceId: ws, name, description: '' });
    expect((await taskRows(ws)).map((r) => [r.name, r.sort_order])).toEqual([
      ['A', 1],
      ['B', 2],
      ['C', 3],
    ]);
  });

  it('TC-21 10 concurrent inserts get distinct sort orders', async () => {
    const ws = await workspaceId();
    await Promise.all(Array.from({ length: 10 }, (_, i) => insertTaskIdempotent(db(), { id: newTaskId(), workspaceId: ws, name: `T${i}`, description: '' })));
    const rows = await taskRows(ws);
    expect(rows).toHaveLength(10);
    expect(new Set(rows.map((r) => r.sort_order)).size).toBe(10);
  });
});

describe('tasks.store: listOpenTasks and countOpenTasks', () => {
  it('TC-25/TC-28 only open, non-deleted tasks of the workspace, in sort order', async () => {
    const ws = await workspaceId();
    const other = await workspaceId();
    const ids: string[] = [];
    for (const name of ['A', 'B', 'C', 'D', 'E']) {
      const id = newTaskId();
      ids.push(id);
      await insertTaskIdempotent(db(), { id, workspaceId: ws, name, description: '' });
    }
    await insertTaskIdempotent(db(), { id: newTaskId(), workspaceId: other, name: 'X', description: '' });
    await markCompleted(ids[1]!);
    await markDeleted(ids[3]!);
    expect((await listOpenTasks(db(), ws, { list: 'inbox' })).map((r) => r.name)).toEqual(['A', 'C', 'E']);
    expect(await countOpenTasks(db(), ws)).toEqual({ inbox: 3 });
  });

  it('TC-27 an empty workspace lists nothing and counts 0', async () => {
    const ws = await workspaceId();
    expect(await listOpenTasks(db(), ws, { list: 'inbox' })).toEqual([]);
    expect(await countOpenTasks(db(), ws)).toEqual({ inbox: 0 });
  });
});
