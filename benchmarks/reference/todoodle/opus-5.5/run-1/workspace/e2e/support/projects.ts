import { type Page, expect } from '@playwright/test';
import { PROJECT_COLORS } from '../../packages/shared/src/limits.ts';

// Story 7 e2e helpers. Seeding goes through the real API with the page's own cookie jar (as the SPA would).

function newId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
}

const JSON_CLIENT = { 'X-Todoodle-Client': 'web', 'Content-Type': 'application/json' };

/** POST /api/w/:id/projects; returns the new project's id. */
export async function seedProject(page: Page, workspaceId: string, name: string, color: string = PROJECT_COLORS[0].key): Promise<string> {
  const id = newId();
  const res = await page.request.post(`/api/w/${workspaceId}/projects`, { headers: JSON_CLIENT, data: { id, name, color } });
  expect(res.status()).toBe(201);
  return id;
}

/** Creates tasks in a project (or the Inbox, null) through the quick-add endpoint; returns their ids in order. */
export async function seedTasksIn(page: Page, workspaceId: string, projectId: string | null, names: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const name of names) {
    const id = newId();
    const res = await page.request.post(`/api/w/${workspaceId}/tasks`, { headers: JSON_CLIENT, data: { id, name, projectId } });
    expect(res.status()).toBe(201);
    ids.push(id);
  }
  return ids;
}

export async function completeTask(page: Page, workspaceId: string, taskId: string): Promise<void> {
  const res = await page.request.post(`/api/w/${workspaceId}/tasks/${taskId}/complete`, { headers: { 'X-Todoodle-Client': 'web' } });
  expect(res.status()).toBe(200);
}

export async function deleteTaskApi(page: Page, workspaceId: string, taskId: string): Promise<void> {
  const res = await page.request.delete(`/api/w/${workspaceId}/tasks/${taskId}`, { headers: { 'X-Todoodle-Client': 'web' } });
  expect(res.status()).toBe(204);
}

export function projectPath(workspaceId: string, projectId: string): string {
  return `/w/${workspaceId}/project/${projectId}`;
}

/** The sidebar navigation (inline, or inside the phone drawer). */
export function lists(page: Page) {
  return page.getByRole('navigation', { name: 'Lists' });
}

/** A project's sidebar entry (its accessible name may carry the open count). */
export function projectEntry(page: Page, name: string) {
  return lists(page).getByRole('button', { name: new RegExp(`^${name}(, \\d+ open tasks?)?$`) });
}

export function projectMenuButton(page: Page, name: string) {
  return lists(page).getByRole('button', { name: `More actions for ${name}` });
}

/** The project names in the sidebar, in order. */
export async function sidebarProjects(page: Page): Promise<string[]> {
  return lists(page).locator('[data-project-link]').evaluateAll((els) => els.map((el) => el.getAttribute('title') ?? ''));
}
