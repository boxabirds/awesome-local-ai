import { TASK_DESCRIPTION_MAX, TASK_NAME_MAX } from '@todoodle/shared/limits';
import {
  ListTasksQuerySchema,
  orderTasks,
  parseIncludeCompleted,
  resolvePatchedName,
  type Task,
  TaskPatchSchema,
} from '@todoodle/shared/schemas';
import { describe, expect, it } from 'vitest';

describe('TaskPatchSchema', () => {
  it('TC-U01 accepts name only, description only, and both', () => {
    expect(TaskPatchSchema.safeParse({ name: 'Buy oat milk' }).success).toBe(true);
    expect(TaskPatchSchema.safeParse({ description: 'Semi-skimmed, 2 pints\nAlso: bread?' }).success).toBe(true);
    expect(TaskPatchSchema.parse({ name: 'Call Mum 📞', description: '' })).toEqual({ name: 'Call Mum 📞', description: '' });
  });

  it('TC-U02 an empty object is refused (at least one field)', () => {
    const r = TaskPatchSchema.safeParse({});
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toMatch(/at least one/i);
  });

  it('TC-U03 an unknown key is refused (strict), so lifecycle fields cannot be patched', () => {
    const r = TaskPatchSchema.safeParse({ name: 'Buy milk', completedAt: '2026-09-27T10:00:00.000Z' });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.code).toBe('unrecognized_keys');
    expect(TaskPatchSchema.safeParse({ version: 3 }).success).toBe(false);
  });

  it('TC-U04 name at TASK_NAME_MAX is accepted, one more is refused; the same for the description', () => {
    expect(TaskPatchSchema.safeParse({ name: 'a'.repeat(TASK_NAME_MAX) }).success).toBe(true);
    expect(TaskPatchSchema.safeParse({ name: 'a'.repeat(TASK_NAME_MAX + 1) }).success).toBe(false);
    // Measured after trimming, like create.
    expect(TaskPatchSchema.safeParse({ name: `  ${'a'.repeat(TASK_NAME_MAX)}  ` }).success).toBe(true);
    expect(TaskPatchSchema.safeParse({ description: 'd'.repeat(TASK_DESCRIPTION_MAX) }).success).toBe(true);
    expect(TaskPatchSchema.safeParse({ description: 'd'.repeat(TASK_DESCRIPTION_MAX + 1) }).success).toBe(false);
  });

  it('accepts a blank name (it means "keep the previous name")', () => {
    expect(TaskPatchSchema.safeParse({ name: '' }).success).toBe(true);
    expect(TaskPatchSchema.safeParse({ name: '   ' }).success).toBe(true);
  });
});

describe('TC-U05 resolvePatchedName', () => {
  it.each([
    ['blank', '', 'Buy milk'],
    ['whitespace', ' \t ', 'Buy milk'],
    ['padded', '  Buy oat milk  ', 'Buy oat milk'],
    ['normal', 'Email Sam re: invoice #4411', 'Email Sam re: invoice #4411'],
    ['absent', undefined, 'Buy milk'],
  ])('%s', (_label, input, expected) => {
    expect(resolvePatchedName(input, 'Buy milk')).toBe(expected);
  });
});

describe('TC-U06 parseIncludeCompleted', () => {
  it('absent is false, "true" is true, "false" is false', () => {
    expect(parseIncludeCompleted(undefined)).toBe(false);
    expect(parseIncludeCompleted('true')).toBe(true);
    expect(parseIncludeCompleted('false')).toBe(false);
  });

  it('"yes" is an error', () => {
    expect(() => parseIncludeCompleted('yes')).toThrow();
    expect(ListTasksQuerySchema.safeParse({ include_completed: 'yes' }).success).toBe(false);
  });

  it('the query keeps the list default', () => {
    expect(ListTasksQuerySchema.parse({})).toEqual({ list: 'inbox' });
  });
});

describe('TC-U07 orderTasks', () => {
  const t = (id: string, sortOrder: number, completedAt: string | null): Pick<Task, 'id' | 'sortOrder' | 'completedAt'> => ({
    id,
    sortOrder,
    completedAt,
  });

  it('open by sortOrder, then completed by completedAt descending, ties by id', () => {
    const input = [
      t('c1', 1, '2026-09-20T09:00:00.000Z'),
      t('o3', 3, null),
      t('c2', 7, '2026-09-26T09:00:00.000Z'),
      t('o1', 1.5, null),
      t('ob', 2, null),
      t('oa', 2, null),
      t('c4', 2, '2026-09-26T09:00:00.000Z'),
      t('c3', 9, '2026-09-22T09:00:00.000Z'),
    ];
    expect(orderTasks(input).map((x) => x.id)).toEqual(['o1', 'oa', 'ob', 'o3', 'c2', 'c4', 'c3', 'c1']);
  });

  it('is stable and does not mutate its input', () => {
    const input = [t('b', 2, null), t('a', 1, null)];
    const copy = [...input];
    const once = orderTasks(input);
    expect(input).toEqual(copy);
    expect(orderTasks(once)).toEqual(once);
  });
});
