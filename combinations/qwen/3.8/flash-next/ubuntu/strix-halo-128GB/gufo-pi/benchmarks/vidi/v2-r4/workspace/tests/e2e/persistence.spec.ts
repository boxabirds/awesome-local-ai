/**
 * E2E tests for board persistence (story 4).
 * TC-19: Overnight return
 * TC-20: Leave immediately
 * TC-21: Large board load
 * TC-24: Broken board
 */
import { expect, test } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';
import { PERSIST_TESTED_NOTES } from '../../src/shared/config';
import {
  notes,
  noteText,
  doubleClickToCreate,
  clickEmptyBoard,
  typeText,
  createStickyButton,
} from './helpers/sticky';
import { board } from './helpers/board';

/** Wait for the connection to be in 'connected' state. */
async function waitForConnected(page: import('@playwright/test').Page) {
  await page.waitForFunction(() => {
    const api = (window as any).__vidi6;
    return api && api.connectionState === 'connected';
  }, undefined, { timeout: 10_000 });
}

test.describe('TC-19: Overnight return', () => {
  test('board content survives page close and reload', async ({ browser }) => {
    const boardId = newBoardId();
    const url = `/b/${boardId}`;

    // Session 1: create notes
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    await page1.goto(url);
    await expect(board(page1)).toBeVisible();
    await waitForConnected(page1);

    // Create 5 notes with text - spread positions to avoid overlap
    for (let i = 0; i < 5; i++) {
      await doubleClickToCreate(page1, 200 + i * 250, 200 + i * 120);
      await typeText(page1, `note ${i}`);
      await clickEmptyBoard(page1);
      await page1.waitForTimeout(100);
    }
    await page1.waitForTimeout(500);
    const created = await notes(page1).count();
    expect(created).toBe(5);

    // Close the page (simulates user leaving)
    await ctx1.close();

    // Wait for potential DO eviction
    await new Promise(r => setTimeout(r, 1000));

    // Session 2: return and verify
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await page2.goto(url);
    await expect(board(page2)).toBeVisible();
    await waitForConnected(page2);

    await expect(notes(page2)).toHaveCount(5, { timeout: 10_000 });
    for (let i = 0; i < 5; i++) {
      await expect(noteText(page2, i)).toContainText(`note ${i}`);
    }

    await ctx2.close();
  });
});

test.describe('TC-20: Leave immediately', () => {
  test('note seen by another client survives both disconnecting', async ({ browser }) => {
    const boardId = newBoardId();
    const url = `/b/${boardId}`;

    // Two browsers connect
    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    await pageA.goto(url);
    await waitForConnected(pageA);

    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await pageB.goto(url);
    await waitForConnected(pageB);

    // A creates a note
    await doubleClickToCreate(pageA, 400, 300);
    await typeText(pageA, 'survivor');
    await clickEmptyBoard(pageA);

    // B sees it
    await expect(notes(pageB)).toHaveCount(1, { timeout: 5000 });
    await expect(noteText(pageB, 0)).toContainText('survivor');

    // Close both
    await ctxA.close();
    await ctxB.close();

    await new Promise(r => setTimeout(r, 1000));

    // Reopen one - the note is still there
    const ctxC = await browser.newContext();
    const pageC = await ctxC.newPage();
    await pageC.goto(url);
    await waitForConnected(pageC);

    await expect(notes(pageC)).toHaveCount(1, { timeout: 10_000 });
    await expect(noteText(pageC, 0)).toContainText('survivor');

    await ctxC.close();
  });
});

test.describe('TC-21: Large board open', () => {
  test('board with many notes renders all of them', async ({ browser }) => {
    test.slow(); // Large board takes time to create and render

    const boardId = newBoardId();
    const url = `/b/${boardId}`;
    const NOTE_COUNT = Math.min(PERSIST_TESTED_NOTES, 100); // Use 100 for e2e speed

    // Seed the board via first context
    const ctxSeed = await browser.newContext();
    const pageSeed = await ctxSeed.newPage();
    await pageSeed.goto(url);
    await waitForConnected(pageSeed);

    // Create notes via toolbar (faster than double-click)
    for (let i = 0; i < NOTE_COUNT; i++) {
      await createStickyButton(pageSeed).click();
      await pageSeed.keyboard.press('Escape');
    }
    await pageSeed.waitForTimeout(2000);

    const createdCount = await notes(pageSeed).count();
    expect(createdCount).toBe(NOTE_COUNT);
    await ctxSeed.close();

    await new Promise(r => setTimeout(r, 1000));

    // Open in fresh context
    const ctxFresh = await browser.newContext();
    const pageFresh = await ctxFresh.newPage();
    const start = Date.now();
    await pageFresh.goto(url);
    await waitForConnected(pageFresh);

    // Wait for all notes to render
    await expect(notes(pageFresh)).toHaveCount(NOTE_COUNT, { timeout: 15_000 });
    const loadTime = Date.now() - start;
    console.log(`TC-21: Loaded ${NOTE_COUNT} notes in ${loadTime}ms`);

    await ctxFresh.close();
  });
});

test.describe('TC-24: Broken board', () => {
  test('corrupted board shows load-failed message and locks editing', async ({ browser }) => {
    const boardId = newBoardId();
    const url = `/b/${boardId}`;

    // First, seed the board with a note so it has content
    const ctxSeed = await browser.newContext();
    const pageSeed = await ctxSeed.newPage();
    await pageSeed.goto(url);
    await waitForConnected(pageSeed);
    await doubleClickToCreate(pageSeed, 400, 300);
    await typeText(pageSeed, 'real content');
    await clickEmptyBoard(pageSeed);
    await pageSeed.waitForTimeout(500);
    await ctxSeed.close();

    // Corrupt the board via test endpoint
    const base = process.env.E2E_BASE_URL ?? 'http://localhost:8787';
    const resp = await fetch(`${base}/api/test-hooks/corrupt-board?boardId=${boardId}`, { method: 'POST' });
    expect(resp.ok).toBe(true);

    // Wait for the state to settle
    await new Promise(r => setTimeout(r, 1000));

    // Try to open the board - should see the load-failed message
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await page2.goto(url);

    // Should show red load-failed message
    await expect(page2.locator('.connection-status.load-failed')).toBeVisible({ timeout: 10_000 });
    await expect(page2.locator('.connection-status.load-failed')).toContainText("couldn't be loaded");

    // Editing should be blocked: clicking Sticky note button creates no note
    const noteCountBefore = await notes(page2).count();
    await createStickyButton(page2).click();
    await page2.waitForTimeout(500);
    const noteCountAfter = await notes(page2).count();
    expect(noteCountAfter).toBe(noteCountBefore);

    // Now repair the board and connect again (after LOAD_RETRY_MIN_INTERVAL_MS)
    const repairResp = await fetch(`${base}/api/test-hooks/repair-board?boardId=${boardId}`, { method: 'POST' });
    expect(repairResp.ok).toBe(true);

    // Wait past the retry interval
    await page2.waitForTimeout(6000);

    // Reopen in a new context
    await ctx2.close();
    const ctx3 = await browser.newContext();
    const page3 = await ctx3.newPage();
    await page3.goto(url);
    await waitForConnected(page3);

    // Board is editable again and has the original content restored
    await expect(notes(page3)).toHaveCount(1, { timeout: 5000 });
    await expect(noteText(page3, 0)).toContainText('real content');

    // Create a new note
    await doubleClickToCreate(page3, 500, 400);
    await typeText(page3, 'new after repair');
    await clickEmptyBoard(page3);
    await expect(notes(page3)).toHaveCount(2, { timeout: 5000 });

    await ctx3.close();
  });
});
