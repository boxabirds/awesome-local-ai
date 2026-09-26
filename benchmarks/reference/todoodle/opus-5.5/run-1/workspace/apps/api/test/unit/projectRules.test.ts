import { describe, expect, it } from 'vitest';
import { classifyMove } from '../../src/lib/moveRules.ts';
import { decideRestore } from '../../src/lib/restoreRules.ts';
import { newTaskId } from '../fixtures/tasks.ts';

// Story 7: the pure decisions behind restore (TC-73) and move (TC-74), extracted from their route handlers.

const B = newTaskId();
const OTHER = newTaskId();
const P = newTaskId();
const Q = newTaskId();

describe('TC-73 decideRestore', () => {
  it('an active project -> not_deleted, whatever the batch', () => {
    expect(decideRestore({ deleted: 0, delete_batch_id: null }, B)).toBe('not_deleted');
    expect(decideRestore({ deleted: 0, delete_batch_id: null }, '')).toBe('not_deleted');
  });

  it('a deleted project with the matching batch -> ok', () => {
    expect(decideRestore({ deleted: 1, delete_batch_id: B }, B)).toBe('ok');
  });

  it('a deleted project with another batch -> batch_mismatch', () => {
    expect(decideRestore({ deleted: 1, delete_batch_id: B }, OTHER)).toBe('batch_mismatch');
  });

  it('an empty batch id never matches (not even a project without one)', () => {
    expect(decideRestore({ deleted: 1, delete_batch_id: B }, '')).toBe('batch_mismatch');
    expect(decideRestore({ deleted: 1, delete_batch_id: null }, '')).toBe('batch_mismatch');
  });
});

describe('TC-74 classifyMove', () => {
  it('to the list it is already in -> same_list (Inbox to Inbox, P to P)', () => {
    expect(classifyMove(null, null, null)).toBe('same_list');
    expect(classifyMove(P, P, 'active')).toBe('same_list');
  });

  it('Inbox to an active project, a project to the Inbox, and between projects -> move', () => {
    expect(classifyMove(null, P, 'active')).toBe('move');
    expect(classifyMove(P, null, null)).toBe('move');
    expect(classifyMove(P, Q, 'active')).toBe('move');
  });

  it('a deleted, other-workspace or missing destination -> project_not_found', () => {
    expect(classifyMove(null, P, 'deleted')).toBe('project_not_found');
    // Another workspace's project is 'missing' here: lookups are scoped to the task's workspace.
    expect(classifyMove(null, P, 'missing')).toBe('project_not_found');
    expect(classifyMove(Q, P, 'missing')).toBe('project_not_found');
  });
});
