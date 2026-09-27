// Story 5 end-to-end: create a board, share its link, have a second person open
// and edit it; dead links; the create rate limit; legacy boards.
//
// TC-27 and TC-29 also run on Firefox and WebKit when the host can launch them
// (see playwright.config.ts); the rest are Chromium-only by design.

// Each test uses its own CF-Connecting-IP so the shared 10-per-minute create
// limiter cannot bleed across tests (`wrangler dev` otherwise reports the loopback
// address for every request).
//
// TC-26, TC-27, TC-30, TC-31 from
// spec/stories/005-share-a-board-with-others-using-a-link/design.md

import { expect, test, type Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { CREATE_BUDGET_MS } from '../../src/shared/config';

const BOARD_PATH = /\/b\/[A-Za-z0-9_-]{22}$/;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** A well-formed code that no one has created. */
function unknownBoardCode(): string {
  return Array.from(randomBytes(22), (byte) => ALPHABET[byte % 64]).join('');
}

function headers(ip: string): Record<string, string> {
  return { 'CF-Connecting-IP': ip };
}

async function createBoard(page: Page): Promise<string> {
  await page.goto('/');
  const started = Date.now();
  await page.getByRole('button', { name: 'Create a board' }).click();
  await page.waitForURL(BOARD_PATH);
  await expect(page.getByTestId('board-workspace')).toBeVisible();
  // PRD share.create: the board is usable within the create budget.
  expect(Date.now() - started).toBeLessThan(CREATE_BUDGET_MS);
  return new URL(page.url()).pathname;
}

async function addNote(page: Page, text: string): Promise<void> {
  await page.getByRole('button', { name: 'Sticky note' }).click();
  const note = page.locator('[data-object-id]');
  await expect(note).toHaveCount(1);
  await note.dblclick();
  const editor = note.locator('.sticky-editor');
  await editor.waitFor();
  await editor.click();
  await page.keyboard.type(text);
  await editor.blur();
  await expect(note.locator('.sticky-text-content')).toHaveText(text);
}

async function editText(page: Page, text: string): Promise<void> {
  const note = page.locator('[data-object-id]').first();
  await note.dblclick();
  const editor = note.locator('.sticky-editor');
  await editor.waitFor();
  await editor.click();
  await page.keyboard.press('End');
  await page.keyboard.type(text);
  await editor.blur();
}

test.describe('sharing a board by link', () => {
  test.use({ extraHTTPHeaders: headers('203.0.113.26') });

  test('TC-26 Maya creates a board, adds a note and shares the link; Sam opens it, sees the note and edits it', async ({
    browser,
  }) => {
    const maya = await browser.newContext({
      extraHTTPHeaders: headers('203.0.113.26'),
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    const mayaPage = await maya.newPage();
    const boardPath = await createBoard(mayaPage);
    await addNote(mayaPage, 'Sprint goals');

    // Share: the panel shows the board link and copying it puts that exact link
    // on the clipboard.
    await mayaPage.getByRole('button', { name: 'Share' }).click();
    const link = await mayaPage.getByLabel('Board link').inputValue();
    expect(link).toBe(mayaPage.url()); // the panel offers exactly the address Maya is on
    await mayaPage.getByRole('button', { name: 'Copy link' }).click();
    await expect(mayaPage.getByRole('button', { name: 'Link copied' })).toBeVisible();
    const clipboard = await mayaPage.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toBe(link);
    expect(clipboard).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:\\d+${boardPath}$`));
    await mayaPage.getByRole('button', { name: 'Close' }).click();

    // Sam follows the link in a browser that has never seen this board.
    const sam = await browser.newContext({ extraHTTPHeaders: headers('203.0.113.126') });
    const samPage = await sam.newPage();
    await samPage.goto(link);
    await expect(samPage.getByTestId('board-workspace')).toBeVisible();
    await expect(samPage.locator('[data-object-id]')).toHaveCount(1);
    await expect(samPage.locator('.sticky-text-content')).toHaveText('Sprint goals');
    expect(samPage.url()).toBe(link);

    // Sam edits; Maya sees it without reloading.
    await editText(samPage, ' — checked');
    await expect(samPage.locator('.sticky-text-content')).toHaveText('Sprint goals — checked');
    await expect(mayaPage.locator('.sticky-text-content')).toHaveText('Sprint goals — checked', {
      timeout: 5_000,
    });

    // Maya's next edit reaches Sam too (two-way, live).
    await editText(mayaPage, '!');
    await expect(samPage.locator('.sticky-text-content')).toHaveText('Sprint goals — checked!', {
      timeout: 5_000,
    });

    await sam.close();
    await maya.close();
  });
});

test.describe('dead links', () => {
  test.use({ extraHTTPHeaders: headers('203.0.113.27') });

  test('TC-27 an unknown link explains itself and creates nothing', async ({ page }) => {
    const code = unknownBoardCode();
    await page.goto(`/b/${code}`);
    await expect(page.getByRole('heading', { name: 'Board not found' })).toBeVisible();
    await expect(
      page.getByText('Check the link, or ask the person who shared it to send it again.'),
    ).toBeVisible();
    await expect(page.getByTestId('board-workspace')).toHaveCount(0);

    // Opening the link created nothing: the board still does not exist.
    const stillMissing = await page.evaluate(async (boardId) => {
      const response = await fetch(`/api/boards/${boardId}`);
      return response.status;
    }, code);
    expect(stillMissing).toBe(404);

    // The way out of the dead link works.
    await page.getByRole('button', { name: 'Create a new board' }).click();
    await page.waitForURL(BOARD_PATH);
    await expect(page.getByTestId('board-workspace')).toBeVisible();
    await expect(page.locator('[data-object-id]')).toHaveCount(0);
  });

  test('a malformed link code is not found either', async ({ page }) => {
    await page.goto('/b/nonsense');
    await expect(page.getByRole('heading', { name: 'Board not found' })).toBeVisible();
  });
});

test.describe('unreachable service', () => {
  test.use({ extraHTTPHeaders: headers('203.0.113.28') });

  test('TC-28 says the service could not be reached, then opens the board without a reload', async ({
    page,
  }) => {
    const path = await createBoard(page);
    const boardUrl = new URL(path, page.url()).toString();

    await page.route('**/api/boards/*', (route) => route.abort());
    await page.goto(path);
    await expect(page.getByText("Couldn't reach vidi6. Retrying…")).toBeVisible();
    await expect(page.getByTestId('board-workspace')).toHaveCount(0);
    await page.evaluate(() => {
      (window as unknown as Record<string, unknown>).__documentSurvived = true;
    });

    await page.unroute('**/api/boards/*');
    await expect(page.getByTestId('board-workspace')).toBeVisible({ timeout: 15_000 });
    expect(page.url()).toBe(boardUrl);
    // Still the same document: the page retried on its own rather than reloading.
    expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__documentSurvived)).toBe(true);
  });
});

test.describe('clipboard refused', () => {
  test.use({ extraHTTPHeaders: headers('203.0.113.29') });

  test('TC-29 leaves the whole link selected with manual copy instructions', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        get: () => ({ writeText: () => Promise.reject(new Error('not allowed')) }),
      });
    });
    await createBoard(page);

    await page.getByRole('button', { name: 'Share' }).click();
    const link = await page.getByLabel('Board link').inputValue();
    await page.getByRole('button', { name: 'Copy link' }).click();
    await expect(page.getByText('Press Ctrl+C (Cmd+C on Mac) to copy')).toBeVisible();
    // The button did not claim to have copied anything.
    await expect(page.getByRole('button', { name: 'Copy link' })).toBeVisible();

    const selection = await page.evaluate(() => {
      const field = document.querySelector<HTMLInputElement>('input.share-link');
      return field
        ? { value: field.value, from: field.selectionStart, to: field.selectionEnd, focused: document.activeElement === field }
        : null;
    });
    expect(selection).not.toBeNull();
    expect(selection?.value).toBe(link);
    expect(selection?.from).toBe(0);
    expect(selection?.to).toBe(link.length);
    expect(selection?.focused).toBe(true);
  });
});

test.describe('create rate limit', () => {
  test.use({ extraHTTPHeaders: headers('203.0.113.30') });

  /**
   * The create limiter counts in a fixed window that starts on the wall-clock
   * minute (measured against `wrangler dev`: the counter resets at :00). The
   * eleven clicks below take a couple of seconds; if they straddled a boundary
   * the boards would land in two windows and none would be refused. Starting
   * with most of a window left leaves the boundary case as the only one that
   * can happen. TC-13 covers the same contract in the integration suite.
   */
  async function startOfWindow(): Promise<void> {
    const remaining = 60 - new Date().getSeconds();
    if (remaining < 40) {
      await new Promise((resolveFn) => setTimeout(resolveFn, (remaining + 1) * 1000));
    }
  }

  test('TC-30 the eleventh board in a minute is refused with the waiting message', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await startOfWindow();
    for (let i = 0; i < 10; i++) {
      const path = await createBoard(page);
      expect(path).toMatch(BOARD_PATH);
    }
    await page.goto('/');
    await page.getByRole('button', { name: 'Create a board' }).click();
    await expect(page.getByRole('alert')).toHaveText(
      "You're creating boards too quickly. Wait a minute and try again.",
    );
    expect(new URL(page.url()).pathname).toBe('/');
    await expect(page.getByRole('button', { name: 'Create a board' })).toBeEnabled();
  });
});

test.describe('legacy boards', () => {
  test.use({ extraHTTPHeaders: headers('203.0.113.31') });

  test('TC-31 a board created by an older build opens with its notes', async ({ page }) => {
    const response = await page.request.post('/__test/seed-legacy-board', {
      data: { notes: [{ x: 140, y: 80, color: 'green', text: 'from an older build' }] },
    });
    expect(response.status()).toBe(201);
    const { id } = (await response.json()) as { id: string };
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);

    await page.goto(`/b/${id}`);
    await expect(page.getByTestId('board-workspace')).toBeVisible();
    const note = page.locator('[data-object-id]');
    await expect(note).toHaveCount(1);
    await expect(note).toHaveAttribute('data-note-color', 'green');
    await expect(note.locator('.sticky-text-content')).toHaveText('from an older build');

    // and it is writable from here on
    await editText(page, ' (updated)');
    await expect(note.locator('.sticky-text-content')).toHaveText('from an older build (updated)');
  });
});
