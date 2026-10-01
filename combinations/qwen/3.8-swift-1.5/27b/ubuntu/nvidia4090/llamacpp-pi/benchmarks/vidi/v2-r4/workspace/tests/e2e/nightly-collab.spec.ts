import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';
import { setCamera } from './helpers/board';

/**
 * Story 3 Nightly E2E: Stress and resilience tests
 * 
 * These are longer-running tests that verify stability under load
 * and resilience to network issues.
 */

async function createEditorContext(
  context: BrowserContext,
  boardId: string,
): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`/b/${boardId}`);
  await page.waitForSelector('[data-testid="board-viewport"]');
  await setCamera(page, { x: 0, y: 0, zoom: 1 });
  return page;
}

test.describe('Story 3 Nightly: Stress and Resilience', () => {
  test.describe.configure({ mode: 'serial' });

  // TC-29: 5 editors, 100 random ops, all converge
  test('TC-29: 5 editors with random ops all converge', async ({ browser }) => {
    const boardId = newBoardId();
    const contexts: BrowserContext[] = [];
    const pages: Page[] = [];

    // Create 5 editor contexts
    for (let i = 0; i < 5; i++) {
      const ctx = await browser.newContext();
      contexts.push(ctx);
      pages.push(await createEditorContext(ctx, boardId));
    }

    // Each editor creates some notes and types text
    for (let i = 0; i < 5; i++) {
      const page = pages[i];
      // Create 2 notes per editor
      for (let j = 0; j < 2; j++) {
        const x = 100 + i * 150 + j * 80;
        const y = 100 + j * 100;
        await page.dblclick('[data-testid="board-viewport"]', { position: { x, y } });
        const editor = page.locator('[data-testid="sticky-text-editor"]');
        await editor.waitFor({ timeout: 5000 });
        await editor.fill(`Editor ${i} note ${j}`);
        await page.click('[data-testid="board-viewport"]', { position: { x: 5, y: 5 } });
      }
    }

    // Wait for all editors to converge to 10 notes
    for (let i = 0; i < 5; i++) {
      await expect(pages[i].locator('[data-testid="sticky-note"]'))
        .toHaveCount(10, { timeout: 30000 });
    }

    // Verify all editors see the same text content
    const allTexts: string[][] = [];
    for (let i = 0; i < 5; i++) {
      const texts = await pages[i].locator('[data-testid="sticky-note"]').allTextContents();
      allTexts.push(texts.sort());
    }

    // All editors should see the same set of texts
    const reference = allTexts[0];
    for (let i = 1; i < 5; i++) {
      expect(allTexts[i]).toEqual(reference);
    }

    // Cleanup
    for (const ctx of contexts) {
      await ctx.close();
    }
  });

  // TC-30: Reconnect after network drop repopulates board
  test('TC-30: reconnect after disconnect repopulates board', async ({ browser }) => {
    const boardId = newBoardId();
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const a = await createEditorContext(ctxA, boardId);
    const b = await createEditorContext(ctxB, boardId);

    // A creates a note
    await a.dblclick('[data-testid="board-viewport"]', { position: { x: 400, y: 300 } });
    const editorA = a.locator('[data-testid="sticky-text-editor"]');
    await editorA.waitFor({ timeout: 5000 });
    await editorA.fill('Persistent note');
    await a.click('[data-testid="board-viewport"]', { position: { x: 10, y: 10 } });

    // B should see the note
    await expect(b.locator('[data-testid="sticky-note"]')).toHaveCount(1, { timeout: 10000 });

    // Simulate B disconnecting by navigating away
    await b.goto('/');
    await b.waitForSelector('[data-testid="board-viewport"]');

    // B navigates back to the same board
    await b.goto(`/b/${boardId}`);
    await b.waitForSelector('[data-testid="board-viewport"]');
    await setCamera(b, { x: 0, y: 0, zoom: 1 });

    // B should see the note again
    await expect(b.locator('[data-testid="sticky-note"]')).toHaveCount(1, { timeout: 10000 });
    await expect(b.locator('[data-testid="sticky-note"]')).toContainText('Persistent note', { timeout: 10000 });

    await ctxA.close();
    await ctxB.close();
  });
});
