import { env, SELF } from 'cloudflare:test';
import type { Task } from '@todoodle/shared/schemas';
import type { TaskRow } from '../src/db/tasks';
import { CLIENT_HEADERS, ORIGIN } from './helpers';
import { newTaskId } from './fixtures/tasks';
import { post } from './workspace-helpers';

/** POST /api/w/:id/tasks with a JSON body (id generated unless given). */
export function createTask(
  workspaceId: string,
  cookie: string | null,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
) {
  return post(`/api/w/${workspaceId}/tasks`, { cookie, body: { id: newTaskId(), ...body }, headers });
}

/** Creates a task and returns it; throws unless the answer is 201. */
export async function createdTask(workspaceId: string, cookie: string, body: Record<string, unknown>): Promise<Task> {
  const res = await createTask(workspaceId, cookie, body);
  if (res.status !== 201) throw new Error(`create task failed: ${res.status}`);
  return ((await res.json()) as { task: Task }).task;
}

export function listTasks(workspaceId: string, cookie: string | null, query = '?list=inbox') {
  return SELF.fetch(`${ORIGIN}/api/w/${workspaceId}/tasks${query}`, { headers: cookie ? { Cookie: cookie } : {} });
}

export function getCounts(workspaceId: string, cookie: string | null) {
  return SELF.fetch(`${ORIGIN}/api/w/${workspaceId}/counts`, { headers: cookie ? { Cookie: cookie } : {} });
}

/** A text/plain POST carrying the CSRF header (the story 1 media-type rule). */
export function createTaskAsText(workspaceId: string, cookie: string, body: Record<string, unknown>) {
  return SELF.fetch(`${ORIGIN}/api/w/${workspaceId}/tasks`, {
    method: 'POST',
    headers: { ...CLIENT_HEADERS, 'Content-Type': 'text/plain', Cookie: cookie },
    body: JSON.stringify(body),
  });
}

export async function taskRows(workspaceId?: string): Promise<TaskRow[]> {
  const stmt = workspaceId
    ? env.DB.prepare('SELECT * FROM tasks WHERE workspace_id = ? ORDER BY sort_order').bind(workspaceId)
    : env.DB.prepare('SELECT * FROM tasks ORDER BY sort_order');
  return (await stmt.all<TaskRow>()).results;
}

export async function countTaskRows(workspaceId?: string): Promise<number> {
  return (await taskRows(workspaceId)).length;
}

/** Story 6 states (no endpoints yet): set directly. */
export async function markCompleted(id: string) {
  await env.DB.prepare("UPDATE tasks SET completed_at = datetime('now') WHERE id = ?").bind(id).run();
}
export async function markDeleted(id: string) {
  await env.DB.prepare("UPDATE tasks SET deleted = 1, deleted_at = datetime('now') WHERE id = ?").bind(id).run();
}
