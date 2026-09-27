import type { LiveEvent } from '@todoodle/shared/events';

/** 16-byte hex ids and UUID client ids, like the real ones. */
export const WS_ID = '3f9a0c1d2e4b5a697887766554433221';
export const TASK_ID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
export const PROJECT_ID = '0f1e2d3c4b5a69788796a5b4c3d2e1f0';
export const CLIENT_A = '6c1f7a52-3d4e-4f8a-9b0c-1d2e3f4a5b6c';

export function workspaceEvent(overrides: Partial<Extract<LiveEvent, { type: 'workspace.updated' }>> = {}): LiveEvent {
  return {
    type: 'workspace.updated',
    entity: { id: WS_ID, name: 'Groceries 🛒', version: 3, createdAt: '2026-09-27 10:00:00' },
    version: 3,
    originClientId: CLIENT_A,
    ...overrides,
  } as LiveEvent;
}

/** One valid event of every type in the union. */
export function everyVariant(): LiveEvent[] {
  const common = { version: 2, originClientId: CLIENT_A };
  const task = { id: TASK_ID, version: 2, title: 'Buy milk' };
  const project = { id: PROJECT_ID, version: 2, name: 'Trip' };
  return [
    workspaceEvent(),
    { type: 'project.upserted', entity: project, ...common },
    { type: 'project.restored', entity: project, ...common },
    { type: 'project.deleted', entity: { id: PROJECT_ID }, ...common },
    { type: 'task.upserted', entity: task, ...common },
    { type: 'task.restored', entity: task, ...common },
    { type: 'task.deleted', entity: { id: TASK_ID }, ...common },
    { type: 'tasks.bulk', entity: { ids: [TASK_ID] }, version: 2, originClientId: null },
  ];
}
