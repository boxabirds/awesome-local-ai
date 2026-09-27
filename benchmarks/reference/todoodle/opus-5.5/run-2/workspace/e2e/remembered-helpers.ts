import { type APIRequestContext, type BrowserContext, expect, type Page } from '@playwright/test';

export type Made = { id: string; secret: string; link: string; name: string };

const CLIENT = { 'X-Todoodle-Client': 'web' };

/**
 * Creates a workspace through the real API in this browser context (so its tdl_ws cookie gets
 * the entry) and gives it a recognisable name.
 */
export async function apiCreate(request: APIRequestContext, baseURL: string, name: string): Promise<Made> {
  const res = await request.post('/api/workspaces', { headers: { ...CLIENT, 'Content-Type': 'application/json' }, data: {} });
  expect(res.status()).toBe(201);
  const body = (await res.json()) as { workspace: { id: string }; secret: string };
  const renamed = await request.patch(`/api/w/${body.workspace.id}`, {
    headers: { ...CLIENT, 'Content-Type': 'application/json' },
    data: { name },
  });
  expect(renamed.status()).toBe(200);
  return { id: body.workspace.id, secret: body.secret, link: `${baseURL}/w#${body.secret}`, name };
}

/** The workspace names listed on Home, top to bottom (available rows only). */
export async function listedNames(page: Page): Promise<string[]> {
  const section = page.locator('section', { has: page.getByRole('heading', { name: 'Your workspaces on this browser' }) });
  await expect(section).toBeVisible();
  return section.locator('li[data-available="true"] a span.truncate').allTextContents();
}

export function rowLink(page: Page, name: string) {
  return page.getByRole('link', { name: new RegExp(`^${escape(name)}\\s*Opened`) });
}

function escape(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Opens a workspace from its Home row and waits for the server to record the visit (touch). */
export async function openFromHome(page: Page, name: string) {
  const touched = page.waitForResponse((r) => r.url().includes('/touch') && r.request().method() === 'POST');
  await rowLink(page, name).click();
  await expect(page.getByLabel('Workspace name')).toHaveValue(name);
  expect((await touched).status()).toBe(204);
}

export async function forgetFromHome(page: Page, name: string) {
  await page.getByRole('button', { name: `More actions for ${name}` }).click();
  await page.getByRole('menuitem', { name: 'Forget on this browser' }).click();
  return page.getByRole('alertdialog', { name: `Forget ${name} on this browser?` });
}

/** In webkit the clipboard is forced to refuse, so the manual-copy fallback is what gets tested. */
export async function prepareClipboard(context: BrowserContext, browserName: string) {
  if (browserName === 'chromium') {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  } else {
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: () => Promise.reject(new DOMException('denied', 'NotAllowedError')),
          write: () => Promise.reject(new DOMException('denied', 'NotAllowedError')),
        },
      });
    });
  }
}
