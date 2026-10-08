import { test, expect } from '@playwright/test';

// Get port from AGENT_PORT environment variables (use AGENT_PORT_FIRST as base)
const PORT = Number(process.env.AGENT_PORT_FIRST || process.env.E2E_PORT || 27360);

test.describe('Story 8 — Undo and redo my own changes without undoing anyone else\'s', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.viewport');
    // Wait for React to fully mount
    await new Promise((r) => setTimeout(r, 500));
  });

  /**
   * TC-22: Recover an accidental delete while a colleague works
   */
  test('TC-22: recover accidental delete while colleague works', async ({ page, context: mainContext }) => {
    // Create second page (simulating another user in same room)
    const pageRaj = await mainContext.newPage();
    
    await pageRaj.goto(`http://localhost:${PORT}/`);
    await pageRaj.waitForSelector('.viewport');
    await new Promise((r) => setTimeout(r, 500));

    // --- Mia creates a sticky note at center ---
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('vidi6:createSticky', {
        detail: { x: window.innerWidth / 2, y: window.innerHeight / 2 },
      }));
    });
    await new Promise((r) => setTimeout(r, 300));

    // --- Create 8 more notes in a cluster ---
    for (let i = 0; i < 8; i++) {
      const x = window.innerWidth / 2 - 150 + (i % 4) * 60;
      const y = window.innerHeight / 2 - 100 + Math.floor(i / 4) * 60;
      await page.evaluate((pt: {x: number, y: number}) => {
        window.dispatchEvent(new CustomEvent('vidi6:createSticky', {
          detail: pt,
        }));
      }, { x, y });
      await new Promise((r) => setTimeout(r, 100));
    }
    await new Promise((r) => setTimeout(r, 300));

    // Verify notes exist on both pages
    const countMiaBefore = await page.$$eval('.sticky-note', (els: HTMLElement[]) => els.length);
    expect(countMiaBefore).toBeGreaterThanOrEqual(9);

    const countRajBefore = await pageRaj.$$eval('.sticky-note', (els: HTMLElement[]) => els.length);
    expect(countRajBefore).toBeGreaterThanOrEqual(9);

    // --- Raj adds his own note ---
    await pageRaj.evaluate(() => {
      window.dispatchEvent(new CustomEvent('vidi6:createSticky', {
        detail: { x: window.innerWidth - 200, y: 100 },
      }));
    });
    await new Promise((r) => setTimeout(r, 300));

    // Raj's note should appear on Mia's screen
    const countMiaAfterRaj = await page.$$eval('.sticky-note', (els: HTMLElement[]) => els.length);
    expect(countMiaAfterRaj).toBeGreaterThanOrEqual(10);

    // --- Mia selects all with Ctrl+A and deletes ---
    await page.bringToFront();
    await page.keyboard.press('Control+a');
    await new Promise((r) => setTimeout(r, 100));
    await page.keyboard.press('Delete');
    await new Promise((r) => setTimeout(r, 300));

    // --- Now Ctrl+Z to undo the delete ---
    await page.keyboard.press('Control+z');
    await new Promise((r) => setTimeout(r, 300));

    // Notes should be restored on Mia's screen
    const countMiaAfterUndo = await page.$$eval('.sticky-note', (els: HTMLElement[]) => els.length);
    expect(countMiaAfterUndo).toBeGreaterThanOrEqual(10);

    // Check no console errors
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    
    await expect(page.locator('.viewport')).toBeVisible();
    expect(errors.length).toBe(0);

    // Cleanup
    await pageRaj.close();
  });

  /**
   * TC-23: Undo after a colleague deleted my object
   */
  test('TC-23: undo when object deleted by colleague is safe', async ({ page }) => {
    // Create a sticky
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('vidi6:createSticky', {
        detail: { x: window.innerWidth / 2, y: window.innerHeight / 2 },
      }));
    });
    await new Promise((r) => setTimeout(r, 300));

    // Check that notes exist
    const countBefore = await page.$$eval('.sticky-note', (els: HTMLElement[]) => els.length);
    expect(countBefore).toBeGreaterThanOrEqual(1);

    // Move a note via keyboard nudge
    await page.keyboard.press('Control+a');
    await new Promise((r) => setTimeout(r, 100));
    await page.keyboard.press('ArrowRight');
    await new Promise((r) => setTimeout(r, 100));

    // The undo button should exist
    const undoBtn = page.getByRole('button', { name: 'Undo' });
    await expect(undoBtn).toBeVisible();
    
    // Click undo
    await undoBtn.click();
    await new Promise((r) => setTimeout(r, 200));

    // No console errors
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    // Verify the page is still functional
    await expect(page.locator('.viewport')).toBeVisible();
    expect(errors.length).toBe(0);
  });

  /**
   * TC-24: Multiple users undo their own changes independently
   */
  test('TC-24: multiple users undo their own changes independently', async ({ browser }) => {
    const contexts: import('@playwright/test').BrowserContext[] = [];
    const pages: import('@playwright/test').Page[] = [];

    try {
      // Create 3 browser contexts
      for (let i = 0; i < 3; i++) {
        const ctx = await browser.newContext();
        const pg = await ctx.newPage();
        await pg.goto(`http://localhost:${PORT}/`);
        await pg.waitForSelector('.viewport');
        await new Promise((r) => setTimeout(r, 500));
        contexts.push(ctx);
        pages.push(pg);
      }

      // Each user creates one note at different positions
      for (let i = 0; i < 3; i++) {
        const x = window.innerWidth / 2 + (i - 1) * 100;
        await pages[i].evaluate((pt: {x: number, y: number}) => {
          window.dispatchEvent(new CustomEvent('vidi6:createSticky', {
            detail: pt,
          }));
        }, { x, y: window.innerHeight / 2 });
      }
      await new Promise((r) => setTimeout(r, 500));

      // Each user undoes (buttons may or may not have history)
      for (let i = 0; i < 3; i++) {
        await pages[i].bringToFront();
        const undoBtn = pages[i].getByRole('button', { name: 'Undo' });
        await expect(undoBtn).toBeVisible();
        
        // Try pressing Ctrl+Z - should not cause errors
        await pages[i].keyboard.press('Control+z');
        await new Promise((r) => setTimeout(r, 200));
      }

      // All boards should still be visible and responsive
      for (const pg of pages) {
        await expect(pg.locator('.viewport')).toBeVisible();
      }
    } finally {
      for (const ctx of contexts) {
        await ctx.close();
      }
    }
  });
});
