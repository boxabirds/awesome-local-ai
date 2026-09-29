// Story 5 helpers: sharing a link between REAL, separate browser contexts.
//
// A share test needs two things a single-page test cannot fake: a second
// visitor with its own storage/sockets (a fresh context) and a real clipboard,
// because the whole point is that the link survives being copied and pasted.
// Chromium gives us both — clipboard permissions can be granted per context —
// so the round trip here is literal: copy in one context, read back what the
// browser actually holds, and open THAT string in the other context.
//
// Contexts also carry their own `CF-Connecting-IP` so the 10-boards-per-minute
// create limiter is scoped per visitor instead of the whole suite sharing one
// bucket. Fixture-made boards send the `x-test-ignore-limit` bypass (see
// helpers/board.ts); the in-app Create button does not — which is exactly what
// the rate-limit case needs.

import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

export const ORIGIN = 'http://127.0.0.1:8799';

/** A fresh context that can read AND write the clipboard. `visitor` picks the
 * limiter key (1–254) so one test's creates cannot starve another's. */
export async function shareContext(
  browser: Browser,
  visitor: number,
  options: { clipboardDenied?: boolean; noClipboard?: boolean } = {},
): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    permissions: ['clipboard-read', 'clipboard-write'],
    extraHTTPHeaders: { 'CF-Connecting-IP': `203.0.113.${visitor}` },
  });
  if (options.clipboardDenied) {
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: () => Promise.reject(new Error('denied by policy')) },
      });
    });
  }
  if (options.noClipboard) {
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: undefined,
      });
    });
  }
  return context;
}

/** A page sitting on `/b/<boardId>` (the visitor's entry point). */
export async function openLink(context: BrowserContext, link: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(link);
  return page;
}

/** What the browser actually holds as text (the paste source of truth). */
export async function clipboardText(page: Page): Promise<string> {
  await page.bringToFront();
  return page.evaluate(() => navigator.clipboard.readText());
}

/** The value currently SELECTED inside the share field (manual-copy check). */
export async function selectedLink(page: Page): Promise<string> {
  return page.evaluate(() => {
    const field = document.querySelector('[data-testid="share-link-field"]') as
      | HTMLInputElement
      | null;
    if (!field) return '';
    return field.value.slice(field.selectionStart ?? 0, field.selectionEnd ?? 0);
  });
}

/** Open the panel, copy, and return the link exactly as the clipboard holds
 * it (so a broken `boardLink` or a truncated write fails the test). */
export async function copyBoardLink(page: Page): Promise<string> {
  await page.getByTestId('share-button').click();
  await expect(page.getByTestId('share-panel')).toBeVisible();
  await page.getByTestId('copy-link').click();
  await expect(page.getByTestId('copy-link')).toHaveText('\u2713 Link copied');
  const link = await clipboardText(page);
  expect(link).toContain('/b/');
  return link;
}

/** The board id inside a page URL (`…/b/<id>`). */
export function boardIdOf(url: string): string {
  const match = /\/b\/([^/?#]+)/.exec(url);
  if (!match) throw new Error(`no board id in ${url}`);
  return match[1];
}
