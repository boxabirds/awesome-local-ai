import { type Browser, type BrowserContext, type Page, expect } from '@playwright/test';
import { nameField } from './workspace.ts';

export const OFFLINE_TEXT = "You're offline — changes can't be saved right now";
export const RECONNECTING_TEXT = 'Reconnecting…';
export const CONFLICT_TEXT = 'Someone else changed this just now.';
export const ACCESS_STATEMENT =
  "This link is the key to this workspace — for you and anyone you send it to. Anyone with it can see and change everything. Access can't be removed yet.";

/**
 * Resolves once this page's live socket is really live: the client pings as soon as it opens, and the
 * pong (answered by the WorkspaceRoom) proves the whole path. Call before navigating.
 */
export function waitForLive(page: Page): Promise<void> {
  return new Promise((resolve) => {
    page.on('websocket', (ws) => {
      if (!new URL(ws.url()).pathname.endsWith('/live')) return;
      ws.on('framereceived', (frame) => {
        if (frame.payload === 'pong') resolve();
      });
    });
  });
}

/** A fresh browser (own cookie jar) that opens the shared link and waits until its live socket is up. */
export async function join(browser: Browser, link: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  const live = waitForLive(page);
  await page.goto(link);
  await expect(nameField(page)).toBeVisible();
  await live;
  return { context, page };
}

/** Commits a rename through the name field and waits for the save. */
export async function rename(page: Page, name: string): Promise<void> {
  const saved = page.waitForResponse((res) => res.request().method() === 'PATCH' && res.ok());
  await nameField(page).fill(name);
  await nameField(page).press('Enter');
  await saved;
}

export function announcer(page: Page) {
  return page.getByRole('status', { name: 'Changes by others' });
}
