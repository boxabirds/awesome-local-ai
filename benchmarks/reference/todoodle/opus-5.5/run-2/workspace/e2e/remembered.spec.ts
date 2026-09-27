import { expect, test } from '@playwright/test';
import { apiCreate, forgetFromHome, listedNames, openFromHome, prepareClipboard, rowLink } from './remembered-helpers';

const HINT = 'Have a link? Open it to get back in.';
const WARNING = "You haven't saved this link. If you forget it here, you may lose access.";
const DROPPED = "Your least recently opened workspace was removed from this browser's list. Its link still works.";

test.describe('remembered workspaces', () => {
  test('TC-80 a created workspace is listed first on Home', async ({ page, baseURL }) => {
    await apiCreate(page.request, baseURL!, 'Older');
    await page.goto('/');
    await page.getByRole('button', { name: 'Start a new list' }).click();
    await page.getByRole('dialog', { name: 'Save your link' }).getByRole('button', { name: 'Skip for now' }).click();
    await expect(page.getByLabel('Workspace name')).toHaveValue('My Todoodle');
    await page.goto('/');
    expect(await listedNames(page)).toEqual(['My Todoodle', 'Older']);
  });

  test('TC-81 opening A moves it to the top: B,A becomes A,B', async ({ page, baseURL }) => {
    await apiCreate(page.request, baseURL!, 'Alpha');
    await apiCreate(page.request, baseURL!, 'Beta');
    await page.goto('/');
    expect(await listedNames(page)).toEqual(['Beta', 'Alpha']);
    await openFromHome(page, 'Alpha');
    await page.goto('/');
    expect(await listedNames(page)).toEqual(['Alpha', 'Beta']);
  });

  test('TC-82 forget A with confirmation; its saved link still opens A and adds it back', async ({ page, baseURL }) => {
    const a = await apiCreate(page.request, baseURL!, 'Alpha');
    await apiCreate(page.request, baseURL!, 'Beta');
    await page.goto('/');
    const dialog = await forgetFromHome(page, 'Alpha');
    await expect(dialog.getByText('This only removes it from this browser. Anyone with the link can still open it.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Forget' }).click();
    await expect(rowLink(page, 'Alpha')).toHaveCount(0);
    await page.reload();
    expect(await listedNames(page)).toEqual(['Beta']);

    await page.goto(a.link);
    await expect(page.getByLabel('Workspace name')).toHaveValue('Alpha');
    await page.goto('/');
    expect(await listedNames(page)).toEqual(['Alpha', 'Beta']);
  });

  test('TC-83 forgetting in one browser does not affect another', async ({ browser, baseURL }) => {
    const one = await browser.newContext();
    const two = await browser.newContext();
    const page1 = await one.newPage();
    const page2 = await two.newPage();
    const a = await apiCreate(page1.request, baseURL!, 'Shared list');
    await page2.goto(a.link);
    await expect(page2.getByLabel('Workspace name')).toHaveValue('Shared list');

    await page1.goto('/');
    const dialog = await forgetFromHome(page1, 'Shared list');
    await dialog.getByRole('button', { name: 'Forget' }).click();
    await expect(page1.getByText(HINT)).toBeVisible();

    await page2.goto('/');
    expect(await listedNames(page2)).toEqual(['Shared list']);
    await openFromHome(page2, 'Shared list');
    await one.close();
    await two.close();
  });

  test('TC-84 page scripts never see tdl_ws, and the list response holds no secret', async ({ page, baseURL }) => {
    const a = await apiCreate(page.request, baseURL!, 'One');
    const b = await apiCreate(page.request, baseURL!, 'Two');
    await page.goto('/');
    await expect(rowLink(page, 'One')).toBeVisible();
    expect(await page.evaluate(() => document.cookie)).not.toContain('tdl_ws');
    const body = await page.evaluate(() => fetch('/api/remembered').then((r) => r.text()));
    expect(body).toContain('One');
    expect(body).not.toContain(a.secret);
    expect(body).not.toContain(b.secret);
    const cookies = await page.context().cookies();
    const cookie = cookies.find((c) => c.name === 'tdl_ws')!;
    expect(cookie).toMatchObject({ httpOnly: true, path: '/api', sameSite: 'Lax' });
  });

  test('TC-85 a fresh browser sees only Start and the hint', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(HINT)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your workspaces on this browser' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /^Continue to/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Start a new list' })).toBeEnabled();
  });

  test('TC-86 switching from B to A in the header', async ({ page, baseURL }) => {
    await apiCreate(page.request, baseURL!, 'Alpha');
    await apiCreate(page.request, baseURL!, 'Beta');
    await page.goto('/');
    await openFromHome(page, 'Beta');
    const touched = page.waitForResponse((r) => r.url().includes('/touch'));
    await page.getByRole('button', { name: 'Switch workspace' }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Alpha' }).click();
    await expect(page.getByLabel('Workspace name')).toHaveValue('Alpha');
    expect(new URL(page.url()).pathname).toMatch(/^\/w\/[0-9a-f]{32}$/);
    await touched;
    await page.goto('/');
    expect(await listedNames(page)).toEqual(['Alpha', 'Beta']);
  });

  test('TC-87 at the cap the oldest is dropped with a notice; 50 stay listed', async ({ page }) => {
    const seeded = await page.request.post('/test/remembered-seed', {
      headers: { 'X-Todoodle-Client': 'web', 'Content-Type': 'application/json' },
      data: { count: 50 },
    });
    expect(seeded.status()).toBe(201);
    await page.goto('/');
    await expect(page.locator('li[data-available="true"]')).toHaveCount(50);
    await expect(rowLink(page, 'Seeded 50')).toBeVisible();
    await page.getByRole('button', { name: 'Start a new list', exact: true }).click();
    await expect(page.getByText(DROPPED)).toBeVisible();
    await page.getByRole('dialog', { name: 'Save your link' }).getByRole('button', { name: 'Skip for now' }).click();
    await page.goto('/');
    const names = await listedNames(page);
    expect(names).toHaveLength(50);
    expect(names[0]).toBe('My Todoodle');
    expect(names).not.toContain('Seeded 50');
    expect(names).toContain('Seeded 49');
  });

  test('TC-88 Continue to the most recent never auto-navigates; clicking it opens B', async ({ page, baseURL }) => {
    await apiCreate(page.request, baseURL!, 'Alpha');
    await apiCreate(page.request, baseURL!, 'Beta');
    await page.goto('/');
    const cont = page.getByRole('link', { name: 'Continue to Beta' });
    await expect(cont).toBeVisible();
    await page.waitForTimeout(2_000);
    expect(new URL(page.url()).pathname).toBe('/');
    await cont.click();
    await expect(page.getByLabel('Workspace name')).toHaveValue('Beta');
  });

  test('TC-89 forgetting a never-saved link: warning, Copy link, then the copied link reopens it', async ({
    page,
    context,
    browserName,
  }) => {
    await prepareClipboard(context, browserName);
    await page.goto('/');
    const [created] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/api/workspaces') && r.request().method() === 'POST'),
      page.getByRole('button', { name: 'Start a new list' }).click(),
    ]);
    const { secret } = (await created.json()) as { secret: string };
    const link = `${new URL(page.url()).origin}/w#${secret}`;
    await page.getByRole('dialog', { name: 'Save your link' }).getByRole('button', { name: 'Skip for now' }).click();
    await page.getByLabel('Workspace name').fill('Unsaved');
    await page.getByLabel('Workspace name').press('Enter');
    await expect(page.getByLabel('Workspace name')).toHaveValue('Unsaved');
    await page.waitForLoadState('networkidle');

    await page.goto('/');
    const dialog = await forgetFromHome(page, 'Unsaved');
    await expect(dialog.getByText(WARNING)).toBeVisible();
    await dialog.getByRole('button', { name: 'Copy link' }).click();
    let copied: string;
    if (browserName === 'chromium') {
      await expect(dialog.getByRole('status')).toHaveText('Link copied — you can forget it safely.');
      copied = await page.evaluate(() => navigator.clipboard.readText());
    } else {
      const field = dialog.getByLabel('Workspace link');
      await expect(field).toBeFocused();
      copied = await field.inputValue();
      expect(await field.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd])).toEqual([0, copied.length]);
      await expect(dialog.getByText('Copy it manually')).toBeVisible();
    }
    expect(copied).toBe(link);
    await dialog.getByRole('button', { name: 'Forget' }).click();
    await expect(rowLink(page, 'Unsaved')).toHaveCount(0);

    await page.goto(copied);
    await expect(page.getByLabel('Workspace name')).toHaveValue('Unsaved');
  });

  test('TC-90 a bad link lists this browser\'s workspaces above Start; clicking one opens it', async ({ page, baseURL }) => {
    await apiCreate(page.request, baseURL!, 'Alpha');
    const random = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
    await page.goto(`/w#${random}`);
    await expect(page.getByRole('heading', { name: 'Workspace not found' })).toBeVisible();
    const row = rowLink(page, 'Alpha');
    await expect(row).toBeVisible();
    const start = page.getByRole('button', { name: 'Start a new list' });
    expect((await row.boundingBox())!.y).toBeLessThan((await start.boundingBox())!.y);
    await row.click();
    await expect(page.getByLabel('Workspace name')).toHaveValue('Alpha');
  });

  test('TC-92 the name shows at once while the workspace is still loading', async ({ page, baseURL }) => {
    const a = await apiCreate(page.request, baseURL!, 'Alpha');
    await page.goto('/');
    await expect(rowLink(page, 'Alpha')).toBeVisible();
    // Home has warmed the Workspace route chunk by now; what is measured is the name, not code loading.
    await page.waitForLoadState('networkidle');
    let released = false;
    await page.route(`**/api/w/${a.id}`, async (route) => {
      await new Promise((r) => setTimeout(r, 1_000));
      released = true;
      await route.continue();
    });
    await rowLink(page, 'Alpha').hover();
    await rowLink(page, 'Alpha').click();
    await expect(page.getByLabel('Workspace name')).toHaveValue('Alpha', { timeout: 200 });
    expect(released).toBe(false);
    await expect(page.getByTestId('workspace-body-skeleton')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible();
  });
});
