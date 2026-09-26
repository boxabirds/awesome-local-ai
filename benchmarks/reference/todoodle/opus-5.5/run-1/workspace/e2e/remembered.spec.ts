import { expect, test } from '@playwright/test';
import {
  DROPPED_NOTICE,
  EMPTY_HINT,
  LIST_HEADING,
  createNamed,
  goHome,
  openForget,
  rowLink,
  rowNames,
} from './support/remembered.ts';
import { createWorkspace, denyClipboardOnWebkit, nameField } from './support/workspace.ts';

test.beforeEach(async ({ context, browserName }) => {
  await denyClipboardOnWebkit(context, browserName);
});

test('TC-80 a created workspace is listed first on Home', async ({ page }) => {
  await createNamed(page, 'First list');
  await goHome(page);
  expect((await rowNames(page))[0]).toBe('First list');
});

test('TC-81 recency: B, A becomes A, B after opening A', async ({ page }) => {
  await createNamed(page, 'Alpha');
  await createNamed(page, 'Bravo');
  await goHome(page);
  expect(await rowNames(page)).toEqual(['Bravo', 'Alpha']);
  const touched = page.waitForResponse((res) => res.url().includes('/touch') && res.status() === 204);
  await rowLink(page, 'Alpha').click();
  await expect(nameField(page)).toHaveValue('Alpha');
  await touched;
  await goHome(page);
  expect(await rowNames(page)).toEqual(['Alpha', 'Bravo']);
});

test('TC-82 forget with confirm; the link still opens the workspace and it is remembered again', async ({ page }) => {
  const a = await createNamed(page, 'Forget me');
  await goHome(page);
  const dialog = await openForget(page, a.name);
  await dialog.getByRole('button', { name: 'Forget' }).click();
  await expect(dialog).toBeHidden();
  await expect(rowLink(page, a.name)).toHaveCount(0);
  await page.reload();
  await expect(page.getByText(EMPTY_HINT)).toBeVisible();

  await page.goto(a.link);
  await expect(nameField(page)).toHaveValue(a.name);
  await goHome(page);
  expect(await rowNames(page)).toEqual([a.name]);
});

test('TC-83 forgetting in one browser does not affect another', async ({ page, browser }) => {
  const a = await createNamed(page, 'Shared');
  const other = await browser.newContext();
  const second = await other.newPage();
  await second.goto(a.link);
  await expect(nameField(second)).toHaveValue(a.name);

  await goHome(page);
  const dialog = await openForget(page, a.name);
  await dialog.getByRole('button', { name: 'Forget' }).click();
  await expect(rowLink(page, a.name)).toHaveCount(0);

  await goHome(second);
  expect(await rowNames(second)).toEqual([a.name]);
  await rowLink(second, a.name).click();
  await expect(nameField(second)).toHaveValue(a.name);
  await other.close();
});

test('TC-84 tdl_ws is invisible to page scripts and /api/remembered never returns a secret', async ({ page, context }) => {
  const a = await createNamed(page, 'One');
  const b = await createNamed(page, 'Two');
  expect(await page.evaluate(() => document.cookie)).not.toContain('tdl_ws');
  const cookie = (await context.cookies()).find((c) => c.name === 'tdl_ws');
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/api' });
  const body = await page.evaluate(async () => (await fetch('/api/remembered')).text());
  expect(body).toContain(a.id);
  for (const secret of [a.secret, b.secret]) expect(body).not.toContain(secret);
});

test('TC-85 a fresh browser: empty-state hint, no list, no Continue', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText(EMPTY_HINT)).toBeVisible();
  await expect(page.getByRole('heading', { name: LIST_HEADING })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /^Continue to/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start a new list' })).toBeEnabled();
});

test('TC-86 switcher: from B to A, then Home lists A, B', async ({ page }) => {
  await createNamed(page, 'Apples');
  await createNamed(page, 'Bananas');
  await page.getByRole('button', { name: 'Switch workspace' }).click();
  const touched = page.waitForResponse((res) => res.url().includes('/touch') && res.status() === 204);
  await page.getByRole('menuitem', { name: 'Apples' }).click();
  await expect(nameField(page)).toHaveValue('Apples');
  await touched;
  await goHome(page);
  expect(await rowNames(page)).toEqual(['Apples', 'Bananas']);
});

test('TC-87 at the 50-workspace cap, creating one more drops the oldest and says its link still works', async ({ page }) => {
  await page.goto('/');
  const seeded = await page.request.post('/test/remembered-seed', {
    headers: { 'X-Todoodle-Client': 'web' },
    data: { count: 50 },
  });
  expect(seeded.status()).toBe(201);
  await goHome(page);
  expect(await rowNames(page)).toHaveLength(50);

  await page.getByRole('button', { name: 'Start a new list' }).click();
  await expect(page.getByText(DROPPED_NOTICE)).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Skip for now' }).click();
  await goHome(page);
  const names = await rowNames(page);
  expect(names).toHaveLength(50);
  expect(names[0]).toBe('My Todoodle');
  expect(names).toContain('Seeded 49');
  expect(names).not.toContain('Seeded 50');
});

test('TC-88 "Continue to B" is offered, Home stays put, and a click lands in B', async ({ page }) => {
  await createNamed(page, 'Aardvark');
  await createNamed(page, 'Beaver');
  await page.goto('/');
  const cont = page.getByRole('link', { name: 'Continue to Beaver' });
  await expect(cont).toBeVisible();
  await page.waitForTimeout(2000);
  expect(new URL(page.url()).pathname).toBe('/');
  await cont.click();
  await expect(nameField(page)).toHaveValue('Beaver');
});

test('TC-89 forgetting an unsaved link warns, Copy link saves it, and the copied link reopens the workspace', async ({ page, browserName }) => {
  const a = await createNamed(page, 'Unsaved');
  await goHome(page);
  const dialog = await openForget(page, a.name);
  await expect(dialog.getByText("You haven't saved this link. If you forget it here, you may lose access.")).toBeVisible();
  await dialog.getByRole('button', { name: 'Copy link' }).click();

  let copied: string;
  if (browserName === 'webkit') {
    // WebKit's clipboard is denied: the link is shown pre-selected for a manual copy.
    const field = dialog.getByRole('textbox', { name: 'Copy it manually' });
    await expect(field).toBeFocused();
    copied = await field.evaluate((el: HTMLInputElement) => el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0));
  } else {
    await expect(dialog.getByRole('status')).toHaveText('Link copied — you can forget it safely.');
    copied = await page.evaluate(() => navigator.clipboard.readText());
  }
  expect(copied).toBe(a.link);

  await dialog.getByRole('button', { name: 'Forget' }).click();
  await expect(rowLink(page, a.name)).toHaveCount(0);
  await page.goto(copied);
  await expect(nameField(page)).toHaveValue(a.name);
});

test('TC-90 a bad link shows Workspace not found with this browser\'s workspaces above Start', async ({ page }) => {
  const a = await createNamed(page, 'Recover me');
  const random = 'Qw7'.repeat(14) + 'z';
  await page.goto(`/w#${random}`);
  await expect(page.getByRole('heading', { name: 'Workspace not found' })).toBeVisible();
  await expect(page.getByRole('heading', { name: LIST_HEADING })).toBeVisible();
  const row = rowLink(page, a.name);
  const start = page.getByRole('button', { name: 'Start a new list' });
  const [rowBox, startBox] = [await row.boundingBox(), await start.boundingBox()];
  expect(rowBox!.y).toBeLessThan(startBox!.y);
  await row.click();
  await expect(nameField(page)).toHaveValue(a.name);
  expect(new URL(page.url()).pathname).toBe(`/w/${a.id}`);
});

test('TC-92 opening from the list shows the name within 200 ms, before the delayed workspace response', async ({ page }) => {
  const a = await createNamed(page, 'Instant');
  await goHome(page);
  let fulfilled = false;
  await page.route(`**/api/w/${a.id}`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    fulfilled = true;
    await route.continue();
  });
  await rowLink(page, a.name).click();
  // The header shows the name (from this browser's list) while the workspace itself is still loading.
  // Either the loading header's text or the (placeholder) name field's value.
  const headerName = () =>
    page
      .getByRole('banner')
      .evaluate((el) => `${el.textContent ?? ''} ${Array.from(el.querySelectorAll('input'), (input) => input.value).join(' ')}`)
      .catch(() => '');
  await expect.poll(headerName, { timeout: 200, intervals: [20] }).toContain(a.name);
  expect(fulfilled).toBe(false);
  await expect(nameField(page)).toHaveValue(a.name);
  await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible();
  expect(fulfilled).toBe(true);
});
