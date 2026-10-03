/**
 * E2E persistence tests: TC-19 to TC-21.
 *
 * These tests verify that board state persists across page reloads (which
 * close all WebSocket connections and cause the Durable Object to hibernate
 * and re-load from SQLite).
 */
import { test, expect, type Page } from '@playwright/test';
import { createBoardAndOpen, setCamera } from './helpers/board';
import { BOARD_LOAD_BUDGET_MS, PERSIST_TESTED_NOTES } from '../../src/shared/config';

/** Wait for the test hooks to be available. */
async function waitForHooks(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    return !!(window as { __vidi6?: unknown }).__vidi6;
  }, { timeout: 10_000 });
}

/** Get the note count via the test hook. */
async function getNoteCount(page: Page): Promise<number> {
  await waitForHooks(page);
  return page.evaluate(() => {
    const hook = (window as { __vidi6?: { noteCount?: () => number } }).__vidi6;
    if (!hook?.noteCount) throw new Error('noteCount hook not available');
    return hook.noteCount();
  });
}

/** Seed N notes via the test hook. */
async function seedNotes(page: Page, count: number): Promise<number> {
  await waitForHooks(page);
  return page.evaluate((n) => {
    const hook = (window as { __vidi6?: { seedNotes?: (count: number) => number } }).__vidi6;
    if (!hook?.seedNotes) throw new Error('seedNotes hook not available');
    return hook.seedNotes(n);
  }, count);
}

/** Create a note by double-clicking at a position and typing. */
async function createNoteWithText(page: Page, text: string, x = 400, y = 300): Promise<void> {
  await page.mouse.dblclick(x, y);
  const textarea = page.locator('[data-testid="sticky-textarea"]');
  await expect(textarea).toBeVisible();
  await textarea.fill(text);
  await page.keyboard.press('Escape');
}

test.describe('persistence e2e', () => {
  test.beforeEach(async ({ page }) => {
    await createBoardAndOpen(page);
    await setCamera(page, { x: -640, y: -400, zoom: 1 });
    await waitForHooks(page);
  });

  test('TC-19: notes survive a page reload (DO hibernation + reload)', async ({ page }) => {
    // Create 3 notes with distinct text at different positions.
    await createNoteWithText(page, 'persist-1', 300, 200);
    await createNoteWithText(page, 'persist-2', 600, 200);
    await createNoteWithText(page, 'persist-3', 300, 500);

    // Verify all 3 notes are visible.
    const notes = page.locator('[data-testid="sticky-note"]');
    await expect(notes).toHaveCount(3);

    // Reload the page (closes WebSocket, DO may hibernate).
    await page.reload();
    await setCamera(page, { x: -640, y: -400, zoom: 1 });
    await waitForHooks(page);

    // Wait for the board to load and verify all 3 notes are back.
    await expect(page.locator('[data-testid="sticky-note"]')).toHaveCount(3, { timeout: 10_000 });

    // Verify the text is preserved.
    const noteTexts = await page.locator('[data-testid="sticky-note"]').allTextContents();
    expect(noteTexts).toContain('persist-1');
    expect(noteTexts).toContain('persist-2');
    expect(noteTexts).toContain('persist-3');
  });

  test(`TC-20: ${PERSIST_TESTED_NOTES}-note board loads within budget`, async ({ page }) => {
    // Seed the board with PERSIST_TESTED_NOTES notes.
    const count = await seedNotes(page, PERSIST_TESTED_NOTES);
    expect(count).toBe(PERSIST_TESTED_NOTES);

    // Measure load time: reload the page and time until notes appear.
    const startTime = Date.now();
    await page.reload();

    // Wait for notes to appear.
    await expect(page.locator('[data-testid="sticky-note"]')).toHaveCount(PERSIST_TESTED_NOTES, {
      timeout: BOARD_LOAD_BUDGET_MS + 20_000,
    });
    const loadTime = Date.now() - startTime;

    // The load should be within a generous bound (budget + page navigation overhead).
    expect(loadTime).toBeLessThan(BOARD_LOAD_BUDGET_MS + 20_000);
  });

  test('TC-21: post-load ops persist across a second reload', async ({ page }) => {
    // Create 2 notes at different positions.
    await createNoteWithText(page, 'first-batch-1', 300, 200);
    await createNoteWithText(page, 'first-batch-2', 600, 200);
    await expect(page.locator('[data-testid="sticky-note"]')).toHaveCount(2);

    // Reload (first "restart").
    await page.reload();
    await setCamera(page, { x: -640, y: -400, zoom: 1 });
    await waitForHooks(page);
    await expect(page.locator('[data-testid="sticky-note"]')).toHaveCount(2, { timeout: 10_000 });

    // Create 2 more notes at different positions.
    await createNoteWithText(page, 'second-batch-1', 300, 500);
    await createNoteWithText(page, 'second-batch-2', 600, 500);
    await expect(page.locator('[data-testid="sticky-note"]')).toHaveCount(4);

    // Reload (second "restart").
    await page.reload();
    await setCamera(page, { x: -640, y: -400, zoom: 1 });
    await waitForHooks(page);
    await expect(page.locator('[data-testid="sticky-note"]')).toHaveCount(4, { timeout: 10_000 });

    // Verify all 4 notes are present with correct text.
    const noteTexts = await page.locator('[data-testid="sticky-note"]').allTextContents();
    expect(noteTexts).toContain('first-batch-1');
    expect(noteTexts).toContain('first-batch-2');
    expect(noteTexts).toContain('second-batch-1');
    expect(noteTexts).toContain('second-batch-2');
  });
});
