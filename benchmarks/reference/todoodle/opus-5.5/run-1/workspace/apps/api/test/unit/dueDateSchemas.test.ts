import { RESCHEDULE_MAX_IDS } from '@todoodle/shared/limits';
import {
  CountsSchema,
  CreateTaskInputSchema,
  TaskPatchSchema,
  TaskSchema,
  countsQuerySchema,
  localDateSchema,
  rescheduleRequestSchema,
  restoreDueDatesRequestSchema,
  todayQuerySchema,
} from '@todoodle/shared/schemas';
import { describe, expect, it } from 'vitest';

// Story 8: the zod schemas at every boundary that takes a date (TC-21..TC-29 through the task schemas), and the
// reschedule/restore request rules (empty, oversize, duplicates, bad dates).

const id = (n: number) => n.toString(16).padStart(32, '0');
const TO = '2026-09-25';

describe('localDateSchema through createTask and PATCH (TC-21..TC-29)', () => {
  it.each([
    ['2028-02-29', true],
    ['2027-02-29', false],
    ['2026-13-01', false],
    ['2026-09-31', false],
    ['2026-9-5', false],
    ['2026-09-25T00:00', false],
    ['', false],
    ['1969-12-31', false],
    ['10000-01-01', false],
    ['1970-01-01', true],
    ['9999-12-31', true],
  ])('%j -> %s', (dueDate, ok) => {
    expect(localDateSchema.safeParse(dueDate).success).toBe(ok);
    expect(CreateTaskInputSchema.safeParse({ id: id(1), name: 'Renew passport', dueDate }).success).toBe(ok);
    expect(TaskPatchSchema.safeParse({ dueDate }).success).toBe(ok);
  });

  it('null clears; a number or a word is refused; absent means unchanged (create: no date)', () => {
    expect(TaskPatchSchema.safeParse({ dueDate: null }).success).toBe(true);
    expect(TaskPatchSchema.safeParse({ dueDate: 20260925 }).success).toBe(false);
    expect(CreateTaskInputSchema.safeParse({ id: id(1), name: 'x', dueDate: 'tomorrow' }).success).toBe(false);
    expect(CreateTaskInputSchema.parse({ id: id(1), name: 'x' }).dueDate).toBeUndefined();
    expect(TaskPatchSchema.safeParse({}).success).toBe(false);
  });

  it('a task without dueDate (pre-story-8 payload) parses with dueDate null', () => {
    const task = TaskSchema.parse({
      id: id(1),
      workspaceId: 'W',
      name: 'x',
      description: '',
      sortOrder: 1,
      completedAt: null,
      version: 1,
      createdAt: '',
      updatedAt: '',
    });
    expect(task.dueDate).toBeNull();
  });
});

describe('today and counts queries', () => {
  it('today: date required and valid; includeCompleted is 1/true/0/false', () => {
    expect(todayQuerySchema.parse({ date: TO })).toEqual({ date: TO, includeCompleted: false });
    expect(todayQuerySchema.parse({ date: TO, includeCompleted: '1' }).includeCompleted).toBe(true);
    expect(todayQuerySchema.parse({ date: TO, includeCompleted: 'true' }).includeCompleted).toBe(true);
    expect(todayQuerySchema.parse({ date: TO, includeCompleted: '0' }).includeCompleted).toBe(false);
    expect(todayQuerySchema.safeParse({}).success).toBe(false);
    expect(todayQuerySchema.safeParse({ date: '2026-02-30' }).success).toBe(false);
    expect(todayQuerySchema.safeParse({ date: TO, includeCompleted: 'yes' }).success).toBe(false);
  });

  it('counts: the date is optional; today is optional in the response', () => {
    expect(countsQuerySchema.parse({})).toEqual({});
    expect(countsQuerySchema.parse({ date: TO })).toEqual({ date: TO });
    expect(countsQuerySchema.safeParse({ date: 'today' }).success).toBe(false);
    expect(CountsSchema.parse({ inbox: 1 })).toEqual({ inbox: 1, projects: {} });
    expect(CountsSchema.parse({ inbox: 1, today: 3 }).today).toBe(3);
    expect(CountsSchema.safeParse({ inbox: 1, today: -1 }).success).toBe(false);
  });
});

describe('rescheduleRequestSchema', () => {
  it('accepts 1..RESCHEDULE_MAX_IDS unique ids and a real date', () => {
    expect(rescheduleRequestSchema.safeParse({ ids: [id(1)], to: TO }).success).toBe(true);
    const max = Array.from({ length: RESCHEDULE_MAX_IDS }, (_, i) => id(i + 1));
    expect(rescheduleRequestSchema.safeParse({ ids: max, to: TO }).success).toBe(true);
  });

  it.each([
    ['empty', { ids: [], to: TO }],
    ['oversize', { ids: Array.from({ length: RESCHEDULE_MAX_IDS + 1 }, (_, i) => id(i + 1)), to: TO }],
    ['duplicate ids', { ids: [id(1), id(1)], to: TO }],
    ['bad date', { ids: [id(1)], to: '2026-02-30' }],
    ['missing date', { ids: [id(1)] }],
    ['malformed id', { ids: ['nope'], to: TO }],
  ])('rejects %s', (_label, body) => {
    expect(rescheduleRequestSchema.safeParse(body).success).toBe(false);
  });
});

describe('restoreDueDatesRequestSchema', () => {
  const item = (n: number, patch: Record<string, unknown> = {}) => ({ id: id(n), dueDate: '2026-09-20', expectedVersion: 2, ...patch });

  it('accepts items with a date or null and an integer version', () => {
    expect(restoreDueDatesRequestSchema.safeParse({ items: [item(1), item(2, { dueDate: null })] }).success).toBe(true);
  });

  it.each([
    ['empty', { items: [] }],
    ['oversize', { items: Array.from({ length: RESCHEDULE_MAX_IDS + 1 }, (_, i) => item(i + 1)) }],
    ['duplicate ids', { items: [item(1), item(1)] }],
    ['bad date', { items: [item(1, { dueDate: '2026-02-30' })] }],
    ['non-integer version', { items: [item(1, { expectedVersion: 1.5 })] }],
    ['missing version', { items: [{ id: id(1), dueDate: '2026-09-20' }] }],
  ])('rejects %s', (_label, body) => {
    expect(restoreDueDatesRequestSchema.safeParse(body).success).toBe(false);
  });
});
