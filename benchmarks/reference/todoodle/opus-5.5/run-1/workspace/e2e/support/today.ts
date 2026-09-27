import { type Page, expect } from '@playwright/test';

// Story 8 e2e helpers. Seeding goes through the real API with the page's own cookie jar (as the SPA would), or
// /test/seed (the same db modules) for large fixtures.

const JSON_CLIENT = { 'X-Todoodle-Client': 'web', 'Content-Type': 'application/json' };

export function newId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** POST a task with a due date (and optionally a project); returns its id. */
export async function seedDated(page: Page, workspaceId: string, name: string, dueDate: string | null, projectId: string | null = null): Promise<string> {
  const id = newId();
  const res = await page.request.post(`/api/w/${workspaceId}/tasks`, { headers: JSON_CLIENT, data: { id, name, dueDate, projectId } });
  expect(res.status()).toBe(201);
  return id;
}

export type SeedTask = { id?: string; name: string; description?: string; projectId?: string | null; dueDate?: string | null; completedAt?: string; deleted?: boolean };
export type SeedProject = { id: string; name: string; color: string; deleted?: boolean };

/** POST /test/seed (non-production only): many projects and tasks in a few batches. */
export async function seedBulk(page: Page, workspaceId: string, body: { projects?: SeedProject[]; tasks: SeedTask[] }): Promise<void> {
  const res = await page.request.post('/test/seed', {
    headers: JSON_CLIENT,
    data: { workspaceId, projects: body.projects ?? [], tasks: body.tasks.map((task) => ({ id: newId(), ...task })) },
    timeout: 120_000,
  });
  expect(res.status()).toBe(201);
}

export async function patchDueDate(page: Page, workspaceId: string, taskId: string, dueDate: string | null): Promise<void> {
  const res = await page.request.patch(`/api/w/${workspaceId}/tasks/${taskId}`, { headers: JSON_CLIENT, data: { dueDate } });
  expect(res.status()).toBe(200);
}

/** The stored due date of a task (GET /test/tasks/:id/raw). */
export async function storedDueDate(page: Page, taskId: string): Promise<string | null> {
  const res = await page.request.get(`/test/tasks/${taskId}/raw`);
  expect(res.status()).toBe(200);
  return ((await res.json()) as { task: { due_date: string | null } }).task.due_date;
}

export function todayPath(workspaceId: string): string {
  return `/w/${workspaceId}/today`;
}

/** The sidebar's Today entry (a link; its accessible name carries the count). */
export function sidebarToday(page: Page) {
  return page.getByRole('navigation', { name: 'Lists' }).getByRole('link', { name: /^Today/ });
}

export function overdueList(page: Page) {
  return page.getByRole('listbox', { name: 'Overdue tasks' });
}

export function todayList(page: Page) {
  return page.getByRole('listbox', { name: 'Tasks due today' });
}

/** A row by its task name. */
export function rowNamed(page: Page, name: string) {
  return page.getByRole('option', { name });
}
