// @ts-nocheck
// tests/e2e/live-collaboration.spec.ts
// E2E tests for live collaboration: two browser contexts on the same board.
// Requires `wrangler dev` running with the Durable Object (port 8787).

import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';
import { E2E_EVENTUAL_TIMEOUT_MS } from '../../src/shared/config';

const BASE_URL = 'http://localhost:8787';

async function navigateToBoard(page: Page, boardId: string): Promise<void> {
  await page.goto(`${BASE_URL}/b/${boardId}`);
  // Wait for the board to be ready (canvas visible)
  await page.waitForSelector('canvas', { timeout: 10000 });
}

async function waitForConnectionStatus(page: Page, status: string, timeout = 10000): Promise<void> {
  const statusEl = page.locator('[data-testid="connection-status"]');
  if (status === 'connected') {
    // When connected, the badge is hidden
    await expect(statusEl).toBeHidden({ timeout });
  } else {
    await expect(statusEl).toContainText(status, { timeout });
  }
}

async function createStickyOnBoard(page: Page, x: number, y: number): Promise<void> {
  // Double-click on the canvas to create a sticky note
  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas not found');
  
  await page.mouse.dblclick(box.x + x, box.y + y);
  // Wait for the sticky to appear
  await page.waitForSelector('[data-testid="sticky-note"]', { timeout: 5000 });
}

async function countStickyNotes(page: Page): Promise<number> {
  return page.locator('[data-testid="sticky-note"]').count();
}

test.describe('e2e.live: Live collaboration across two browser contexts', () => {
  test.describe.configure({ mode: 'serial' });

  let boardA: { context: BrowserContext; page: Page };
  let boardB: { context: BrowserContext; page: Page };
  let boardId: string;

  test.beforeAll(async ({ browser }) => {
    boardId = newBoardId();
    
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    
    boardA = { context: contextA, page: pageA };
    boardB = { context: contextB, page: pageB };
  });

  test.afterAll(async () => {
    await boardA.context.close();
    await boardB.context.close();
  });

  test('TC-22: A creates sticky → B sees it within E2E_EVENTUAL_TIMEOUT_MS', async () => {
    // Navigate both to the same board
    await navigateToBoard(boardA.page, boardId);
    await navigateToBoard(boardB.page, boardId);

    // Wait for both to be connected
    await waitForConnectionStatus(boardA.page, 'connected');
    await waitForConnectionStatus(boardB.page, 'connected');

    // A creates a sticky
    await createStickyOnBoard(boardA.page, 200, 200);
    
    // B should see it
    await expect.poll(() => countStickyNotes(boardB.page), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
      .toBe(1);
  });

  test('TC-23: A moves sticky → B sees the move', async () => {
    // Get the sticky's position on B
    const stickyB = boardB.page.locator('[data-testid="sticky-note"]').first();
    const posBefore = await stickyB.boundingBox();
    
    // A drags the sticky
    const stickyA = boardA.page.locator('[data-testid="sticky-note"]').first();
    const posA = await stickyA.boundingBox();
    if (!posA) throw new Error('Sticky not found on A');
    
    await boardA.page.mouse.move(posA.x + posA.width / 2, posA.y + posA.height / 2);
    await boardA.page.mouse.down();
    await boardA.page.mouse.move(posA.x + posA.width / 2 + 100, posA.y + posA.height / 2 + 100, { steps: 10 });
    await boardA.page.mouse.up();

    // B should see the move
    await expect.poll(async () => {
      const posAfter = await stickyB.boundingBox();
      return posAfter ? posAfter.x : -1;
    }, { timeout: E2E_EVENTUAL_TIMEOUT_MS }).not.toBe(posBefore?.x);
  });

  test('TC-24: A edits text → B sees the text', async () => {
    // A double-clicks the sticky to edit
    const stickyA = boardA.page.locator('[data-testid="sticky-note"]').first();
    await stickyA.dblclick();
    
    // Type text
    await boardA.page.keyboard.type('hello');
    // Click outside to finish editing
    await boardA.page.mouse.click(10, 10);

    // B should see the text
    const stickyB = boardB.page.locator('[data-testid="sticky-note"]').first();
    await expect(stickyB).toContainText('hello', { timeout: E2E_EVENTUAL_TIMEOUT_MS });
  });

  test('TC-25: A deletes sticky → B sees it disappear', async () => {
    // A selects and deletes the sticky
    const stickyA = boardA.page.locator('[data-testid="sticky-note"]').first();
    await stickyA.click();
    await boardA.page.keyboard.press('Delete');

    // B should see it disappear
    await expect.poll(() => countStickyNotes(boardB.page), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
      .toBe(0);
  });

  test('TC-26: concurrent edits converge', async () => {
    // Both create stickies simultaneously
    await createStickyOnBoard(boardA.page, 100, 100);
    await createStickyOnBoard(boardB.page, 300, 300);

    // Both should eventually see 2 stickies
    await expect.poll(() => countStickyNotes(boardA.page), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
      .toBe(2);
    await expect.poll(() => countStickyNotes(boardB.page), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
      .toBe(2);
  });

  test('TC-27: connection status badge behavior', async () => {
    // Create a new context and navigate to the board
    const contextC = await boardA.context.newPage();
    const pageC = contextC;
    
    await pageC.goto(`${BASE_URL}/b/${boardId}`);
    await pageC.waitForSelector('canvas', { timeout: 10000 });
    
    // Should show "Connecting…" initially or be connected
    const statusEl = pageC.locator('[data-testid="connection-status"]');
    // Either it's still connecting (visible) or already connected (hidden)
    const isVisible = await statusEl.isVisible().catch(() => false);
    if (isVisible) {
      await expect(statusEl).toHaveText(/Connecting|Connected/);
    }
    
    // Eventually should be connected (badge hidden)
    await waitForConnectionStatus(pageC, 'connected');
    
    await pageC.close();
  });
});

test.describe('@nightly e2e.live: Long-duration and stress tests', () => {
  test.describe.configure({ mode: 'serial' });

  test('TC-29: 30s network outage → catch up on reconnect', async ({ browser }) => {
    const boardId = newBoardId();
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    await navigateToBoard(pageA, boardId);
    await navigateToBoard(pageB, boardId);
    await waitForConnectionStatus(pageA, 'connected');
    await waitForConnectionStatus(pageB, 'connected');

    // Create a sticky
    await createStickyOnBoard(pageA, 200, 200);
    await expect.poll(() => countStickyNotes(pageB), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(1);

    // Simulate network outage on B by blocking WebSocket
    await contextB.route('**/api/rooms/**', (route) => route.abort());
    
    // A creates another sticky during the outage
    await createStickyOnBoard(pageA, 300, 300);
    
    // Wait for the outage duration (30s)
    await new Promise(r => setTimeout(r, 30000));
    
    // Restore network
    await contextB.unroute('**/api/rooms/**');
    
    // B should catch up
    await expect.poll(() => countStickyNotes(pageB), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
      .toBe(2);

    await contextA.close();
    await contextB.close();
  }, 120000);

  test('TC-30: full stress - 5 clients × 50 ops converge', async ({ browser }) => {
    const boardId = newBoardId();
    const contexts: BrowserContext[] = [];
    const pages: Page[] = [];

    for (let i = 0; i < 5; i++) {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      contexts.push(ctx);
      pages.push(page);
      await navigateToBoard(page, boardId);
    }

    // Wait for all to connect
    for (const page of pages) {
      await waitForConnectionStatus(page, 'connected');
    }

    // Each client creates 10 stickies
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 10; j++) {
        await createStickyOnBoard(pages[i], 50 + i * 100 + j * 20, 50 + j * 20);
      }
    }

    // All clients should see 50 stickies
    for (const page of pages) {
      await expect.poll(() => countStickyNotes(page), { timeout: 30000 })
        .toBe(50);
    }

    for (const ctx of contexts) {
      await ctx.close();
    }
  }, 120000);
});
