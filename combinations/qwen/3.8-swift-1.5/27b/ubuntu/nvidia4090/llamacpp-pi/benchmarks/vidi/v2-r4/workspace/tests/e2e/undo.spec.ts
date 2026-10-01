import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { setCamera, getNoteCount } from './helpers/board';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';

/** Positions keyed by note id (DOM order changes with z-order after drags). */
async function getNotePositionsById(page: Page): Promise<Record<string, { x: number; y: number }>> {
  return page.evaluate(() => {
    const notes = document.querySelectorAll('[data-testid="sticky-note"]');
    const out: Record<string, { x: number; y: number }> = {};
    for (const n of Array.from(notes)) {
      const el = n as HTMLElement;
      out[el.getAttribute('data-note-id')!] = { x: parseFloat(el.style.left), y: parseFloat(el.style.top) };
    }
    return out;
  });
}

/** Texts keyed by note id. */
async function getNoteTextsById(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const notes = document.querySelectorAll('[data-testid="sticky-note"]');
    const out: Record<string, string> = {};
    for (const n of Array.from(notes)) {
      const el = n as HTMLElement;
      const display = el.querySelector('[data-testid="sticky-text-display"]');
      out[el.getAttribute('data-note-id')!] = display ? (display as HTMLElement).textContent ?? '' : '';
    }
    return out;
  });
}

/** Creates a note at a screen position and types text into it. */
async function createTypedNote(page: Page, x: number, y: number, text: string): Promise<void> {
  await page.dblclick('[data-testid="board-viewport"]', { position: { x, y } });
  await page.keyboard.type(text);
  await page.keyboard.press('Escape');
}

async function setupTwoEditors(browser: any): Promise<{
  contexts: BrowserContext[];
  pages: [Page, Page];
  boardId: string;
}> {
  const context1 = await browser.newContext();
  const page1 = await context1.newPage();
  await page1.goto('/');
  await page1.getByRole('button', { name: /new board/i }).click();
  await page1.waitForSelector('[data-testid="board-viewport"]', { timeout: 15000 });
  const boardUrl = page1.url();
  const boardId = boardUrl.split('/').pop()!;

  const context2 = await browser.newContext();
  const page2 = await context2.newPage();
  await page2.goto(`/b/${boardId}`);
  await page2.waitForSelector('[data-testid="board-viewport"]', { timeout: 15000 });

  await setCamera(page1, { x: -640, y: -400, zoom: 1 });
  await setCamera(page2, { x: -640, y: -400, zoom: 1 });
  // Let the world-layer transform settle before pointer interactions
  await page1.waitForTimeout(250);

  return { contexts: [context1, context2], pages: [page1, page2], boardId };
}

test.describe('Story 8: undo and redo my own changes (E2E)', () => {
  test('TC-22: recover an accidental delete while a colleague works', async ({ browser }) => {
    const { contexts, pages } = await setupTwoEditors(browser);
    const [mia, raj] = pages;

    // Mia box-selects 8 notes (4x2 grid) and deletes them
    const grid = [
      { x: 600, y: 300 }, { x: 750, y: 300 }, { x: 900, y: 300 }, { x: 1050, y: 300 },
      { x: 600, y: 450 }, { x: 750, y: 450 }, { x: 900, y: 450 }, { x: 1050, y: 450 },
    ];
    for (let i = 0; i < grid.length; i++) {
      await createTypedNote(mia, grid[i].x, grid[i].y, `note-${i + 1}`);
    }
    expect(await getNoteCount(mia)).toBe(8);

    // Box-select all 8 with a shift-drag marquee (notes span screen
    // (500,200)-(1150,550); start/end well outside so no note is clicked)
    await mia.keyboard.down('Shift');
    await mia.mouse.move(450, 150);
    await mia.mouse.down();
    await mia.mouse.move(1200, 600, { steps: 10 });
    await mia.mouse.up();
    await mia.keyboard.up('Shift');

    await mia.keyboard.press('Delete');
    await mia.waitForTimeout(500);
    expect(await getNoteCount(mia)).toBe(0);

    // Raj adds a note (his own change, must survive Mia's undo/redo)
    await createTypedNote(raj, 1150, 650, 'rajs-note');
    await mia.waitForTimeout(500);

    // Mia undoes her delete → the 8 notes return on both screens, Raj's note remains
    await mia.keyboard.press('Control+z');
    await mia.waitForTimeout(800);
    expect(await getNoteCount(mia)).toBe(9);
    expect(await getNoteCount(raj)).toBe(9);

    // The restored notes have their text back
    const miaTexts = await getNoteTextsById(mia);
    const miaTextList = Object.values(miaTexts);
    for (let i = 1; i <= 8; i++) {
      expect(miaTextList).toContain(`note-${i}`);
    }
    expect(miaTextList).toContain('rajs-note');

    // Mia redoes → the 8 disappear again on both; only Raj's note remains
    await raj.waitForTimeout(300);
    await mia.getByRole('button', { name: 'Redo' }).click();
    await mia.waitForTimeout(800);
    expect(await getNoteCount(mia)).toBe(1);
    expect(await getNoteCount(raj)).toBe(1);
    expect(Object.values(await getNoteTextsById(mia))).toContain('rajs-note');

    // Drain Mia's remaining history (8 creates + 8 typing bursts; the typing
    // steps on already-deleted notes are silent no-ops) → Undo disabled
    for (let i = 0; i < 20; i++) {
      await mia.keyboard.press('Control+z');
      await mia.waitForTimeout(150);
      if (await mia.getByRole('button', { name: 'Undo' }).isDisabled()) break;
    }
    await expect(mia.getByRole('button', { name: 'Undo' })).toBeDisabled();
    // Raj's note survived all of Mia's undoing
    expect(await getNoteCount(raj)).toBe(1);
    expect(Object.values(await getNoteTextsById(raj))).toContain('rajs-note');

    for (const ctx of contexts) await ctx.close();
  });

  test('TC-23: colleague deleted my object — stale undo is a silent no-op', async ({ browser }) => {
    const { contexts, pages } = await setupTwoEditors(browser);
    const [mia, raj] = pages;

    const consoleErrors: string[] = [];
    mia.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    mia.on('pageerror', (err) => consoleErrors.push(err.message));

    // Mia creates a note and moves it
    await createTypedNote(mia, 800, 400, 'mine');
    const notes = mia.locator('[data-testid="sticky-note"]');
    const box = await notes.first().boundingBox();
    await mia.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await mia.mouse.down();
    await mia.mouse.move(box!.x + box!.width / 2 + 120, box!.y + box!.height / 2, { steps: 5 });
    await mia.mouse.up();
    await mia.waitForTimeout(300);

    // Raj deletes Mia's note
    await raj.waitForTimeout(500);
    await raj.locator('[data-testid="sticky-note"]').first().click();
    await raj.keyboard.press('Delete');
    await mia.waitForTimeout(800);
    expect(await getNoteCount(raj)).toBe(0);
    expect(await getNoteCount(mia)).toBe(0);

    // Mia undoes → silent no-op: no error, note absent on both screens
    await mia.keyboard.press('Control+z');
    await mia.waitForTimeout(500);
    expect(await getNoteCount(mia)).toBe(0);
    expect(await getNoteCount(raj)).toBe(0);
    expect(consoleErrors).toHaveLength(0);

    // Mia's next undo still works: make a new change (one step, no typing),
    // then undo it
    await mia.dblclick('[data-testid="board-viewport"]', { position: { x: 300, y: 300 } });
    await mia.keyboard.press('Escape');
    expect(await getNoteCount(mia)).toBe(1);
    await mia.keyboard.press('Control+z');
    await mia.waitForTimeout(500);
    expect(await getNoteCount(mia)).toBe(0);
    expect(consoleErrors).toHaveLength(0);

    for (const ctx of contexts) await ctx.close();
  });

  test('TC-24: everyone undoing at once — each reverts only their own changes', async ({ browser }) => {
    const contexts: BrowserContext[] = [];
    const pages: Page[] = [];

    const context0 = await browser.newContext();
    const page0 = await context0.newPage();
    await page0.goto('/');
    await page0.getByRole('button', { name: /new board/i }).click();
    await page0.waitForSelector('[data-testid="board-viewport"]', { timeout: 15000 });
    const boardId = page0.url().split('/').pop()!;
    contexts.push(context0);
    pages.push(page0);

    for (let i = 1; i < MAX_CONCURRENT_EDITORS; i++) {
      const ctx = await browser.newContext();
      const pg = await ctx.newPage();
      await pg.goto(`/b/${boardId}`);
      await pg.waitForSelector('[data-testid="board-viewport"]', { timeout: 15000 });
      contexts.push(ctx);
      pages.push(pg);
    }

    for (const pg of pages) {
      await setCamera(pg, { x: -640, y: -400, zoom: 1 });
    }

    // Create one note per editor
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
      await createTypedNote(pages[0], 600 + i * 150, 300, `start-${i}`);
    }
    await pages[0].waitForTimeout(1500);

    const initial = await getNotePositionsById(pages[0]);
    expect(Object.keys(initial)).toHaveLength(MAX_CONCURRENT_EDITORS);

    // Each editor moves their note (one gesture) ...
    const moves = pages.map(async (pg, i) => {
      const note = pg.locator('[data-testid="sticky-note"]').nth(i);
      const box = await note.boundingBox();
      await pg.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
      await pg.mouse.down();
      await pg.mouse.move(box!.x + box!.width / 2 + 80, box!.y + box!.height / 2, { steps: 4 });
      await pg.mouse.up();
    });
    await Promise.all(moves);
    await pages[0].waitForTimeout(800);

    // ... and types in their note (one typing burst)
    const typings = pages.map(async (pg, i) => {
      const note = pg.locator('[data-testid="sticky-note"]').nth(i);
      await note.dblclick();
      await pg.keyboard.type(`e${i}`);
      await pg.keyboard.press('Escape');
    });
    await Promise.all(typings);
    await pages[0].waitForTimeout(800);

    // All press Ctrl+Z twice: typing burst first, then the move
    const undos = pages.map(async (pg) => {
      await pg.keyboard.press('Control+z');
      await pg.waitForTimeout(200);
      await pg.keyboard.press('Control+z');
    });
    await Promise.all(undos);
    await pages[0].waitForTimeout(1200);

    // Every editor's own changes are reverted; all boards identical to the start
    for (let i = 0; i < pages.length; i++) {
      const positions = await getNotePositionsById(pages[i]);
      expect(Object.keys(positions)).toHaveLength(MAX_CONCURRENT_EDITORS);
      for (const [id, pos] of Object.entries(positions)) {
        expect(pos.x).toBeCloseTo(initial[id].x, 0);
        expect(pos.y).toBeCloseTo(initial[id].y, 0);
      }
    }

    // Texts reverted to the original (no e0..e4 appended anywhere)
    const texts = Object.values(await getNoteTextsById(pages[0]));
    for (const text of texts) {
      expect(text.match(/^start-\d+$/)).not.toBeNull();
    }

    for (const ctx of contexts) await ctx.close();
  });
});
