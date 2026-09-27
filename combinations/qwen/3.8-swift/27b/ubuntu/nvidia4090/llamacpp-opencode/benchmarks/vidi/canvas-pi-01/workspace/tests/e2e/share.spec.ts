// Story 5 e2e (TC-26 to TC-31): the shared-board workflows end to end against
// `wrangler dev` (see playwright.config.ts; TEST_HOOKS=1 is set there).
//
// Browser coverage per the tasks: TC-26/28/30 are chromium-only (clipboard
// permissions, request routing, rate-limit drain); TC-27 and TC-29 run in
// chromium, firefox and webkit.
//
// Board setup: except where the workflow under test IS creation (TC-26,
// TC-27, TC-30), boards are created through the test-only
// /__test/boards/create hook, which bypasses the BOARD_CREATE_LIMIT rate
// limiter — parallel specs would otherwise exhaust the shared per-IP window.

import { expect, test, type Page } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';
import { BOARD_CREATE_LIMIT, CREATE_BUDGET_MS } from '../../src/shared/config';
import { createBoardViaHook, homeViewReady, openBoard } from './helpers/board';
import { createNote, noteCount, noteTexts } from './helpers/participants';

/** Type into the note createNote left in editing, then commit with Escape. */
async function typeInEditingNote(page: Page, text: string): Promise<void> {
  await page.keyboard.type(text);
  await page.keyboard.press('Escape');
}

/**
 * Click a create button and wait for the /b/<id> navigation. If the shared
 * per-IP rate limiter still holds a spent window (e.g. from a previous
 * run's TC-30 drain — reuseExistingServer keeps the dev server warm), retry
 * until the 60 s window has rolled over. Returns the board id and the
 * elapsed time of the successful create (the create budget assertion).
 */
async function createViaUi(
  page: Page,
  buttonName: string,
  reachPage: () => Promise<void>,
): Promise<{ boardId: string; elapsedMs: number }> {
  for (let attempt = 0; attempt < 12; attempt++) {
    await reachPage();
    const startedAt = Date.now();
    await page.getByRole('button', { name: buttonName }).click();
    // SPA pushState navigation: poll the URL (waitForURL does not resolve
    // for history.pushState in this Playwright version).
    const navigated = await expect
      .poll(() => page.url(), { timeout: 5000 })
      .toMatch(/\/b\/[A-Za-z0-9_-]{22}$/)
      .then(() => true)
      .catch(() => false);
    if (navigated) {
      const boardId = /\/b\/([A-Za-z0-9_-]{22})$/.exec(page.url())![1];
      return { boardId, elapsedMs: Date.now() - startedAt };
    }
    // The only non-navigation outcome for a valid click is the 429 state.
    await expect(page.getByText(/creating boards too quickly/)).toBeVisible();
    await page.waitForTimeout(15_000); // let the 60 s window roll over
  }
  throw new Error('create stayed rate-limited across retries');
}

/** Open the Share panel and click Copy link; resolves once "Link copied" is up. */
async function copyBoardLink(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Share' }).click();
  await page.getByRole('button', { name: 'Copy link' }).click();
  await expect(page.getByRole('button', { name: 'Link copied' })).toBeVisible();
}

// Serial: TC-26/TC-27 create real boards (counting against the shared
// per-IP rate limiter) while TC-30 drains that same limiter — overlapping
// them would hand the other tests a 429.
test.describe('story 5: share a board with a link', () => {
  test.describe.configure({ mode: 'serial' });

  test('TC-26 create, share, join: Maya creates + notes, Sam joins via the link and edits', async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const mayaCtx = await browser.newContext();
    const maya = await mayaCtx.newPage();
    maya.setDefaultTimeout(30_000);
    // Headless clipboard grants are unreliable across Playwright/Chromium
    // versions; record writeText so the copied link can be asserted.
    await maya.addInitScript(() => {
      let captured = '';
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: (text: string) => ((captured = text), Promise.resolve()) },
        configurable: true,
      });
      (window as unknown as { __clipboardText: () => string }).__clipboardText = () => captured;
    });

    // Maya: Create a board — board visible within the create budget.
    const { boardId, elapsedMs } = await createViaUi(maya, 'Create a board', async () => {
      await maya.goto('/');
    });
    await homeViewReady(maya);
    expect(elapsedMs).toBeLessThan(CREATE_BUDGET_MS);

    // Maya adds a note with recognisable text.
    await createNote(maya);
    await typeInEditingNote(maya, 'Maya says hello');
    await expect.poll(() => noteCount(maya)).toBe(1);
    await expect.poll(() => noteTexts(maya)).toEqual(['Maya says hello']);

    // Share → Copy link → "Link copied"; the copied text is the full link.
    await copyBoardLink(maya);
    const link = await maya.evaluate(() => (
      window as unknown as { __clipboardText: () => string }
    ).__clipboardText());
    expect(link).toBe(new URL(maya.url()).origin + `/b/${boardId}`);

    // Sam: a brand-new context opens the copied link — same board, same note.
    const samCtx = await browser.newContext();
    const sam = await samCtx.newPage();
    sam.setDefaultTimeout(30_000);
    await sam.goto(link);
    await homeViewReady(sam);
    await expect.poll(() => noteTexts(sam)).toEqual(['Maya says hello']);

    // Sam edits: his new note and its text reach Maya. (The tight 1 s
    // live-update budget is asserted in live-collaboration.spec; here a
    // generous window keeps this workflow test load-tolerant.)
    await createNote(sam);
    await typeInEditingNote(sam, 'Sam is here too');
    await expect
      .poll(() => noteTexts(maya), { timeout: 5_000 })
      .toEqual(['Maya says hello', 'Sam is here too']);

    await mayaCtx.close();
    await samCtx.close();
  });

  test('TC-27 bad link recovery: unknown id → not found → Create a new board', async ({ page }) => {
    const badId = newBoardId();
    await page.goto(`/b/${badId}`);
    await expect(page.getByText('Board not found')).toBeVisible();
    await expect(page.getByText('Check the link, or ask the person who shared it to send it again.')).toBeVisible();

    const { elapsedMs } = await createViaUi(page, 'Create a new board', async () => {
      await page.goto(`/b/${badId}`);
    });
    await homeViewReady(page);
    expect(elapsedMs).toBeLessThan(CREATE_BUDGET_MS);
    expect(await noteCount(page)).toBe(0);
  });

  test('TC-28 flaky service on open: retries until the API answers, no reload', async ({ page, request }) => {
    const boardId = await createBoardViaHook(request);
    await page.route('**/api/boards/**', (route) => route.abort());

    await page.goto(`/b/${boardId}`);
    await expect(page.getByText(/Couldn’t reach vidi6\. Retrying/)).toBeVisible();

    // Only navigations after the failure state count as reloads.
    let reloaded = false;
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) reloaded = true;
    });

    // The API recovers: the next backoff retry succeeds on the same page.
    await page.unroute('**/api/boards/**');
    await homeViewReady(page);
    expect(reloaded).toBe(false);
  });

  test('TC-29 clipboard blocked: manual-copy fallback with the full link selected', async ({
    page,
    request,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: () => Promise.reject(new Error('blocked')) },
        configurable: true,
      });
    });

    const boardId = await createBoardViaHook(request);
    await openBoard(page, boardId);
    await page.getByRole('button', { name: 'Share' }).click();
    await page.getByRole('button', { name: 'Copy link' }).click();

    // writeText rejected → the manual-copy fallback is up.
    await expect(page.getByText('Press Ctrl+C (Cmd+C on Mac) to copy')).toBeVisible();
    const input = page.getByRole('textbox', { name: 'Board link' });
    const selection = await input.evaluate((el) => {
      const inputEl = el as HTMLInputElement;
      return { value: inputEl.value, start: inputEl.selectionStart, end: inputEl.selectionEnd };
    });
    expect(selection.value).toBe(new URL(page.url()).origin + `/b/${boardId}`);
    expect(selection.start).toBe(0);
    expect(selection.end).toBe(selection.value.length);
  });

  test('TC-30 abuse guard: once the create budget is spent, the UI shows the rate-limit message', async ({
    page,
    request,
  }) => {
    // Drain the shared per-IP budget (other specs' real creations may have
    // spent part of it): POST until the limiter answers 429.
    for (let i = 0; i < BOARD_CREATE_LIMIT; i++) {
      const res = await request.post('/api/boards');
      if (res.status() === 429) break;
      expect(res.ok(), `drain POST #${i + 1} should create`).toBe(true);
    }

    await page.goto('/');
    await page.getByRole('button', { name: 'Create a board' }).click();
    await expect(
      page.getByText("You're creating boards too quickly. Wait a minute and try again."),
    ).toBeVisible();
    // Still on home: no navigation happened.
    expect(page.url()).toBe(`${new URL(page.url()).origin}/`);
  });

  test('TC-31 pre-existing (legacy) board opens with its seeded notes', async ({ page, request }) => {
    const boardId = newBoardId();
    const res = await request.post(`/__test/boards/${boardId}/seed-legacy`);
    expect(res.ok(), 'seed-legacy hook should succeed').toBe(true);

    await page.goto(`/b/${boardId}`);
    await expect(page.getByText('Board not found')).not.toBeVisible();
    await homeViewReady(page);
    await expect.poll(() => noteCount(page)).toBe(3);
  });
});
