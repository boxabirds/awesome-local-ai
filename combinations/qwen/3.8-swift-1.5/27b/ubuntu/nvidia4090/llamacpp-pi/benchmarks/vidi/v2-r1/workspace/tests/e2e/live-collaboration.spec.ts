import { test, expect, Page } from '@playwright/test';

/**
 * E2E tests for live collaboration (story 3).
 * These tests use two browser contexts to simulate two users on the same board.
 */

const BASE = 'http://localhost:8787';

/** Story 5: boards are created server-side via POST /api/boards. */
async function createBoard(): Promise<string> {
  const resp = await fetch(`${BASE}/api/boards`, { method: 'POST' });
  if (resp.status !== 201) throw new Error(`board creation failed: ${resp.status}`);
  return ((await resp.json()) as { id: string }).id;
}

async function openBoardContext(browser: any, boardId: string): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/b/${boardId}`);
  // Wait for the board to open
  await page.waitForSelector('[data-testid="board-viewport"]', { timeout: 15000 });
  return page;
}

async function closeContext(page: Page): Promise<void> {
  const context = page.context();
  await context.close();
}

test.describe('TC-22: live edit appears on other page', () => {
  test('note created on A appears on B within 3s', async ({ browser }) => {
    const boardId = await createBoard();
    const pageA = await openBoardContext(browser, boardId);
    const pageB = await openBoardContext(browser, boardId);

    // Create a note on A
    await pageA.mouse.dblclick(400, 300);
    const noteA = pageA.getByTestId('sticky-note');
    await expect(noteA).toBeVisible();
    await pageA.keyboard.type('Hello');

    // B should see the note within 3s
    const noteB = pageB.getByTestId('sticky-note');
    await expect(noteB).toBeVisible({ timeout: 3000 });

    await closeContext(pageA);
    await closeContext(pageB);
  });
});

test.describe('TC-23: text edit propagates', () => {
  test('text typed on A appears in B\'s note', async ({ browser }) => {
    const boardId = await createBoard();
    const pageA = await openBoardContext(browser, boardId);
    const pageB = await openBoardContext(browser, boardId);

    // Create a note on A with text
    await pageA.mouse.dblclick(400, 300);
    await pageA.getByTestId('sticky-note').waitFor();
    await pageA.keyboard.type('Hello');

    // Wait for B to see the note
    const noteB = pageB.getByTestId('sticky-note');
    await expect(noteB).toBeVisible({ timeout: 3000 });

    // Type more text on A
    await pageA.getByTestId('sticky-text-editor').click();
    await pageA.keyboard.type(' World');

    // B should see the updated text
    const textB = pageB.getByTestId('sticky-text-editor');
    await expect(textB).toHaveValue('Hello World', { timeout: 3000 });

    await closeContext(pageA);
    await closeContext(pageB);
  });
});

test.describe('TC-24: move propagates', () => {
  test('note moved on A appears at new position on B', async ({ browser }) => {
    const boardId = await createBoard();
    const pageA = await openBoardContext(browser, boardId);
    const pageB = await openBoardContext(browser, boardId);

    // Create a note on A
    await pageA.mouse.dblclick(400, 300);
    await pageA.getByTestId('sticky-note').waitFor();

    // Wait for B to see the note
    const noteB = pageB.getByTestId('sticky-note');
    await expect(noteB).toBeVisible({ timeout: 3000 });

    // Get initial position on B
    const boxBefore = await noteB.boundingBox();
    expect(boxBefore).not.toBeNull();

    // Move the note on A (drag from center)
    const boxA = await pageA.getByTestId('sticky-note').boundingBox();
    if (boxA) {
      await pageA.mouse.move(boxA.x + boxA.width / 2, boxA.y + boxA.height / 2);
      await pageA.mouse.down();
      await pageA.mouse.move(boxA.x + boxA.width / 2 + 100, boxA.y + boxA.height / 2 + 50, { steps: 5 });
      await pageA.mouse.up();
    }

    // B should see the note at the new position
    await expect(async () => {
      const boxAfter = await noteB.boundingBox();
      expect(boxAfter).not.toBeNull();
      expect(Math.abs((boxAfter!.x) - (boxBefore!.x + 100))).toBeLessThan(20);
    }).toPass({ timeout: 3000 });

    await closeContext(pageA);
    await closeContext(pageB);
  });
});

test.describe('TC-25: delete propagates', () => {
  test('note deleted on A disappears on B', async ({ browser }) => {
    const boardId = await createBoard();
    const pageA = await openBoardContext(browser, boardId);
    const pageB = await openBoardContext(browser, boardId);

    // Create a note on A
    await pageA.mouse.dblclick(400, 300);
    await pageA.getByTestId('sticky-note').waitFor();

    // Wait for B to see the note
    const noteB = pageB.getByTestId('sticky-note');
    await expect(noteB).toBeVisible({ timeout: 3000 });

    // Delete the note on A (select and press Delete)
    await pageA.getByTestId('sticky-note').click();
    await pageA.keyboard.press('Delete');

    // B should see the note disappear
    await expect(noteB).not.toBeVisible({ timeout: 3000 });

    await closeContext(pageA);
    await closeContext(pageB);
  });
});

test.describe('TC-26: concurrent edits converge', () => {
  test('both pages end up with same text after concurrent edits', async ({ browser }) => {
    const boardId = await createBoard();
    const pageA = await openBoardContext(browser, boardId);
    const pageB = await openBoardContext(browser, boardId);

    // Create a note on A
    await pageA.mouse.dblclick(400, 300);
    await pageA.getByTestId('sticky-note').waitFor();
    await pageA.keyboard.type('Hello');

    // Wait for B to see the note
    const noteB = pageB.getByTestId('sticky-note');
    await expect(noteB).toBeVisible({ timeout: 3000 });

    // Both pages type at the end of the text
    // A types "A"
    await pageA.getByTestId('sticky-text-editor').click();
    await pageA.keyboard.press('End');
    await pageA.keyboard.type('A');

    // B types "B"
    const textB = pageB.getByTestId('sticky-text-editor');
    await textB.click();
    await pageB.keyboard.press('End');
    await pageB.keyboard.type('B');

    // Both should converge to the same text (order may vary)
    await expect(async () => {
      const valA = await pageA.getByTestId('sticky-text-editor').inputValue();
      const valB = await pageB.getByTestId('sticky-text-editor').inputValue();
      expect(valA).toBe(valB);
    }).toPass({ timeout: 5000 });

    await closeContext(pageA);
    await closeContext(pageB);
  });
});

test.describe('TC-27: late joiner sees current board', () => {
  test('C connects after A and B created notes, sees all', async ({ browser }) => {
    const boardId = await createBoard();
    const pageA = await openBoardContext(browser, boardId);

    // A creates 3 notes
    for (let i = 0; i < 3; i++) {
      await pageA.mouse.dblclick(200 + i * 150, 300);
      await pageA.getByTestId('sticky-note').nth(i).waitFor();
      await pageA.keyboard.type(`Note${i}`);
      await pageA.keyboard.press('Escape');
    }

    expect(await pageA.getByTestId('sticky-note').count()).toBe(3);

    // C connects late
    const pageC = await openBoardContext(browser, boardId);

    // C should see all 3 notes
    await expect(async () => {
      const count = await pageC.getByTestId('sticky-note').count();
      expect(count).toBe(3);
    }).toPass({ timeout: 5000 });

    await closeContext(pageA);
    await closeContext(pageC);
  });
});

test.describe('TC-28: 5 simultaneous editors converge', () => {
  test('5 pages all see the same final state', async ({ browser }) => {
    const boardId = await createBoard();
    const pages: Page[] = [];

    // Create 5 pages on the same board
    for (let i = 0; i < 5; i++) {
      pages.push(await openBoardContext(browser, boardId));
    }

    // Each page creates a note
    for (let i = 0; i < 5; i++) {
      await pages[i].mouse.dblclick(200 + i * 100, 300);
      await pages[i].getByTestId('sticky-note').first().waitFor();
      await pages[i].keyboard.type(`N${i}`);
      await pages[i].keyboard.press('Escape');
    }

    // All pages should converge to 5 notes
    for (let i = 0; i < 5; i++) {
      await expect(async () => {
        const count = await pages[i].getByTestId('sticky-note').count();
        expect(count).toBe(5);
      }).toPass({ timeout: 5000 });
    }

    for (const page of pages) {
      await closeContext(page);
    }
  });
});
