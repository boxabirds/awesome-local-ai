import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import * as Y from 'yjs';
import { newBoardId } from '../../src/shared/board-id';
import {
  createSticky,
  initDoc,
  type StickySnapshot,
} from '../../src/shared/board-model';
import {
  CREATE_BUDGET_MS,
  E2E_EVENTUAL_TIMEOUT_MS,
  STICKY_COLORS,
  type StickyColor,
} from '../../src/shared/config';
import { E2E_BASE_URL, apiCreateBoard, waitForBoardReady } from './helpers/board';

/**
 * Story 5 e2e: share a board with others using a link.
 *
 * TC-26/TC-28/TC-31 are chromium-only (clipboard / route interception /
 * test-hook seeding); TC-27 and TC-29 must pass in firefox and webkit too.
 */

const noteSelector = '[data-note-id]';

function snapshot(page: Page): Promise<StickySnapshot[]> {
  return page.evaluate(() => (window as any).__vidi6?.snapshot?.() ?? []);
}

/** Skip the test on non-chromium browsers. */
function chromiumOnly(browserName: string): void {
  test.skip(browserName !== 'chromium', 'chromium-only workflow');
}

test.describe('Story 5: share a board with others using a link', () => {
  test.describe.configure({ mode: 'serial' });

  test('TC-26: create, share, join — Maya creates, shares the link, Sam joins and edits', async ({
    browser,
    browserName,
  }) => {
    chromiumOnly(browserName);

    // Maya — clipboard permissions so the copied link is readable.
    const ctxMaya: BrowserContext = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    const maya = await ctxMaya.newPage();

    await maya.goto('/');
    const clickAt = Date.now();
    await maya.getByRole('button', { name: 'New board' }).click();
    await waitForBoardReady(maya);
    const createMs = Date.now() - clickAt;
    const status = createMs > CREATE_BUDGET_MS ? '⚠️ EXCEEDS' : '✓ within';
    console.log(`  [create-time] click → board: ${createMs}ms (${status} ${CREATE_BUDGET_MS}ms budget)`);

    const boardUrl = maya.url();
    expect(boardUrl).toMatch(/\/b\/[A-Za-z0-9_-]{22}$/);

    // Maya adds a note.
    await maya.mouse.dblclick(400, 300);
    await maya.keyboard.type('Hello Sam');
    await maya.keyboard.press('Escape');
    await expect.poll(async () => (await snapshot(maya)).length, { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(1);

    // Share → Copy link → "Link copied".
    await maya.getByRole('button', { name: 'Share' }).click();
    const linkInput = maya.getByRole('dialog').getByRole('textbox');
    await expect(linkInput).toHaveValue(boardUrl);
    await maya.getByRole('button', { name: 'Copy link' }).click();
    await expect(maya.getByRole('button', { name: 'Link copied' })).toBeVisible();

    // The clipboard holds exactly the board link.
    const clipboardText = await maya.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toBe(boardUrl);

    // Sam opens the shared link in a fresh context.
    const ctxSam = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const sam = await ctxSam.newPage();
    await sam.goto(clipboardText);
    await waitForBoardReady(sam);

    // Sam sees Maya's note.
    await expect.poll(async () => (await snapshot(sam)).length, { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(1);
    const samNote = (await snapshot(sam))[0];
    expect(samNote.text).toBe('Hello Sam');

    // Sam edits it; Maya sees the edit.
    await sam.locator(noteSelector).dblclick();
    await sam.keyboard.press('End');
    await sam.keyboard.type(' — edited by Sam');
    await sam.keyboard.press('Escape');
    await expect.poll(async () => {
      const notes = await snapshot(maya);
      return notes[0]?.text ?? '';
    }, { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe('Hello Sam — edited by Sam');

    await ctxMaya.close();
    await ctxSam.close();
  });

  test('TC-27: bad link recovery — unknown board → not found → fresh board', async ({ page }) => {
    // A board id that was never created.
    const unknownId = newBoardId();
    await page.goto(`/b/${unknownId}`);

    // GET /api/boards/:id → 404 → Board not found.
    await expect(page.getByRole('heading', { name: 'Board not found' })).toBeVisible();

    // Click New board → a fresh empty board.
    await page.getByRole('button', { name: 'New board' }).click();
    await waitForBoardReady(page);
    expect(page.url()).toMatch(/\/b\/[A-Za-z0-9_-]{22}$/);
    expect(page.url()).not.toContain(unknownId);
    expect(await snapshot(page)).toHaveLength(0);
  });

  test('TC-28: flaky service on open — retries, then opens without reload', async ({ page, browserName }) => {
    chromiumOnly(browserName);

    const boardId = await apiCreateBoard();

    // Abort the existence-check requests while the page loads.
    await page.route('**/api/boards/*', (route) => route.abort());
    await page.goto(`/b/${boardId}`);
    await expect(page.getByText("Couldn't reach vidi6. Retrying…")).toBeVisible();

    // Service recovers: the next backoff attempt succeeds, no reload needed.
    await page.unroute('**/api/boards/*');
    await waitForBoardReady(page);
    expect(page.url()).toContain(`/b/${boardId}`);
    expect(await snapshot(page)).toHaveLength(0);
  });

  test('TC-29: clipboard blocked — manual-copy fallback with the full link selected', async ({
    browser,
  }) => {
    // Make writeText reject in every document.
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: () => Promise.reject(new Error('blocked')) },
        configurable: true,
      });
    });
    const page = await ctx.newPage();

    const boardId = await apiCreateBoard();
    await page.goto(`/b/${boardId}`);
    await waitForBoardReady(page);

    await page.getByRole('button', { name: 'Share' }).click();
    const dialog = page.getByRole('dialog');
    const link = await dialog.getByRole('textbox').inputValue();
    expect(link).toBe(new URL(`/b/${boardId}`, E2E_BASE_URL).toString());

    await page.getByRole('button', { name: 'Copy link' }).click();

    // The manual-copy message is shown…
    await expect(dialog.getByText('Press Ctrl+C (Cmd+C on Mac) to copy')).toBeVisible();
    // …and the input is fully selected (selection spans the whole link).
    const selection = await dialog.getByRole('textbox').evaluate((el) => {
      const input = el as HTMLInputElement;
      return { start: input.selectionStart, end: input.selectionEnd, value: input.value };
    });
    expect(selection.start).toBe(0);
    expect(selection.end).toBe(selection.value.length);
    expect(selection.value).toBe(link);

    await ctx.close();
  });

  test('TC-31: pre-existing (legacy) board opens with its notes', async ({ browser, browserName }) => {
    chromiumOnly(browserName);

    // Seed legacy storage: updates rows, no storage_meta / created_at.
    const boardId = newBoardId();
    const doc = new Y.Doc();
    initDoc(doc);
    const colors = Object.keys(STICKY_COLORS) as StickyColor[];
    for (let i = 0; i < 5; i++) {
      createSticky(doc, { x: i * 220, y: 0 }, colors[i % colors.length]);
    }
    const update = Y.encodeStateAsUpdate(doc);
    const seedRes = await fetch(`${E2E_BASE_URL}/__test/boards/${boardId}/legacy-seed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updatesB64: [Buffer.from(update).toString('base64')] }),
    });
    const seedBody = (await seedRes.json()) as { ok: boolean };
    expect(seedBody.ok).toBe(true);

    // The seed touched the DO instance (loading an empty doc in memory);
    // reset it so the next load reads the freshly seeded storage — exactly
    // the "fresh instance over pre-existing legacy storage" scenario.
    const resetRes = await fetch(`${E2E_BASE_URL}/__test/boards/${boardId}/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect((await resetRes.json()).ok).toBe(true);

    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await page.goto(`/b/${boardId}`);

    // Not "Board not found" — the board loads with its seeded notes
    // (poll: the initial server state message lands right after connect).
    await waitForBoardReady(page);
    await expect.poll(async () => (await snapshot(page)).length, { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(5);

    // It is editable: a new note appears. Screen (100,600) is world
    // (−540,200) at the default centred camera — clear of the seeded row.
    await page.mouse.dblclick(100, 600);
    await page.keyboard.type('After legacy');
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await snapshot(page)).length, { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(6);

    await ctx.close();
  });
});
