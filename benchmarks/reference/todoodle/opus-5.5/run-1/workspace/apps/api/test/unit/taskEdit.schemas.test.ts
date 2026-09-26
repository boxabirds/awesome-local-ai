import { TASK_DESCRIPTION_MAX, TASK_NAME_MAX } from '@todoodle/shared/limits';
import { type Task, TaskPatchSchema, orderTasks, parseIncludeCompleted, resolvePatchedName } from '@todoodle/shared/schemas';
import { describe, expect, it } from 'vitest';
import { DESCRIPTION_AT_LIMIT, DESCRIPTION_OVER_LIMIT, NAME_AT_LIMIT, NAME_OVER_LIMIT, TASK_NAMES } from '../fixtures/tasks.ts';

// Story 6, design Matrix D: TC-U01..TC-U07 (the shared schemas and ordering the API and web both use).

describe('TC-U01 TaskPatchSchema accepts name only, description only, and both', () => {
  it.each([
    ['name only', { name: TASK_NAMES.invoice }],
    ['description only', { description: 'Ask about:\n- the Tuesday slot' }],
    ['both', { name: TASK_NAMES.mum, description: '' }],
  ])('%s', (_label, body) => {
    expect(TaskPatchSchema.safeParse(body).success).toBe(true);
  });

  it('trims both fields', () => {
    expect(TaskPatchSchema.parse({ name: '  Buy milk  ', description: ' note \n' })).toEqual({ name: 'Buy milk', description: 'note' });
  });

  it('a blank name is valid input (it means keep the previous name)', () => {
    expect(TaskPatchSchema.parse({ name: '   ' })).toEqual({ name: '' });
  });
});

describe('TC-U02 TaskPatchSchema rejects an empty object', () => {
  it('refine: at least one field', () => {
    const result = TaskPatchSchema.safeParse({});
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('Change at least one field');
  });
});

describe('TC-U03 TaskPatchSchema is strict', () => {
  it.each([
    ['completedAt', { name: 'x', completedAt: '2026-09-26T10:00:00.000Z' }],
    ['deleted', { deleted: 1 }],
    ['sortOrder', { description: 'x', sortOrder: 0 }],
  ])('rejects the unknown key %s', (_label, body) => {
    const result = TaskPatchSchema.safeParse(body);
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.code === 'unrecognized_keys')).toBe(true);
  });
});

describe('TC-U04 TaskPatchSchema length limits', () => {
  it('name: TASK_NAME_MAX ok, +1 error', () => {
    expect(NAME_AT_LIMIT).toHaveLength(TASK_NAME_MAX);
    expect(TaskPatchSchema.safeParse({ name: NAME_AT_LIMIT }).success).toBe(true);
    expect(TaskPatchSchema.safeParse({ name: NAME_OVER_LIMIT }).success).toBe(false);
  });

  it('description: TASK_DESCRIPTION_MAX ok, +1 error', () => {
    expect(DESCRIPTION_AT_LIMIT).toHaveLength(TASK_DESCRIPTION_MAX);
    expect(TaskPatchSchema.safeParse({ description: DESCRIPTION_AT_LIMIT }).success).toBe(true);
    expect(TaskPatchSchema.safeParse({ description: DESCRIPTION_OVER_LIMIT }).success).toBe(false);
  });

  it('counts UTF-16 code units, like the client counters', () => {
    const emoji = '📞'.repeat(TASK_NAME_MAX / 2);
    expect(TaskPatchSchema.safeParse({ name: emoji }).success).toBe(true);
    expect(TaskPatchSchema.safeParse({ name: `${emoji}x` }).success).toBe(false);
  });
});

describe('TC-U05 resolvePatchedName', () => {
  it.each([
    ['blank', '', 'Buy milk'],
    ['whitespace', ' \t ', 'Buy milk'],
    ['padded', '  Buy oat milk  ', 'Buy oat milk'],
    ['normal', 'Call Mum 📞', 'Call Mum 📞'],
    ['absent', undefined, 'Buy milk'],
  ])('%s', (_label, input, expected) => {
    expect(resolvePatchedName(input, 'Buy milk')).toBe(expected);
  });
});

describe('TC-U06 parseIncludeCompleted', () => {
  it('absent -> false, true -> true, false -> false', () => {
    expect(parseIncludeCompleted(undefined)).toBe(false);
    expect(parseIncludeCompleted('true')).toBe(true);
    expect(parseIncludeCompleted('false')).toBe(false);
  });

  it.each(['yes', '1', 'TRUE', ''])('%j -> error', (value) => {
    expect(() => parseIncludeCompleted(value)).toThrow();
  });
});

describe('TC-U07 orderTasks', () => {
  const task = (id: string, sortOrder: number, completedAt: string | null): Task => ({
    id: id.padEnd(32, '0'),
    workspaceId: 'W',
    projectId: null,
    name: id,
    description: '',
    sortOrder,
    completedAt,
    version: 1,
    createdAt: '',
    updatedAt: '',
  });

  it('open by sortOrder, then completed by completedAt desc; ties by id; stable and immutable', () => {
    const input = [
      task('c1', 1, '2026-09-20T10:00:00.000Z'),
      task('o3', 3, null),
      task('c2', 2, '2026-09-25T10:00:00.000Z'),
      task('o1', 1.5, null),
      task('ob', 2, null),
      task('oa', 2, null),
      task('cb', 4, '2026-09-22T10:00:00.000Z'),
      task('ca', 9, '2026-09-22T10:00:00.000Z'),
    ];
    const copy = [...input];
    const ordered = orderTasks(input);
    expect(ordered.map((t) => t.name)).toEqual(['o1', 'oa', 'ob', 'o3', 'c2', 'ca', 'cb', 'c1']);
    expect(input).toEqual(copy);
    expect(orderTasks(ordered).map((t) => t.name)).toEqual(ordered.map((t) => t.name));
  });
});
