import { type APIRequestContext, type Browser, expect, type Page } from '@playwright/test';
import { CLIENT, markLinksSaved, newTaskId, openNewWorkspace, taskRows } from './inbox-helpers';

/** Story 6 constants (packages/shared/src/limits.ts). */
export const UNDO_WINDOW_MS = 10_000;
export const LIVE_UPDATE_TARGET_MS = 5_000;

export type Seeded = { id: string; name: string };

/** Seeds tasks through the real create endpoint, in order, and returns their ids. */
export async function seed(request: APIRequestContext, workspaceId: string, names: string[]): Promise<Seeded[]> {
  const out: Seeded[] = [];
  for (const name of names) {
    const id = newTaskId();
    const res = await request.post(`/api/w/${workspaceId}/tasks`, { headers: CLIENT, data: { id, name } });
    expect(res.status()).toBe(201);
    out.push({ id, name });
  }
  return out;
}

/** A new workspace with these tasks, open in the page. */
export async function workspaceWith(page: Page, names: string[]) {
  const ws = await openNewWorkspace(page);
  const tasks = await seed(page.request, ws.id, names);
  await page.reload();
  await expect(taskRows(page)).toHaveCount(names.length);
  return { ws, tasks };
}

export const row = (page: Page, name: string) => page.getByRole('listitem', { name, exact: true });
export const checkboxFor = (page: Page, name: string) => page.getByRole('checkbox', { name: new RegExp(`^(Complete|Reopen) ${escapeRe(name)}$`) });
export const sheet = (page: Page) => page.getByRole('dialog', { name: 'Task details' });
/** An undo toast on screen (not one sonner is animating out). */
export const undoToast = (page: Page, text: string) =>
  page.locator('[data-sonner-toast]:not([data-removed="true"]) [data-undo-toast]', { hasText: text });
export const showCompleted = (page: Page) => page.getByRole('switch', { name: 'Show completed' });

export function escapeRe(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The stored row exactly as in D1 (test route; deleted rows too). */
export async function rawTask(request: APIRequestContext, id: string) {
  const res = await request.get(`/test/tasks/${id}/raw`);
  expect(res.status()).toBe(200);
  return ((await res.json()) as { task: Record<string, unknown> }).task;
}

/** A second person on the same workspace (own context and cookie jar), opened by the link. */
export async function secondPerson(browser: Browser, secret: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await markLinksSaved(page);
  const socket = page.waitForEvent('websocket', (ws) => ws.url().endsWith('/live'));
  await page.goto(`/w#${secret}`);
  await socket;
  await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible();
  await page.waitForTimeout(300);
  return { context, page };
}

/**
 * The undo chord for the page's own platform: Cmd+Z where the page reports macOS/iOS, Ctrl+Z
 * elsewhere. (Playwright's ControlOrMeta follows the host OS, but device emulation can report
 * another platform to the page.)
 */
export async function undoChord(page: Page): Promise<string> {
  const mac = await page.evaluate(() => {
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
    return /mac|iphone|ipad|ipod/i.test(nav.userAgentData?.platform ?? nav.platform ?? '');
  });
  return mac ? 'Meta+z' : 'Control+z';
}
