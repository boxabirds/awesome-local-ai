import { env } from 'cloudflare:test';
import type { TaskRow } from '../../src/db/tasks.ts';
import { MULTI_LINE_DESCRIPTION, NAME_AT_LIMIT, newTaskId } from '../fixtures/tasks.ts';
import { CLIENT } from './http.ts';
import { Browser, JSON_CLIENT } from './workspaces.ts';

/** A browser with its own freshly created workspace. */
export async function member() {
  const browser = new Browser();
  const { workspace } = await browser.create();
  return { browser, id: workspace.id };
}

export function postTask(browser: Browser, workspaceId: string, body: unknown, headers: Record<string, string> = JSON_CLIENT) {
  return browser.fetch(`/api/w/${workspaceId}/tasks`, {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

/** Creates a task through the API and returns its id (fails the test on anything but 201). */
export async function createTask(browser: Browser, workspaceId: string, name: string, description?: string): Promise<string> {
  const id = newTaskId();
  const res = await postTask(browser, workspaceId, { id, name, description });
  if (res.status !== 201) throw new Error(`create failed with ${res.status}`);
  return id;
}

export function listTasks(browser: Browser, workspaceId: string, query = '?list=inbox') {
  return browser.fetch(`/api/w/${workspaceId}/tasks${query}`);
}

export function getCounts(browser: Browser, workspaceId: string) {
  return browser.fetch(`/api/w/${workspaceId}/counts`);
}

export async function taskRows(workspaceId?: string): Promise<TaskRow[]> {
  const stmt = workspaceId
    ? env.DB.prepare('SELECT * FROM tasks WHERE workspace_id = ? ORDER BY sort_order').bind(workspaceId)
    : env.DB.prepare('SELECT * FROM tasks ORDER BY sort_order');
  return (await stmt.all<TaskRow>()).results;
}

export async function taskRow(id: string): Promise<TaskRow | null> {
  return env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first<TaskRow>();
}

/** Story 6 states, set directly in D1 (fixtures; the endpoints are tested separately). */
export async function markCompleted(id: string) {
  await env.DB.prepare("UPDATE tasks SET completed_at = datetime('now') WHERE id = ?").bind(id).run();
}

export async function markDeleted(id: string) {
  await env.DB.prepare("UPDATE tasks SET deleted = 1, deleted_at = datetime('now') WHERE id = ?").bind(id).run();
}

// ---------------------------------------------------------------- story 6

export type LifecycleOp = 'complete' | 'reopen' | 'restore';

/** Bodyless POST complete/reopen/restore with only the client header (as the web app sends them). */
export function lifecycle(browser: Browser, workspaceId: string, taskId: string, op: LifecycleOp, headers: Record<string, string> = CLIENT) {
  return browser.fetch(`/api/w/${workspaceId}/tasks/${taskId}/${op}`, { method: 'POST', headers });
}

export function deleteTask(browser: Browser, workspaceId: string, taskId: string, headers: Record<string, string> = CLIENT) {
  return browser.fetch(`/api/w/${workspaceId}/tasks/${taskId}`, { method: 'DELETE', headers });
}

export function patchTask(browser: Browser, workspaceId: string, taskId: string, body: unknown, headers: Record<string, string> = JSON_CLIENT) {
  return browser.fetch(`/api/w/${workspaceId}/tasks/${taskId}`, {
    method: 'PATCH',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

/** Every mutating operation on one task, for access checks. */
export const ALL_OPERATIONS: Array<{ label: string; run: (b: Browser, ws: string, id: string) => Promise<Response> }> = [
  { label: 'complete', run: (b, ws, id) => lifecycle(b, ws, id, 'complete') },
  { label: 'reopen', run: (b, ws, id) => lifecycle(b, ws, id, 'reopen') },
  { label: 'edit', run: (b, ws, id) => patchTask(b, ws, id, { name: 'Hijacked' }) },
  { label: 'delete', run: (b, ws, id) => deleteTask(b, ws, id) },
  { label: 'restore', run: (b, ws, id) => lifecycle(b, ws, id, 'restore') },
];

/** The four persisted states of design Matrix A, set up from an open task created through the API. */
export type PriorState = 'Open' | 'Completed' | 'DeletedOpen' | 'DeletedCompleted';

export async function taskInState(browser: Browser, workspaceId: string, state: PriorState, name = 'Book dentist — ask about Tuesday') {
  const id = await createTask(browser, workspaceId, name, 'Ask about:\n- the Tuesday slot');
  if (state === 'Completed' || state === 'DeletedCompleted') {
    await env.DB.prepare('UPDATE tasks SET completed_at = ? WHERE id = ?').bind('2026-09-24T08:15:00.000Z', id).run();
  }
  if (state === 'DeletedOpen' || state === 'DeletedCompleted') {
    await env.DB.prepare('UPDATE tasks SET deleted = 1, deleted_at = ? WHERE id = ?').bind('2026-09-25T09:00:00.000Z', id).run();
  }
  return id;
}

/**
 * The design's realistic workspace: 12 tasks through the quick-add insert path (real sort_order), one name at
 * exactly TASK_NAME_MAX, an emoji and an RTL name, multi-line descriptions, 3 completed with distinct
 * completed_at, 2 soft-deleted (one per deleted state); plus a second workspace with 3 tasks.
 */
export async function seedRealisticWorkspaces() {
  const a = await member();
  const b = await member();
  const names = [
    'Buy milk',
    'Email Sam re: invoice #4411',
    'Call Mum 📞',
    'Book dentist — ask about Tuesday',
    'שלום — call the landlord',
    NAME_AT_LIMIT,
    'Water the plants',
    'Renew passport',
    'Pay council tax',
    'Fix the bike light',
    'Plan Sunday lunch 🍲',
    'Return library books',
  ];
  const ids: string[] = [];
  for (const [index, name] of names.entries()) {
    ids.push(await createTask(a.browser, a.id, name, index % 3 === 0 ? MULTI_LINE_DESCRIPTION : ''));
  }
  const completedAt = ['2026-09-20T08:00:00.000Z', '2026-09-24T17:30:00.000Z', '2026-09-22T12:00:00.000Z'];
  const completed = [ids[1]!, ids[6]!, ids[9]!];
  for (const [index, id] of completed.entries()) {
    await env.DB.prepare('UPDATE tasks SET completed_at = ? WHERE id = ?').bind(completedAt[index], id).run();
  }
  const deletedOpen = ids[3]!;
  const deletedCompleted = ids[10]!;
  await env.DB.prepare('UPDATE tasks SET completed_at = ? WHERE id = ?').bind('2026-09-23T10:00:00.000Z', deletedCompleted).run();
  for (const id of [deletedOpen, deletedCompleted]) {
    await env.DB.prepare('UPDATE tasks SET deleted = 1, deleted_at = ? WHERE id = ?').bind('2026-09-25T09:00:00.000Z', id).run();
  }
  for (const name of ['Elsewhere 1', 'Elsewhere 2', 'Elsewhere 3']) await createTask(b.browser, b.id, name);
  return { a, b, ids, completed, deletedOpen, deletedCompleted };
}
