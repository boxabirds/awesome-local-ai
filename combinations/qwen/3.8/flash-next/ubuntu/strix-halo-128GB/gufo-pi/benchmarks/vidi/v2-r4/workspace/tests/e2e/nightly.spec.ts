import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  E2E_EVENTUAL_TIMEOUT_MS,
  LIVE_UPDATE_LATENCY_BUDGET_MS,
  MAX_CONCURRENT_EDITORS,
} from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';
import {
  notes,
  noteAt,
  noteText,
  doubleClickToCreate,
  clickEmptyBoard,
  dragNoteBy,
  typeText,
  swatch,
} from './helpers/sticky';
import { board } from './helpers/board';

/**
 * Nightly tests: idle connection stability and capacity soak.
 * These are tagged @nightly and skipped by default to keep CI fast.
 */
test.describe('nightly: idle stability and capacity (story 3)', () => {
  test('@nightly TC-29: idle connection stays alive for 45s without showing Reconnecting', async ({ browser }) => {
    const boardId = newBoardId();
    const url = `/b/${boardId}`;

    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    await page1.goto(url);
    await expect(board(page1)).toBeVisible();
    await page1.waitForFunction(() => {
      const api = (window as any).__vidi6;
      return api && api.connectionState === 'connected';
    }, undefined, { timeout: E2E_EVENTUAL_TIMEOUT_MS });

    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await page2.goto(url);
    await expect(board(page2)).toBeVisible();
    await page2.waitForFunction(() => {
      const api = (window as any).__vidi6;
      return api && api.connectionState === 'connected';
    }, undefined, { timeout: E2E_EVENTUAL_TIMEOUT_MS });

    // Wait 45 seconds with no activity
    await page1.waitForTimeout(45_000);

    // Badge never shows "Reconnecting…"
    await expect(page1.locator('.connection-status.reconnecting')).not.toBeVisible();
    await expect(page2.locator('.connection-status.reconnecting')).not.toBeVisible();

    // Both still show "connected" state
    const state1 = await page1.evaluate(() => (window as any).__vidi6?.connectionState);
    const state2 = await page2.evaluate(() => (window as any).__vidi6?.connectionState);
    expect(state1).toBe('connected');
    expect(state2).toBe('connected');

    // Verify sync still works after idle
    await doubleClickToCreate(page1, 400, 300);
    await typeText(page1, 'still-alive');
    await clickEmptyBoard(page1);

    await expect.poll(() => notes(page2).count(), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(1);
    await expect(noteText(page2, 0)).toHaveText('still-alive');

    await ctx1.close();
    await ctx2.close();
  });

  test('@nightly TC-30: capacity soak - MAX_CONCURRENT_EDITORS doing random edits for 60s', async ({ browser }) => {
    const boardId = newBoardId();
    const url = `/b/${boardId}`;
    const contexts: BrowserContext[] = [];
    const pages: Page[] = [];

    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
      const ctx = await browser.newContext();
      contexts.push(ctx);
      const page = await ctx.newPage();
      await page.goto(url);
      await expect(board(page)).toBeVisible();
      await page.waitForFunction(() => {
        const api = (window as any).__vidi6;
        return api && api.connectionState === 'connected';
      }, undefined, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
      pages.push(page);
    }

    const colors = ['yellow', 'blue', 'pink', 'green'] as const;
    const soakDurationMs = 60_000;
    const startTime = Date.now();
    const latencySamples: number[] = [];

    // Perform continuous random edits for 60 seconds
    while (Date.now() - startTime < soakDurationMs) {
      // Pick a random page
      const pageIndex = Math.floor(Math.random() * MAX_CONCURRENT_EDITORS);
      const page = pages[pageIndex];
      const otherPage = pages[(pageIndex + 1) % MAX_CONCURRENT_EDITORS];

      const action = Math.random();
      const noteCount = await notes(page).count();

      if (action < 0.3 && noteCount < 20) {
        // Create a note (if we don't have too many)
        const x = 200 + Math.random() * 600;
        const y = 200 + Math.random() * 400;
        await doubleClickToCreate(page, x, y);
        await typeText(page, `r${Date.now().toString(36)}`);
        await clickEmptyBoard(page);
      } else if (action < 0.6 && noteCount > 0) {
        // Move a note
        const idx = Math.floor(Math.random() * noteCount);
        const dx = Math.floor(Math.random() * 100 - 50);
        const dy = Math.floor(Math.random() * 100 - 50);
        await dragNoteBy(noteAt(page, idx), { x: 50, y: 25 }, { x: dx, y: dy });
      } else if (action < 0.8 && noteCount > 0) {
        // Recolour
        const idx = Math.floor(Math.random() * noteCount);
        await noteAt(page, idx).click();
        const color = colors[Math.floor(Math.random() * colors.length)];
        await swatch(page, color).click();
      } else if (noteCount > 2) {
        // Delete a note (only if there are some)
        const idx = Math.floor(Math.random() * noteCount);
        await noteAt(page, idx).click();
        await page.keyboard.press('Delete');
        await page.waitForTimeout(50);
      }

      // Sample latency: check if the other page received the update
      const before = await notes(otherPage).count();
      await page.waitForTimeout(100);
      const after = await notes(otherPage).count();
      if (before !== after) {
        latencySamples.push(Date.now() - startTime);
      }
    }

    // Log latency statistics
    if (latencySamples.length > 0) {
      const sorted = [...latencySamples].sort((a, b) => a - b);
      const p50 = sorted[Math.floor(sorted.length * 0.5)];
      const p95 = sorted[Math.floor(sorted.length * 0.95)];
      const max = sorted[sorted.length - 1];
      console.log(`Latency report (n=${latencySamples.length}): p50=${p50}ms p95=${p95}ms max=${max}ms (budget: ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms)`);
    }

    // Final convergence check: wait for all pages to have the same count
    await expect.poll(async () => {
      const counts = await Promise.all(pages.map(p => notes(p).count()));
      return new Set(counts).size;
    }, { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(1);

    // Final snapshots identical (ignoring local selection state)
    const getSyncSnapshot = async (p: Page) => {
      return p.evaluate(() => {
        const els = document.querySelectorAll('[data-testid="sticky-note"]');
        return Array.from(els).map(el => {
          const h = el as HTMLElement;
          return JSON.stringify({
            id: h.dataset.noteId,
            x: h.dataset.worldX,
            y: h.dataset.worldY,
            z: h.dataset.z,
            color: h.dataset.color,
            text: h.querySelector('[data-testid="sticky-note-text"]')?.textContent ?? '',
          });
        }).sort();
      });
    };

    const snapshots = await Promise.all(pages.map(p => getSyncSnapshot(p)));
    for (let i = 1; i < snapshots.length; i++) {
      expect(snapshots[i]).toEqual(snapshots[0]);
    }

    for (const ctx of contexts) await ctx.close();
  });
});
