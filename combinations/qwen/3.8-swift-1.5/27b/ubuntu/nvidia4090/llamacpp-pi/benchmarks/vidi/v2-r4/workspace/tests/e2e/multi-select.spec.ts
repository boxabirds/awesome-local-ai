import { test, expect, type Page } from '@playwright/test';
import { setCamera, getNoteCount } from './helpers/board';

// Helper to get note positions from the page
async function getNotePositions(page: Page): Promise<{ x: number; y: number }[]> {
  return page.evaluate(() => {
    const notes = document.querySelectorAll('[data-testid="sticky-note"]');
    return Array.from(notes).map((n) => {
      const el = n as HTMLElement;
      return { x: parseFloat(el.style.left), y: parseFloat(el.style.top) };
    });
  });
}

// Helper to get selection count from the selection bar
async function getSelectionCount(page: Page): Promise<string | null> {
  const el = page.locator('[data-testid="selection-count"]');
  if (await el.count() === 0) return null;
  return el.textContent();
}

test.describe('Story 7: Multi-select, move, resize, delete', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /new board/i }).click();
    await page.waitForSelector('[data-testid="board-viewport"]', { timeout: 15000 });
    await setCamera(page, { x: -640, y: -400, zoom: 1 });
  });

  test('TC-32: marquee select - selects objects inside the rectangle', async ({ page }) => {
    // Create 2 notes
    await page.dblclick('[data-testid="board-viewport"]', { position: { x: 600, y: 300 } });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    await page.dblclick('[data-testid="board-viewport"]', { position: { x: 1100, y: 300 } });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    const count = await getNoteCount(page);
    expect(count).toBe(2);

    // Shift+drag marquee covering both notes
    // Screen (440, 150) to (1240, 450)
    await page.keyboard.down('Shift');
    await page.mouse.move(440, 150);
    await page.mouse.down();
    await page.mouse.move(1240, 450, { steps: 10 });
    await page.mouse.up();
    await page.keyboard.up('Shift');

    const selCount = await getSelectionCount(page);
    // Both notes should be selected
    expect(selCount).toBe('2 selected');
  });

  test('TC-33: group move', async ({ page }) => {
    // Create 2 notes
    await page.dblclick('[data-testid="board-viewport"]', { position: { x: 840, y: 600 } });
    await page.keyboard.press('Escape');

    await page.dblclick('[data-testid="board-viewport"]', { position: { x: 1040, y: 600 } });
    await page.keyboard.press('Escape');

    const count = await getNoteCount(page);
    expect(count).toBe(2);

    // Select all
    await page.keyboard.press('Control+a');
    const selCount = await getSelectionCount(page);
    expect(selCount).toBe('2 selected');

    // Get initial positions
    const positionsBefore = await getNotePositions(page);

    // Drag from the center of the first note (screen 840, 600) right by 100px
    await page.mouse.move(840, 600);
    await page.mouse.down();
    await page.mouse.move(940, 600, { steps: 5 });
    await page.mouse.up();

    // Get positions after move
    const positionsAfter = await getNotePositions(page);

    // Both notes should have moved 100 world units to the right
    for (let i = 0; i < 2; i++) {
      expect(positionsAfter[i].x).toBeCloseTo(positionsBefore[i].x + 100, 0);
      expect(positionsAfter[i].y).toBeCloseTo(positionsBefore[i].y, 0);
    }
  });

  test('TC-34: nudge with arrow keys and delete', async ({ page }) => {
    // Create a note
    await page.dblclick('[data-testid="board-viewport"]', { position: { x: 840, y: 600 } });
    await page.keyboard.press('Escape');

    const count = await getNoteCount(page);
    expect(count).toBe(1);

    // Select the note
    await page.keyboard.press('Control+a');

    // Get initial position
    const posBefore = await getNotePositions(page);
    const initialX = posBefore[0].x;
    const initialY = posBefore[0].y;

    // Nudge right 3 times (3 world units)
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');

    let posAfter = await getNotePositions(page);
    expect(posAfter[0].x).toBeCloseTo(initialX + 3, 0);
    expect(posAfter[0].y).toBeCloseTo(initialY, 0);

    // Shift+ArrowRight (large step = 10 world units)
    await page.keyboard.press('Shift+ArrowRight');
    posAfter = await getNotePositions(page);
    expect(posAfter[0].x).toBeCloseTo(initialX + 3 + 10, 0);

    // Delete the selection
    await page.keyboard.press('Delete');
    const countAfter = await getNoteCount(page);
    expect(countAfter).toBe(0);
  });

  test('TC-35: colleague deletes one of my selected notes', async ({ browser }) => {
    const context1 = await browser.newContext();
    const page1 = await context1.newPage();

    // Create board via home page
    await page1.goto('/');
    await page1.getByRole('button', { name: /new board/i }).click();
    await page1.waitForSelector('[data-testid="board-viewport"]', { timeout: 15000 });
    const boardUrl = page1.url();
    const bId = boardUrl.split('/').pop()!;

    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    await page2.goto(`/b/${bId}`);
    await page2.waitForSelector('[data-testid="board-viewport"]', { timeout: 15000 });

    // Set camera for both
    await setCamera(page1, { x: -640, y: -400, zoom: 1 });
    await setCamera(page2, { x: -640, y: -400, zoom: 1 });

    // Create 4 notes on page1
    const positions = [
      { x: 840, y: 400 },
      { x: 1040, y: 400 },
      { x: 840, y: 600 },
      { x: 1040, y: 600 },
    ];

    for (const pos of positions) {
      await page1.dblclick('[data-testid="board-viewport"]', { position: pos });
      await page1.keyboard.press('Escape');
    }

    // Wait for notes to appear on page2
    await page2.waitForTimeout(1000);
    const count2 = await getNoteCount(page2);
    expect(count2).toBe(4);

    // Lee (page1) selects all 4 notes
    await page1.keyboard.press('Control+a');
    const selCount1 = await getSelectionCount(page1);
    expect(selCount1).toBe('4 selected');

    // Sam (page2) clicks one note and deletes it
    const notes2 = page2.locator('[data-testid="sticky-note"]');
    await notes2.first().click();
    await page2.keyboard.press('Delete');

    // Wait for the deletion to propagate
    await page1.waitForTimeout(1000);

    // Lee's selection should now show 3 selected
    const selCountAfter = await getSelectionCount(page1);
    expect(selCountAfter).toBe('3 selected');

    // Lee can now delete the remaining 3
    await page1.keyboard.press('Delete');
    await page1.waitForTimeout(500);
    const finalCount = await getNoteCount(page1);
    expect(finalCount).toBe(0);

    await context1.close();
    await context2.close();
  });

  test('TC-36: concurrent editors move different selections simultaneously', async ({ browser }) => {
    const MAX_EDITORS = 5;
    const contexts: any[] = [];
    const pages: Page[] = [];

    // Create first context and board via home page
    const context0 = await browser.newContext();
    const page0 = await context0.newPage();
    await page0.goto('/');
    await page0.getByRole('button', { name: /new board/i }).click();
    await page0.waitForSelector('[data-testid="board-viewport"]', { timeout: 15000 });
    const boardUrl = page0.url();
    const bId = boardUrl.split('/').pop()!;

    contexts.push(context0);
    pages.push(page0);

    // Create additional contexts
    for (let i = 1; i < MAX_EDITORS; i++) {
      const ctx = await browser.newContext();
      const pg = await ctx.newPage();
      await pg.goto(`/b/${bId}`);
      await pg.waitForSelector('[data-testid="board-viewport"]', { timeout: 15000 });
      contexts.push(ctx);
      pages.push(pg);
    }

    // Set camera for all
    for (const pg of pages) {
      await setCamera(pg, { x: -640, y: -400, zoom: 1 });
    }

    // Create notes on the first page
    const notePositions = [
      { x: 700, y: 300 },
      { x: 900, y: 300 },
      { x: 1100, y: 300 },
      { x: 700, y: 500 },
      { x: 900, y: 500 },
    ];

    for (const pos of notePositions) {
      await pages[0].dblclick('[data-testid="board-viewport"]', { position: pos });
      await pages[0].keyboard.press('Escape');
    }

    // Wait for all notes to appear on all pages
    await pages[0].waitForTimeout(1500);
    for (const pg of pages) {
      await pg.waitForTimeout(500);
    }

    // Each editor selects their note and moves it
    const movePromises = pages.map(async (pg, i) => {
      const notes = pg.locator('[data-testid="sticky-note"]');
      const noteCount = await notes.count();
      if (noteCount > i) {
        await notes.nth(i).click();
        const box = await notes.nth(i).boundingBox();
        if (box) {
          const startX = box.x + box.width / 2;
          const startY = box.y + box.height / 2;
          await pg.mouse.move(startX, startY);
          await pg.mouse.down();
          await pg.mouse.move(startX + (i + 1) * 50, startY, { steps: 3 });
          await pg.mouse.up();
        }
      }
    });

    await Promise.all(movePromises);

    // Wait for convergence
    await pages[0].waitForTimeout(2000);

    // All pages should show the same final positions
    const positions0 = await getNotePositions(pages[0]);
    for (let i = 1; i < pages.length; i++) {
      const positionsI = await getNotePositions(pages[i]);
      expect(positionsI).toHaveLength(positions0.length);
      for (let j = 0; j < positions0.length; j++) {
        expect(positionsI[j].x).toBeCloseTo(positions0[j].x, 0);
        expect(positionsI[j].y).toBeCloseTo(positions0[j].y, 0);
      }
    }

    // Cleanup
    for (const ctx of contexts) {
      await ctx.close();
    }
  });
});
