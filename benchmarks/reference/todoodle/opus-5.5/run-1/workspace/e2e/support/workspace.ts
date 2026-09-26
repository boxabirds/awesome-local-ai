import { type BrowserContext, type Page, expect } from '@playwright/test';

export const BANNER_TEXT = "Your link isn't saved yet — you'll lose access if you clear this browser.";

export type CreatedWorkspace = { link: string; secret: string; id: string };

/** The name editor. `includeHidden`: the modal Share panel marks the page behind it aria-hidden. */
export function nameField(page: Page) {
  return page.getByRole('textbox', { name: 'Workspace name', includeHidden: true });
}

export function linkField(page: Page) {
  return page.getByRole('textbox', { name: 'Workspace link' });
}

/**
 * WebKit cannot be granted clipboard access by Playwright, so its writeText is made to reject
 * (as a browser denying access would) and the manual-copy fallback is what gets tested there.
 */
export async function denyClipboardOnWebkit(context: BrowserContext, browserName: string): Promise<void> {
  if (browserName !== 'webkit') return;
  await context.addInitScript(() => {
    const deny = () => Promise.reject(new DOMException('Denied', 'NotAllowedError'));
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: deny, write: deny } });
  });
}

/** Home -> Start a new list -> the Save your link panel. Returns the link shown and the new workspace id. */
export async function createWorkspace(page: Page): Promise<CreatedWorkspace & { elapsedMs: number }> {
  await page.goto('/');
  const created = page.waitForResponse((res) => new URL(res.url()).pathname === '/api/workspaces' && res.request().method() === 'POST');
  const started = Date.now();
  await page.getByRole('button', { name: 'Start a new list' }).click();
  await expect(nameField(page)).toHaveValue('My Todoodle');
  const elapsedMs = Date.now() - started;
  const body = (await (await created).json()) as { workspace: { id: string }; secret: string };
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Save your link' })).toBeVisible();
  const link = await linkField(page).inputValue();
  return { link, secret: body.secret, id: body.workspace.id, elapsedMs };
}

/**
 * Saves the link from the 'Save your link' panel. Chromium: Copy link & continue copies and closes.
 * WebKit: the copy is denied, the field is selected, and a keyboard copy of it counts as saved.
 */
export async function saveLinkFromPanel(page: Page, browserName: string, expectedLink: string): Promise<void> {
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Copy link & continue' }).click();
  if (browserName === 'webkit') {
    await expect(linkField(page)).toBeFocused();
    const selected = await linkField(page).evaluate((el: HTMLInputElement) => el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0));
    expect(selected).toBe(expectedLink);
    await page.keyboard.press('Meta+C');
    await dialog.getByRole('button', { name: 'Skip for now' }).click();
  } else {
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe(expectedLink);
  }
  await expect(page.getByRole('dialog')).toBeHidden();
}
