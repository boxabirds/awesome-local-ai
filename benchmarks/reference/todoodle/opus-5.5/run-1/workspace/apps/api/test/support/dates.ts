import { env } from 'cloudflare:test';
import type { TaskRow } from '../../src/db/tasks.ts';
import { newTaskId } from '../fixtures/tasks.ts';
import { JSON_CLIENT, type Browser } from './workspaces.ts';
import { member } from './tasks.ts';

// Story 8 fixtures: dated tasks through the real create endpoint (the quick-add path, client-generated ids).

export { member };

/** POST a task with a due date (and optionally a project); returns its id (fails on anything but 201). */
export async function createDated(
  browser: Browser,
  workspaceId: string,
  name: string,
  dueDate: string | null,
  projectId?: string,
): Promise<string> {
  const id = newTaskId();
  const res = await browser.fetch(`/api/w/${workspaceId}/tasks`, {
    method: 'POST',
    headers: JSON_CLIENT,
    body: JSON.stringify({ id, name, dueDate, ...(projectId ? { projectId } : {}) }),
  });
  if (res.status !== 201) throw new Error(`create failed with ${res.status}`);
  return id;
}

export function getToday(browser: Browser, workspaceId: string, query: string) {
  return browser.fetch(`/api/w/${workspaceId}/today${query}`);
}

export function getCountsWith(browser: Browser, workspaceId: string, query = '') {
  return browser.fetch(`/api/w/${workspaceId}/counts${query}`);
}

export function reschedule(browser: Browser, workspaceId: string, body: unknown) {
  return browser.fetch(`/api/w/${workspaceId}/tasks/reschedule`, { method: 'POST', headers: JSON_CLIENT, body: JSON.stringify(body) });
}

export function restoreDueDates(browser: Browser, workspaceId: string, body: unknown) {
  return browser.fetch(`/api/w/${workspaceId}/tasks/due-dates/restore`, { method: 'POST', headers: JSON_CLIENT, body: JSON.stringify(body) });
}

/** The stored rows of these ids, by id (state before/after checks). */
export async function rowsById(ids: string[]): Promise<Map<string, TaskRow>> {
  const { results } = await env.DB.prepare(`SELECT * FROM tasks WHERE id IN (SELECT value FROM json_each(?))`)
    .bind(JSON.stringify(ids))
    .all<TaskRow>();
  return new Map(results.map((row) => [row.id, row]));
}

/** id -> [due_date, version] for compact before/after assertions. */
export async function dueState(ids: string[]): Promise<Record<string, [string | null, number, number]>> {
  const rows = await rowsById(ids);
  return Object.fromEntries(ids.map((id) => [id, [rows.get(id)?.due_date ?? null, rows.get(id)?.version ?? -1, rows.get(id)?.deleted ?? -1]]));
}
