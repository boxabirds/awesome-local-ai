import { test, expect } from '@playwright/test';
import { startWrangler, type WranglerProcess } from './helpers/wrangler-process';

let wrangler: WranglerProcess;

test.beforeAll(async () => {
  wrangler = await startWrangler();
});

test.afterAll(async () => {
  await wrangler.kill();
});

/** Story 5: boards are created server-side via POST /api/boards. */
async function createBoard(): Promise<string> {
  const resp = await fetch(`http://127.0.0.1:${wrangler.port}/api/boards`, { method: 'POST' });
  if (resp.status !== 201) throw new Error(`board creation failed: ${resp.status}`);
  return ((await resp.json()) as { id: string }).id;
}

test.describe('TC-19: Reopen after leave', () => {
  test('create note in browser → close tab → new tab same URL → note visible', async ({ browser }) => {
    const boardId = await createBoard();
    const url = `http://127.0.0.1:${wrangler.port}/b/${boardId}`;
    
    // First tab: create a note
    const context1 = await browser.newContext();
    const page1 = await context1.newPage();
    await page1.goto(url);
    
    // Wait for connection
    await page1.waitForSelector('[data-testid="create-sticky"]', { timeout: 10000 });
    
    // Create a sticky note by double-clicking the board
    await page1.dblclick('body', { position: { x: 400, y: 300 } });
    
    // Wait for the note to appear
    await page1.waitForSelector('[data-testid="sticky-note"]', { timeout: 5000 });
    
    // Close the first tab/context
    await context1.close();
    
    // Wait a moment for the server to process
    await new Promise(r => setTimeout(r, 1000));
    
    // Second tab: open the same board
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    await page2.goto(url);
    
    // Wait for the note to be visible
    await page2.waitForSelector('[data-testid="sticky-note"]', { timeout: 10000 });
    
    const noteCount = await page2.locator('[data-testid="sticky-note"]').count();
    expect(noteCount).toBe(1);
    
    await context2.close();
  });
});

test.describe('TC-20: Reopen after restart', () => {
  test('kill wrangler; restart with same --persist-to; open board → note visible', async ({ browser }) => {
    const boardId = await createBoard();
    const url = `http://127.0.0.1:${wrangler.port}/b/${boardId}`;
    
    // Create a note
    const context1 = await browser.newContext();
    const page1 = await context1.newPage();
    await page1.goto(url);
    await page1.waitForSelector('[data-testid="create-sticky"]', { timeout: 10000 });
    await page1.dblclick('body', { position: { x: 400, y: 300 } });
    await page1.waitForSelector('[data-testid="sticky-note"]', { timeout: 5000 });
    await context1.close();
    
    // Kill wrangler
    const stateDir = wrangler.stateDir;
    await wrangler.kill();
    
    // Restart with same state dir
    wrangler = await startWrangler({ persistTo: stateDir });
    const newUrl = `http://127.0.0.1:${wrangler.port}/b/${boardId}`;
    
    // Open the board in a new tab
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    await page2.goto(newUrl);
    
    // The note should be visible
    await page2.waitForSelector('[data-testid="sticky-note"]', { timeout: 10000 });
    
    const noteCount = await page2.locator('[data-testid="sticky-note"]').count();
    expect(noteCount).toBe(1);
    
    await context2.close();
  });
});

test.describe('TC-21: Large board load time', () => {
  test('1000-note board loads in under 5 seconds', async ({ browser }) => {
    const boardId = await createBoard();
    const url = `http://127.0.0.1:${wrangler.port}/b/${boardId}`;
    
    // First, create 1000 notes in a single session
    const context1 = await browser.newContext();
    const page1 = await context1.newPage();
    await page1.goto(url);
    await page1.waitForSelector('[data-testid="create-sticky"]', { timeout: 10000 });
    
    // Use the page's Yjs doc to create 1000 notes at once
    await page1.evaluate(() => {
      const doc = (window as any).__vidi_doc;
      if (!doc) throw new Error('No Yjs doc found');
      const objects = doc.getMap('objects');
      const crypto = (globalThis as any).crypto;
      for (let i = 0; i < 1000; i++) {
        const id = crypto?.randomUUID?.() || `note-${i}-${Date.now()}`;
        objects.set(id, {
          x: (i % 50) * 120,
          y: Math.floor(i / 50) * 100,
          text: `Note ${i}`,
          color: 'yellow',
        });
      }
    });
    
    // Wait for sync
    await new Promise(r => setTimeout(r, 3000));
    await context1.close();
    
    // Now open the board in a new tab and measure load time
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    
    const startTime = Date.now();
    await page2.goto(url);
    await page2.waitForSelector('[data-testid="sticky-note"]', { timeout: 15000 });
    
    // Wait for all notes to be rendered
    await page2.waitForFunction(() => {
      return document.querySelectorAll('[data-testid="sticky-note"]').length >= 1000;
    }, { timeout: 15000 });
    
    const loadTime = Date.now() - startTime;
    expect(loadTime).toBeLessThan(5000);
    
    await context2.close();
  });
});
