import { env } from 'cloudflare:test';
import type { TaskRow } from '../../src/db/tasks.ts';
import { newTaskId } from '../fixtures/tasks.ts';
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

/** Story 6 states, set directly (their endpoints do not exist yet). */
export async function markCompleted(id: string) {
  await env.DB.prepare("UPDATE tasks SET completed_at = datetime('now') WHERE id = ?").bind(id).run();
}

export async function markDeleted(id: string) {
  await env.DB.prepare("UPDATE tasks SET deleted = 1, deleted_at = datetime('now') WHERE id = ?").bind(id).run();
}
