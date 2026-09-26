import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { type Page, expect } from '@playwright/test';
import { createWorkspace } from './workspace.ts';

const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

/** A new workspace from the real home page, with the 'Save your link' panel skipped. Lands on its Inbox. */
export async function newInbox(page: Page): Promise<{ id: string; link: string }> {
  const { id, link } = await createWorkspace(page);
  await page.getByRole('dialog').getByRole('button', { name: 'Skip for now' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Inbox', level: 1 })).toBeVisible();
  // The panel hands focus back to Share when it closes; wait for it, so later keys are not raced.
  await expect(page.getByRole('button', { name: 'Share' })).toBeFocused();
  return { id, link };
}

export function nameInput(page: Page) {
  return page.getByRole('textbox', { name: 'Task name' });
}

export function descriptionInput(page: Page) {
  return page.getByRole('textbox', { name: 'Description' });
}

export function quickAdd(page: Page) {
  return page.getByRole('form', { name: 'Add task' });
}

export function taskRows(page: Page) {
  return page.getByRole('option');
}

/** The sidebar's Inbox entry (its accessible name carries the open-task count). */
export function sidebarInbox(page: Page) {
  return page.getByRole('navigation', { name: 'Lists' }).getByRole('button', { name: /^Inbox/ });
}

export async function expectRowNames(page: Page, names: string[]) {
  await expect(taskRows(page).locator('p:first-of-type')).toHaveText(names);
}

function newTaskId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** POST /api/w/:id/tasks with the page's own cookie jar, as the SPA would (no UI). */
export function postTask(page: Page, workspaceId: string, name: string, description = '') {
  return page.request.post(`/api/w/${workspaceId}/tasks`, {
    headers: { 'X-Todoodle-Client': 'web', 'Content-Type': 'application/json' },
    data: { id: newTaskId(), name, description },
  });
}

/** Runs axe in the page (evaluated directly, so the CSP never sees an injected script). */
export async function axeViolations(page: Page, options: Record<string, unknown> = {}): Promise<string[]> {
  await page.evaluate(axeSource);
  return page.evaluate(async (opts) => {
    const axe = (window as unknown as { axe: { run: (ctx: Document, o: unknown) => Promise<{ violations: Array<{ id: string; impact: string; nodes: Array<{ target: string[] }> }> }> } }).axe;
    const { violations } = await axe.run(document, opts);
    return violations.map((v) => `${v.impact} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
  }, options);
}

/** Only serious and critical axe violations count as failures. */
export async function seriousAxeViolations(page: Page): Promise<string[]> {
  return (await axeViolations(page)).filter((v) => v.startsWith('serious') || v.startsWith('critical'));
}
