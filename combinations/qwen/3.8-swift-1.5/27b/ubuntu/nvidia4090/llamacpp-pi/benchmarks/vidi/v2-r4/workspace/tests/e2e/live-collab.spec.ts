import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { setCamera, createBoard } from './helpers/board';

/**
 * Story 3 E2E: Live collaboration
 * 
 * These tests use two browser contexts (A and B) on the same board
 * to verify that edits made by one user appear live for the other.
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

async function createNote(page: Page, x: number, y: number): Promise<void> {
  await page.dblclick('[data-testid="board-viewport"]', { position: { x, y } });
  const editor = page.locator('[data-testid="sticky-text-editor"]');
  await editor.waitFor({ timeout: 5000 });
  // Click elsewhere to end editing
  await page.click('[data-testid="board-viewport"]', { position: { x: 10, y: 10 } });
}

test.describe('Story 3: Live Collaboration E2E', () => {
  test.describe.configure({ mode: 'serial' });

  let boardId: string;

  test.beforeEach(async () => {
    boardId = await createBoard();
  });

  // TC-22: A creates sticky → B sees it appear
  test('TC-22: A creates sticky, B sees it appear', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const a = await createEditorContext(ctxA, boardId);
    const b = await createEditorContext(ctxB, boardId);

    // B should initially have 0 notes
    await expect(b.locator('[data-testid="sticky-note"]')).toHaveCount(0);

    // A creates a note
    await createNote(a, 400, 300);
    await expect(a.locator('[data-testid="sticky-note"]')).toHaveCount(1);

    // B should see the note appear (within 5 seconds)
    await expect(b.locator('[data-testid="sticky-note"]')).toHaveCount(1, { timeout: 10000 });

    await ctxA.close();
    await ctxB.close();
  });

  // TC-23: A types text → B sees the text
  test('TC-23: A types text, B sees the text', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const a = await createEditorContext(ctxA, boardId);
    const b = await createEditorContext(ctxB, boardId);

    // A creates a note and types text
    await a.dblclick('[data-testid="board-viewport"]', { position: { x: 400, y: 300 } });
    const editorA = a.locator('[data-testid="sticky-text-editor"]');
    await editorA.waitFor({ timeout: 5000 });
    await editorA.fill('Hello from A');
    await a.click('[data-testid="board-viewport"]', { position: { x: 10, y: 10 } });

    // B should see the note with text
    const noteB = b.locator('[data-testid="sticky-note"]');
    await expect(noteB).toHaveCount(1, { timeout: 10000 });
    
    // Check that the text is visible in B's note
    await expect(noteB).toContainText('Hello from A', { timeout: 10000 });

    await ctxA.close();
    await ctxB.close();
  });

  // TC-24: A deletes sticky → B sees deletion
  test('TC-24: A deletes sticky, B sees deletion', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const a = await createEditorContext(ctxA, boardId);
    const b = await createEditorContext(ctxB, boardId);

    // A creates a note
    await createNote(a, 400, 300);
    await expect(b.locator('[data-testid="sticky-note"]')).toHaveCount(1, { timeout: 10000 });

    // A deletes the note (select it and press Delete)
    const noteA = a.locator('[data-testid="sticky-note"]');
    await noteA.click();
    await a.keyboard.press('Delete');

    // B should see the note disappear
    await expect(b.locator('[data-testid="sticky-note"]')).toHaveCount(0, { timeout: 10000 });

    await ctxA.close();
    await ctxB.close();
  });

  // TC-25: Both type concurrently → both see merged result
  test('TC-25: concurrent edits merge for both', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const a = await createEditorContext(ctxA, boardId);
    const b = await createEditorContext(ctxB, boardId);

    // A creates a note
    await a.dblclick('[data-testid="board-viewport"]', { position: { x: 400, y: 300 } });
    const editorA = a.locator('[data-testid="sticky-text-editor"]');
    await editorA.waitFor({ timeout: 5000 });
    await editorA.fill('Hello');
    await a.click('[data-testid="board-viewport"]', { position: { x: 10, y: 10 } });

    // Wait for B to see the note
    const noteB = b.locator('[data-testid="sticky-note"]');
    await expect(noteB).toHaveCount(1, { timeout: 10000 });

    // Both type additional text concurrently
    // A clicks the note to edit
    const noteA = a.locator('[data-testid="sticky-note"]');
    await noteA.dblclick();
    const editorA2 = a.locator('[data-testid="sticky-text-editor"]');
    await editorA2.waitFor({ timeout: 5000 });
    
    // B clicks the note to edit
    await noteB.dblclick();
    const editorB = b.locator('[data-testid="sticky-text-editor"]');
    await editorB.waitFor({ timeout: 5000 });

    // Both type
    await editorA2.press('End');
    await editorA2.type(' World', { delay: 50 });
    await editorB.press('End');
    await editorB.type('!', { delay: 50 });

    // Both click away
    await a.click('[data-testid="board-viewport"]', { position: { x: 10, y: 10 } });
    await b.click('[data-testid="board-viewport"]', { position: { x: 10, y: 10 } });

    // Both should see the merged text (exact order may vary)
    await expect(noteA).toContainText('Hello', { timeout: 10000 });
    await expect(noteB).toContainText('Hello', { timeout: 10000 });
    await expect(noteA).toContainText('World', { timeout: 10000 });
    await expect(noteB).toContainText('World', { timeout: 10000 });

    await ctxA.close();
    await ctxB.close();
  });

  // TC-26: Connection is established (badge hidden when stable)
  test('TC-26: connection status shows connected', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await createEditorContext(ctx, boardId);

    // When the board is connected the status badge is hidden (it only appears
    // while connecting / reconnecting / on load failure).
    await expect(page.getByTestId('connection-status')).not.toBeVisible();

    await ctx.close();
  });

  // TC-27: Late joiner sees existing content
  test('TC-27: late joiner sees existing content', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const a = await createEditorContext(ctxA, boardId);

    // A creates two notes
    await createNote(a, 300, 200);
    await createNote(a, 500, 400);
    await expect(a.locator('[data-testid="sticky-note"]')).toHaveCount(2);

    // B joins late
    const ctxB = await browser.newContext();
    const b = await createEditorContext(ctxB, boardId);

    // B should immediately see both notes
    await expect(b.locator('[data-testid="sticky-note"]')).toHaveCount(2, { timeout: 10000 });

    await ctxA.close();
    await ctxB.close();
  });

  // TC-28: A moves sticky → B sees the move
  test('TC-28: A moves sticky, B sees the move', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const a = await createEditorContext(ctxA, boardId);
    const b = await createEditorContext(ctxB, boardId);

    // A creates a note
    await createNote(a, 300, 200);
    await expect(b.locator('[data-testid="sticky-note"]')).toHaveCount(1, { timeout: 10000 });

    // Get B's note position before move
    const noteB = b.locator('[data-testid="sticky-note"]');
    const posBefore = await noteB.boundingBox();

    // A drags the note to a new position
    const noteA = a.locator('[data-testid="sticky-note"]');
    const boxA = await noteA.boundingBox();
    if (boxA && posBefore) {
      await a.mouse.move(boxA.x + boxA.width / 2, boxA.y + boxA.height / 2);
      await a.mouse.down();
      await a.mouse.move(boxA.x + boxA.width / 2 + 150, boxA.y + boxA.height / 2 + 100, { steps: 10 });
      await a.mouse.up();
    }

    // B's note should have moved (position changed)
    await expect.poll(async () => {
      const box = await noteB.boundingBox();
      return box ? { x: box.x, y: box.y } : null;
    }, { timeout: 10000 }).not.toEqual({ x: posBefore!.x, y: posBefore!.y });

    await ctxA.close();
    await ctxB.close();
  });
});
