// Story 5 — Share a board with others using a link.
import { test, expect, requires, openBoard, joinBoard, notes, createNote, hint, shot, BOARD_URL_RE } from './fixtures';

const LINK_COPIED_MS = 2_000;
const LIVE_MS = 2_000;
const CREATE_MS = 2_000;
const UNKNOWN_ID = 'AAAAAAAAAAAAAAAAAAAAAA';

test.describe('story 5 @s05', () => {
  test.beforeEach(() => requires(5));

  test('home page and create a board @ref prd:share.create', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('A shared board for thinking together')).toBeVisible();
    await shot(page, 's05-home');
    const t0 = Date.now();
    await page.getByRole('button', { name: 'Create a board' }).click();
    await page.waitForURL(BOARD_URL_RE);
    await expect(hint(page)).toBeVisible();
    expect(Date.now() - t0).toBeLessThan(CREATE_MS * 2);
  });

  test('share panel copies full link and shows Link copied @ref prd:share.copy', async ({ page }) => {
    const url = await openBoard(page);
    await page.getByRole('button', { name: 'Share', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Share board' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Anyone with this link can view and edit this board.')).toBeVisible();
    await expect(dialog.locator('input[readonly]')).toHaveValue(url);
    await dialog.getByRole('button', { name: 'Copy link' }).click();
    await expect(dialog.getByText('Link copied')).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
    await shot(page, 's05-share');
    await expect(dialog.getByRole('button', { name: 'Copy link' })).toBeVisible({ timeout: LINK_COPIED_MS * 2 });
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('opening a shared link gives full editing @ref prd:share.open_link', async ({ newPerson }) => {
    const maya = await newPerson();
    const url = await openBoard(maya);
    const colleague = await newPerson();
    await joinBoard(colleague, url);
    await createNote(colleague, { x: 400, y: 300 }, 'joined');
    await expect(notes(maya).filter({ hasText: 'joined' })).toHaveCount(1, { timeout: LIVE_MS });
  });

  test('unknown or malformed link shows Board not found and creates nothing @ref prd:share.not_found', async ({ page }) => {
    for (const bad of [`/b/${UNKNOWN_ID}`, '/b/bad']) {
      await page.goto(bad);
      await expect(page.getByRole('heading', { name: 'Board not found' })).toBeVisible();
      await expect(page.getByText('Check the link, or ask the person who shared it to send it again.')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Create a new board' })).toBeVisible();
    }
    await shot(page, 's05-not-found');
    await page.goto(`/b/${UNKNOWN_ID}`);
    await expect(page.getByRole('heading', { name: 'Board not found' })).toBeVisible();
  });

  test('distinct 22-character links @ref prd:share.unguessable', async ({ page }) => {
    const seen = new Set<string>();
    const BOARDS = 3;
    for (let i = 0; i < BOARDS; i++) {
      await page.goto('/');
      await page.getByRole('button', { name: 'Create a board' }).click();
      await page.waitForURL(BOARD_URL_RE);
      seen.add(page.url());
    }
    expect(seen.size).toBe(BOARDS);
  });
});
