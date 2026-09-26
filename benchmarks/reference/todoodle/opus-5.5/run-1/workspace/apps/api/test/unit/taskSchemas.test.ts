import { TASK_DESCRIPTION_MAX, TASK_NAME_MAX } from '@todoodle/shared/limits';
import { CreateTaskInputSchema, TaskListQuerySchema, TaskSchema } from '@todoodle/shared/schemas';
import { describe, expect, it } from 'vitest';
import { type TaskRow, rowToTask } from '../../src/db/tasks.ts';
import {
  DESCRIPTION_AT_LIMIT,
  DESCRIPTION_OVER_LIMIT,
  MULTI_LINE_DESCRIPTION,
  NAME_AT_LIMIT,
  NAME_OVER_LIMIT,
  TASK_NAMES,
  newTaskId,
} from '../fixtures/tasks.ts';

const ID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

describe('TC-30 CreateTaskInputSchema', () => {
  const parse = (fields: Record<string, unknown>) => CreateTaskInputSchema.safeParse({ id: ID, ...fields });

  it.each([
    ['empty', ''],
    ['whitespace-only', ' \t  '],
    ['over the limit', NAME_OVER_LIMIT],
  ])('rejects a %s name, with the issue on name', (_label, name) => {
    const result = parse({ name });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['name']);
  });

  it.each([
    ['1 char', 'x'],
    ['exactly the limit', NAME_AT_LIMIT],
    ['emoji', TASK_NAMES.mum],
    ['realistic', TASK_NAMES.invoice],
  ])('accepts a %s name', (_label, name) => {
    expect(parse({ name }).success).toBe(true);
  });

  it('trims the name and the description; lengths are measured after trimming', () => {
    expect(parse({ name: '  Buy milk  ', description: '  note  ' }).data).toEqual({ id: ID, name: 'Buy milk', description: 'note' });
    expect(parse({ name: ` ${NAME_AT_LIMIT} ` }).data?.name).toHaveLength(TASK_NAME_MAX);
  });

  it('an absent description defaults to empty; an empty one is kept empty', () => {
    expect(parse({ name: 'x' }).data?.description).toBe('');
    expect(parse({ name: 'x', description: '' }).data?.description).toBe('');
  });

  it('accepts a description at the limit and a multi-line one; rejects one over the limit', () => {
    expect(parse({ name: 'x', description: DESCRIPTION_AT_LIMIT }).data?.description).toHaveLength(TASK_DESCRIPTION_MAX);
    expect(parse({ name: 'x', description: MULTI_LINE_DESCRIPTION }).data?.description).toBe(MULTI_LINE_DESCRIPTION);
    const over = parse({ name: 'x', description: DESCRIPTION_OVER_LIMIT });
    expect(over.success).toBe(false);
    expect(over.error?.issues[0]?.path).toEqual(['description']);
  });

  it('counts UTF-16 code units: an emoji counts as 2', () => {
    const emojiName = '📞'.repeat(TASK_NAME_MAX / 2);
    expect(parse({ name: emojiName }).success).toBe(true);
    expect(parse({ name: `${emojiName}x` }).success).toBe(false);
  });

  it.each([['ABC'], [ID.toUpperCase()], [`${ID}0`], [ID.slice(1)], ['z'.repeat(32)], [42], [undefined]])('rejects id %s', (id) => {
    expect(CreateTaskInputSchema.safeParse({ id, name: 'x' }).success).toBe(false);
  });

  it('accepts ids produced like the client does', () => {
    expect(CreateTaskInputSchema.safeParse({ id: newTaskId(), name: 'x' }).success).toBe(true);
  });

  it('strips unknown keys such as foo', () => {
    expect(parse({ name: 'x', foo: 'bar' }).data).toEqual({ id: ID, name: 'x', description: '' });
  });
});

describe('TC-31 TaskListQuerySchema', () => {
  it('accepts inbox', () => {
    expect(TaskListQuerySchema.parse({ list: 'inbox' })).toEqual({ list: 'inbox' });
  });

  it('defaults a missing list to inbox', () => {
    expect(TaskListQuerySchema.parse({})).toEqual({ list: 'inbox' });
    expect(TaskListQuerySchema.parse({ list: undefined })).toEqual({ list: 'inbox' });
  });

  it('rejects anything else', () => {
    expect(TaskListQuerySchema.safeParse({ list: 'bogus' }).success).toBe(false);
    expect(TaskListQuerySchema.safeParse({ list: '' }).success).toBe(false);
  });
});

describe('rowToTask', () => {
  const row: TaskRow = {
    id: ID,
    workspace_id: '0123456789ABCDEF0123456789ABCDEF',
    name: TASK_NAMES.dentist,
    description: MULTI_LINE_DESCRIPTION,
    sort_order: 3,
    completed_at: null,
    version: 1,
    created_at: '2026-09-26 10:00:00',
    updated_at: '2026-09-26 10:00:01',
    deleted: 0,
    deleted_at: null,
  };

  it('maps snake_case to the public Task shape, keeping a null completedAt', () => {
    const task = rowToTask(row);
    expect(task).toEqual({
      id: ID,
      workspaceId: '0123456789ABCDEF0123456789ABCDEF',
      name: TASK_NAMES.dentist,
      description: MULTI_LINE_DESCRIPTION,
      sortOrder: 3,
      completedAt: null,
      version: 1,
      createdAt: '2026-09-26 10:00:00',
      updatedAt: '2026-09-26 10:00:01',
    });
    expect(TaskSchema.parse(task)).toEqual(task);
  });

  it('never copies deleted flags, and keeps a numeric sortOrder and a set completedAt', () => {
    const task = rowToTask({ ...row, sort_order: 2.5, completed_at: '2026-09-27 08:00:00', deleted: 1, deleted_at: 'x' });
    expect(task.sortOrder).toBe(2.5);
    expect(task.completedAt).toBe('2026-09-27 08:00:00');
    expect(Object.keys(task)).not.toContain('deleted');
    expect(Object.keys(task)).not.toContain('deletedAt');
  });
});
