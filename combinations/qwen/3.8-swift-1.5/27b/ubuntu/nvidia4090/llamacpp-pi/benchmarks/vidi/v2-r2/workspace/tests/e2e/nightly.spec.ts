import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';
import { E2E_EVENTUAL_TIMEOUT_MS, LIVE_UPDATE_LATENCY_BUDGET_MS, MAX_CONCURRENT_EDITORS } from '../../src/shared/config';

test.describe('Story 3: Nightly e2e (TC-29, TC-30) @nightly', () => {
  test.describe.configure({ mode: 'serial' });

  test('TC-29: idle connection stability - badge never shows Reconnecting for 45s', async ({ browser }) => {
    const boardId = newBoardId();
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    await pageA.goto(`/b/${boardId}`);
    await pageB.goto(`/b/${boardId}`);
    await pageA.waitForFunction(() => (window as any).__vidi6?.connectionState === 'connected', { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    await pageB.waitForFunction(() => (window as any).__vidi6?.connectionState === 'connected', { timeout: E2E_EVENTUAL_TIMEOUT_MS });

    // Wait 45 seconds with no activity
    // Check periodically that the state never leaves 'connected'
    const startTime = Date.now();
    const checkInterval = 5000; // check every 5s
    while (Date.now() - startTime < 45000) {
      await new Promise(r => setTimeout(r, checkInterval));
      const stateA = await pageA.evaluate(() => (window as any).__vidi6?.connectionState);
      const stateB = await pageB.evaluate(() => (window as any).__vidi6?.connectionState);
      expect(stateA).toBe('connected');
      expect(stateB).toBe('connected');
    }

    // Badge should never have shown "Reconnecting…"
    const badge = pageA.locator('[role="status"]');
    await expect(badge).not.toBeVisible();

    console.log('TC-29: 45s idle - connection stable');
    await ctxA.close();
    await ctxB.close();
  });

  test('TC-30: capacity soak - MAX_CONCURRENT_EDITORS contexts, 60s continuous edits', async ({ browser }) => {
    const boardId = newBoardId();
    const contexts: BrowserContext[] = [];
    const pages: Page[] = [];

    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.goto(`/b/${boardId}`);
      await page.waitForFunction(() => (window as any).__vidi6?.connectionState === 'connected', { timeout: E2E_EVENTUAL_TIMEOUT_MS });
      contexts.push(ctx);
      pages.push(page);
    }

    // Continuous random edits for 60s
    const startTime = Date.now();
    let editCount = 0;

    // Run edits in parallel for 60 seconds
    const editPromises = pages.map(async (page) => {
      while (Date.now() - startTime < 60000) {
        // Create a note
        const x = 100 + Math.random() * 500;
        const y = 100 + Math.random() * 500;
        await page.mouse.dblclick(x, y);
        await page.keyboard.type(`n${editCount}`, { delay: 10 });
        await page.keyboard.press('Escape');
        editCount++;

        // Small delay between edits
        await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));
      }
    });

    await Promise.all(editPromises);

    // Wait for final convergence
    await expect.poll(async () => {
      const snaps = await Promise.all(pages.map(p =>
        p.evaluate(() => (window as any).__vidi6?.snapshot?.() ?? [])
      ));
      if (snaps.some(s => s.length === 0)) return false;
      const key = (n: any) => `${n.id}|${n.x.toFixed(1)}|${n.y.toFixed(1)}|${n.color}|${n.text}`;
      const first = snaps[0].map(key).sort();
      return snaps.every(s => JSON.stringify(s.map(key).sort()) === JSON.stringify(first));
    }, { timeout: E2E_EVENTUAL_TIMEOUT_MS * 2 }).toBeTruthy();

    // Final snapshots are identical
    const finalSnaps = await Promise.all(pages.map(p =>
      p.evaluate(() => (window as any).__vidi6?.snapshot?.() ?? [])
    ));
    const key = (n: any) => `${n.id}|${n.x.toFixed(1)}|${n.y.toFixed(1)}|${n.color}|${n.text}`;
    const firstKeys = finalSnaps[0].map(key).sort();
    for (let i = 1; i < finalSnaps.length; i++) {
      expect(JSON.stringify(finalSnaps[i].map(key).sort())).toBe(JSON.stringify(firstKeys));
    }

    console.log(`TC-30: ${MAX_CONCURRENT_EDITORS} participants, ${editCount} edits in 60s, all converged`);
    console.log(`  [latency] p50: N/A, p95: N/A, max: N/A (budget: ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms)`);

    for (const ctx of contexts) await ctx.close();
  });
});
