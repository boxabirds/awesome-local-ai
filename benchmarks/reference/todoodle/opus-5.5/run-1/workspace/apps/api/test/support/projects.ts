import { env } from 'cloudflare:test';
import { PROJECT_COLORS } from '@todoodle/shared/limits';
import type { ProjectRow } from '../../src/db/projects.ts';
import { newTaskId } from '../fixtures/tasks.ts';
import { CLIENT } from './http.ts';
import { postTask } from './tasks.ts';
import { type Browser, JSON_CLIENT } from './workspaces.ts';

// Story 7 helpers: projects through the real API, plus direct-SQL fixtures for states the API reaches slowly.

export const FIRST_COLOR = PROJECT_COLORS[0].key;
export const SECOND_COLOR = PROJECT_COLORS[1].key;

/** A fresh client-style project id: 16 random bytes as lowercase hex (the same format as task ids). */
export const newProjectId = newTaskId;

export function postProject(browser: Browser, workspaceId: string, body: unknown, headers: Record<string, string> = JSON_CLIENT) {
  return browser.fetch(`/api/w/${workspaceId}/projects`, {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

/** Creates a project through the API and returns its id (fails the test on anything but 201). */
export async function createProject(browser: Browser, workspaceId: string, name: string, color: string = FIRST_COLOR): Promise<string> {
  const id = newProjectId();
  const res = await postProject(browser, workspaceId, { id, name, color });
  if (res.status !== 201) throw new Error(`project create failed with ${res.status}`);
  return id;
}

export function listProjects(browser: Browser, workspaceId: string) {
  return browser.fetch(`/api/w/${workspaceId}/projects`);
}

export function patchProject(browser: Browser, workspaceId: string, projectId: string, body: unknown) {
  return browser.fetch(`/api/w/${workspaceId}/projects/${projectId}`, { method: 'PATCH', headers: JSON_CLIENT, body: JSON.stringify(body) });
}

export function deleteProject(browser: Browser, workspaceId: string, projectId: string, headers: Record<string, string> = CLIENT) {
  return browser.fetch(`/api/w/${workspaceId}/projects/${projectId}`, { method: 'DELETE', headers });
}

export function restoreProject(browser: Browser, workspaceId: string, projectId: string, batchId: string, headers: Record<string, string> = JSON_CLIENT) {
  return browser.fetch(`/api/w/${workspaceId}/projects/${projectId}/restore`, { method: 'POST', headers, body: JSON.stringify({ batchId }) });
}

/** Creates a task in a project (quick add in a project view) and returns its id. */
export async function createTaskIn(browser: Browser, workspaceId: string, projectId: string | null, name: string): Promise<string> {
  const id = newTaskId();
  const res = await postTask(browser, workspaceId, { id, name, projectId });
  if (res.status !== 201) throw new Error(`task create failed with ${res.status}`);
  return id;
}

export async function projectRow(id: string): Promise<ProjectRow | null> {
  return env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first<ProjectRow>();
}

export async function projectRows(workspaceId: string): Promise<ProjectRow[]> {
  return (await env.DB.prepare('SELECT * FROM projects WHERE workspace_id = ? ORDER BY sort_order').bind(workspaceId).all<ProjectRow>()).results;
}

export async function activeProjectCount(workspaceId: string): Promise<number> {
  return (await env.DB.prepare('SELECT COUNT(*) AS n FROM projects WHERE workspace_id = ? AND deleted = 0').bind(workspaceId).first<{ n: number }>())?.n ?? 0;
}

/**
 * Seeds `count` projects in one batch INSERT (the design's 300-project fixture, not a mocked count). Ids are
 * generated hex, so building the VALUES list inline is safe. Returns their ids in sort order.
 */
export async function seedProjects(workspaceId: string, count: number, options: { deleted?: number } = {}): Promise<string[]> {
  const ids = Array.from({ length: count }, () => newProjectId());
  const deleted = new Set(ids.slice(0, options.deleted ?? 0));
  const values = ids.map(
    (id, index) =>
      `('${id}', '${workspaceId}', 'Project ${index + 1}', '${PROJECT_COLORS[index % PROJECT_COLORS.length]!.key}', ${index + 1}, ${deleted.has(id) ? 1 : 0})`,
  );
  await env.DB.prepare(`INSERT INTO projects (id, workspace_id, name, color, sort_order, deleted) VALUES ${values.join(', ')}`).run();
  return ids;
}

export async function markCompletedAt(taskId: string, completedAt: string) {
  await env.DB.prepare('UPDATE tasks SET completed_at = ? WHERE id = ?').bind(completedAt, taskId).run();
}

/** A task deleted on its own (story 6 delete: no batch). */
export async function markDeletedAlone(taskId: string, deletedAt = '2026-09-25T09:00:00.000Z') {
  await env.DB.prepare('UPDATE tasks SET deleted = 1, deleted_at = ? WHERE id = ?').bind(deletedAt, taskId).run();
}
