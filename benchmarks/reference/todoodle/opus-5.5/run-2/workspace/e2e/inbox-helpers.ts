import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { type APIRequestContext, expect, type Page } from '@playwright/test';

const require = createRequire(import.meta.url);
const AXE_SOURCE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

export const CLIENT = { 'X-Todoodle-Client': 'web', 'Content-Type': 'application/json' };
export const EMPTY_TEXT = 'Your Inbox is clear. Press Q to add a task.';

export type Opened = { id: string; secret: string };

/** No first-run "save your link" nags in these flows: the link counts as saved. */
export async function markLinksSaved(page: Page) {
  await page.addInitScript(() => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = function getItem(key: string) {
      if (key.startsWith('tdl:v1:linkSaved:')) return '1';
      return original.call(this, key);
    };
  });
}

/** Creates a workspace through the real API (this context's cookie) and opens it by its link. */
export async function openNewWorkspace(page: Page): Promise<Opened> {
  await markLinksSaved(page);
  const res = await page.request.post('/api/workspaces', { headers: CLIENT, data: {} });
  expect(res.status()).toBe(201);
  const body = (await res.json()) as { workspace: { id: string }; secret: string };
  await page.goto(`/w#${body.secret}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible();
  return { id: body.workspace.id, secret: body.secret };
}

export function newTaskId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Seeds tasks through the real create endpoint, in order. */
export async function seedTasks(request: APIRequestContext, workspaceId: string, names: string[]) {
  for (const name of names) {
    const res = await request.post(`/api/w/${workspaceId}/tasks`, { headers: CLIENT, data: { id: newTaskId(), name } });
    expect(res.status()).toBe(201);
  }
}

/** The stored open tasks (real GET). */
export async function storedTasks(request: APIRequestContext, workspaceId: string): Promise<Array<{ id: string; name: string }>> {
  const res = await request.get(`/api/w/${workspaceId}/tasks?list=inbox`);
  expect(res.status()).toBe(200);
  return ((await res.json()) as { tasks: Array<{ id: string; name: string }> }).tasks;
}

export const nameField = (page: Page) => page.getByRole('textbox', { name: 'Task name' });
export const quickAddForm = (page: Page) => page.getByRole('form', { name: 'Add task' });
export const taskRows = (page: Page) => page.getByRole('listbox', { name: 'Tasks' }).getByRole('option');
/** The visible length counter in quick add (the live region repeats its text for screen readers). */
export const counter = (page: Page, text: string) => quickAddForm(page).locator('p[id]', { hasText: text });

/** Visible task names, top to bottom. */
export async function rowNames(page: Page): Promise<string[]> {
  return taskRows(page).locator('span.break-words').allTextContents();
}

type AxeResult = { violations: Array<{ id: string; impact: string | null; nodes: Array<{ target: string[] }> }> };

/** axe-core in the page. `only` limits it to the given rules; `include` scopes it to a selector. */
export async function runAxe(page: Page, opts: { only?: string[]; include?: string } = {}): Promise<AxeResult['violations']> {
  // Evaluated (not a script tag): the app's CSP rightly refuses inline scripts.
  await page.evaluate(AXE_SOURCE);
  return page.evaluate(async ({ only, include }) => {
    const axe = (window as unknown as { axe: { run(ctx: unknown, options: unknown): Promise<AxeResult> } }).axe;
    const options = only ? { runOnly: { type: 'rule', values: only } } : {};
    const result = await axe.run(include ? { include: [include] } : document, options);
    return result.violations;
  }, opts);
}

export function seriousOrCritical(violations: AxeResult['violations']): string[] {
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}
