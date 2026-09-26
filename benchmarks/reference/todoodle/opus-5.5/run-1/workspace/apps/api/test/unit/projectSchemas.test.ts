import { PROJECT_COLORS, PROJECT_NAME_MAX } from '@todoodle/shared/limits';
import {
  CountsSchema,
  CreateProjectInputSchema,
  ListTasksQuerySchema,
  RestoreProjectInputSchema,
  TaskPatchSchema,
  UpdateProjectInputSchema,
} from '@todoodle/shared/schemas';
import { describe, expect, it } from 'vitest';
import { newTaskId } from '../fixtures/tasks.ts';

// Story 7, TC-48: the project schemas accept exactly the valid classes (design equivalence classes).

const ID = newTaskId();
const COLOR = PROJECT_COLORS[0].key;
const nameOf = (length: number) => 'n'.repeat(length);

describe('TC-48 CreateProjectInputSchema', () => {
  it.each([
    ['1 character', nameOf(1)],
    ['PROJECT_NAME_MAX characters', nameOf(PROJECT_NAME_MAX)],
    ['unicode and emoji', 'Café ☕ plans'],
  ])('accepts a name of %s', (_label, name) => {
    expect(CreateProjectInputSchema.safeParse({ id: ID, name, color: COLOR }).success).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['whitespace only', '   \t '],
    ['PROJECT_NAME_MAX + 1 characters', nameOf(PROJECT_NAME_MAX + 1)],
  ])('rejects a name that is %s', (_label, name) => {
    expect(CreateProjectInputSchema.safeParse({ id: ID, name, color: COLOR }).success).toBe(false);
  });

  it('trims a padded name, and measures the limit after trimming', () => {
    expect(CreateProjectInputSchema.parse({ id: ID, name: '  Work  ', color: COLOR }).name).toBe('Work');
    expect(CreateProjectInputSchema.safeParse({ id: ID, name: `  ${nameOf(PROJECT_NAME_MAX)}  `, color: COLOR }).success).toBe(true);
  });

  it('counts UTF-16 code units, like the client counter (an emoji is 2)', () => {
    const emoji = '📞';
    expect(emoji.length).toBe(2);
    expect(CreateProjectInputSchema.safeParse({ id: ID, name: emoji.repeat(PROJECT_NAME_MAX / 2), color: COLOR }).success).toBe(true);
    expect(CreateProjectInputSchema.safeParse({ id: ID, name: `${emoji.repeat(PROJECT_NAME_MAX / 2)}x`, color: COLOR }).success).toBe(false);
  });

  it('accepts every palette key and nothing else (hex values, unknown keys, missing)', () => {
    for (const { key } of PROJECT_COLORS) expect(CreateProjectInputSchema.safeParse({ id: ID, name: 'Work', color: key }).success).toBe(true);
    for (const color of ['#ff0000', PROJECT_COLORS[0].light, 'RED', 'berry', '', undefined]) {
      expect(CreateProjectInputSchema.safeParse({ id: ID, name: 'Work', color }).success).toBe(false);
    }
  });

  it.each(['xyz', ID.toUpperCase(), ID.slice(1), `${ID}0`, ''])('rejects the malformed id %j', (id) => {
    expect(CreateProjectInputSchema.safeParse({ id, name: 'Work', color: COLOR }).success).toBe(false);
  });
});

describe('TC-48 UpdateProjectInputSchema', () => {
  it('accepts a name only, a colour only, or both', () => {
    expect(UpdateProjectInputSchema.safeParse({ name: 'Job' }).success).toBe(true);
    expect(UpdateProjectInputSchema.safeParse({ color: COLOR }).success).toBe(true);
    expect(UpdateProjectInputSchema.parse({ name: ' Job ', color: COLOR })).toEqual({ name: 'Job', color: COLOR });
  });

  it('requires at least one field, and rejects unknown ones and blank or over-long names', () => {
    for (const body of [{}, { name: '' }, { name: '   ' }, { name: nameOf(PROJECT_NAME_MAX + 1) }, { name: 'Job', deleted: 1 }, { color: '#fff' }]) {
      expect(UpdateProjectInputSchema.safeParse(body).success).toBe(false);
    }
  });
});

describe('RestoreProjectInputSchema and the widened task contracts', () => {
  it('a batch id is 32 lowercase hex characters', () => {
    expect(RestoreProjectInputSchema.safeParse({ batchId: ID }).success).toBe(true);
    for (const batchId of ['', 'abc', ID.toUpperCase(), undefined]) expect(RestoreProjectInputSchema.safeParse({ batchId }).success).toBe(false);
  });

  it('list=project needs a well-formed projectId; the Inbox is still the default', () => {
    expect(ListTasksQuerySchema.safeParse({ list: 'project', projectId: ID }).success).toBe(true);
    expect(ListTasksQuerySchema.safeParse({ list: 'project' }).success).toBe(false);
    expect(ListTasksQuerySchema.safeParse({ list: 'project', projectId: 'xyz' }).success).toBe(false);
    expect(ListTasksQuerySchema.parse({}).list).toBe('inbox');
  });

  it('a task PATCH may carry projectId (a project id, or null for the Inbox) and nothing unknown', () => {
    expect(TaskPatchSchema.safeParse({ projectId: ID }).success).toBe(true);
    expect(TaskPatchSchema.safeParse({ projectId: null }).success).toBe(true);
    expect(TaskPatchSchema.safeParse({ projectId: 'xyz' }).success).toBe(false);
    expect(TaskPatchSchema.safeParse({ projectId: ID, completedAt: null }).success).toBe(false);
  });

  it('counts default projects to {} for pre-story-7 payloads', () => {
    expect(CountsSchema.parse({ inbox: 2 })).toEqual({ inbox: 2, projects: {} });
    expect(CountsSchema.safeParse({ inbox: 0, projects: { [ID]: { open: -1, total: 0 } } }).success).toBe(false);
  });
});
