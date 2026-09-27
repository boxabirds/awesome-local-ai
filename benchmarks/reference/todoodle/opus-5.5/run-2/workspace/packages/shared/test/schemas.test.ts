import { TASK_DESCRIPTION_MAX, TASK_NAME_MAX } from '@todoodle/shared/limits';
import { CreateTaskInputSchema, TaskListQuerySchema } from '@todoodle/shared/schemas';
import { describe, expect, it } from 'vitest';

const ID = '0123456789abcdef0123456789abcdef';
const parse = (body: Record<string, unknown>) => CreateTaskInputSchema.safeParse({ id: ID, ...body });

describe('TC-30 CreateTaskInputSchema', () => {
  it('accepts a plain name and defaults the description to empty', () => {
    const r = parse({ name: 'Buy milk' });
    expect(r.success && r.data).toEqual({ id: ID, name: 'Buy milk', description: '' });
  });

  it('trims the name and the description', () => {
    const r = parse({ name: '  Buy milk  ', description: '  semi-skimmed \n' });
    expect(r.success && r.data).toMatchObject({ name: 'Buy milk', description: 'semi-skimmed' });
  });

  it.each([
    ['empty', ''],
    ['whitespace-only', ' \t  '],
  ])('rejects a %s name with an issue on name', (_label, name) => {
    const r = parse({ name });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(['name']);
  });

  it('accepts a 1-character name and a name exactly at the limit', () => {
    expect(parse({ name: 'x' }).success).toBe(true);
    expect(parse({ name: 'a'.repeat(TASK_NAME_MAX) }).success).toBe(true);
  });

  it('rejects a name one over the limit', () => {
    expect(parse({ name: 'a'.repeat(TASK_NAME_MAX + 1) }).success).toBe(false);
  });

  it('checks the limit after trimming', () => {
    expect(parse({ name: ` ${'a'.repeat(TASK_NAME_MAX)} ` }).success).toBe(true);
  });

  it('accepts absent, empty and at-limit descriptions; rejects one over', () => {
    expect(parse({ name: 'n' }).success).toBe(true);
    expect(parse({ name: 'n', description: '' }).success).toBe(true);
    expect(parse({ name: 'n', description: 'd'.repeat(TASK_DESCRIPTION_MAX) }).success).toBe(true);
    expect(parse({ name: 'n', description: 'd'.repeat(TASK_DESCRIPTION_MAX + 1) }).success).toBe(false);
  });

  it('keeps emoji and multi-line text intact, counting UTF-16 code units', () => {
    const r = parse({ name: 'Call Mum 📞', description: 'line one\nline two' });
    expect(r.success && r.data).toMatchObject({ name: 'Call Mum 📞', description: 'line one\nline two' });
    // An emoji is 2 code units: 249 emoji + 2 letters = 500 fits; one more letter does not.
    expect(parse({ name: `${'📞'.repeat(249)}ab` }).success).toBe(true);
    expect(parse({ name: `${'📞'.repeat(249)}abc` }).success).toBe(false);
  });

  it.each(['ABC', ID.toUpperCase(), `${ID}0`, ID.slice(1), 'g'.repeat(32)])('rejects the malformed id %s', (id) => {
    expect(CreateTaskInputSchema.safeParse({ id, name: 'Buy milk' }).success).toBe(false);
  });

  it('strips unknown keys', () => {
    const r = parse({ name: 'Buy milk', foo: 'bar' });
    expect(r.success).toBe(true);
    expect(r.data).not.toHaveProperty('foo');
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
  it('rejects a bogus list', () => {
    expect(TaskListQuerySchema.safeParse({ list: 'bogus' }).success).toBe(false);
  });
});
