import { TaskSchema } from '@todoodle/shared/schemas';
import { describe, expect, it } from 'vitest';
import { rowToTask, type TaskRow } from '../../src/db/tasks';

const row: TaskRow = {
  id: '0123456789abcdef0123456789abcdef',
  workspace_id: 'fedcba9876543210fedcba9876543210',
  name: 'Buy milk',
  description: '',
  sort_order: 3,
  completed_at: null,
  version: 1,
  created_at: '2026-09-27 10:00:00',
  updated_at: '2026-09-27 10:00:00',
  deleted: 0,
  deleted_at: null,
};

describe('rowToTask', () => {
  it('maps snake_case columns to the public Task shape', () => {
    expect(rowToTask(row)).toEqual({
      id: row.id,
      workspaceId: row.workspace_id,
      name: 'Buy milk',
      description: '',
      sortOrder: 3,
      completedAt: null,
      version: 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  });

  it('keeps a null completed_at null and a set one as is', () => {
    expect(rowToTask(row).completedAt).toBeNull();
    expect(rowToTask({ ...row, completed_at: '2026-09-28 09:00:00' }).completedAt).toBe('2026-09-28 09:00:00');
  });

  it('returns a numeric sortOrder (REAL column)', () => {
    expect(rowToTask({ ...row, sort_order: 2.5 }).sortOrder).toBe(2.5);
    expect(typeof rowToTask(row).sortOrder).toBe('number');
  });

  it('never exposes deleted flags and satisfies TaskSchema', () => {
    const task = rowToTask({ ...row, deleted: 1, deleted_at: 'x' });
    expect(task).not.toHaveProperty('deleted');
    expect(task).not.toHaveProperty('deletedAt');
    expect(TaskSchema.safeParse(task).success).toBe(true);
  });
});
