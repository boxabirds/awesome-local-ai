import { test, expect, Page, Browser } from '@playwright/test';

/**
 * Story 8 E2E: Undo and redo my own changes without undoing anyone else's.
 * TC-22: Recover an accidental delete while a colleague works
 * TC-23: Undo after a colleague deleted my object
 * TC-24: Everyone undoing at once
 */

const BASE = 'http://localhost:8787';

async function createBoard(): Promise<string> {
  const resp = await fetch(`${BASE}/api/boards`, { method: 'POST' });
  if (resp.status !== 201) throw new Error(`board creation failed: ${resp.status}`);
  return ((await resp.json()) as { id: string }).id;
}

async function openBoardContext(browser: Browser, boardId: string): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/b/${boardId}`);
  await page.waitForSelector('[data-testid="board-viewport"]', { timeout: 15000 });
  return page;
}

async function closeContext(page: Page): Promise<void> {
  await page.context().close();
}

/**
 * Create a sticky note using the toolbar button.
 * The note is created at the center of the viewport.
 */
async function createNoteViaToolbar(page: Page, text?: string): Promise<void> {
  const beforeCount = await page.getByTestId('sticky-note').count();
  await page.getByTestId('create-sticky').click();
  await expect(async () => {
    const count = await page.getByTestId('sticky-note').count();
    expect(count).toBe(beforeCount + 1);
  }).toPass({ timeout: 5000 });
  if (text) {
    await page.keyboard.type(text);
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
}

/** Select all notes and delete them. */
async function selectAllAndDelete(page: Page): Promise<void> {
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
}

/** Count visible sticky notes. */
async function countNotes(page: Page): Promise<number> {
  return page.getByTestId('sticky-note').count();
}

test.describe('TC-22: Recover an accidental delete while a colleague works', () => {
  test('Mia deletes notes, undoes → notes restored on both screens; redo removes them again', async ({ browser }) => {
    const boardId = await createBoard();
    const pageMia = await openBoardContext(browser, boardId);
    const pageRaj = await openBoardContext(browser, boardId);

    // Mia creates 3 notes via toolbar
    for (let i = 0; i < 3; i++) {
      await createNoteViaToolbar(pageMia, `Note${i}`);
    }
    expect(await countNotes(pageMia)).toBe(3);

    // Wait for Raj to see all 3 notes
    await expect(async () => {
      expect(await countNotes(pageRaj)).toBe(3);
    }).toPass({ timeout: 5000 });

    // Mia selects all and deletes
    await selectAllAndDelete(pageMia);
    await expect(async () => {
      expect(await countNotes(pageMia)).toBe(0);
    }).toPass({ timeout: 3000 });

    // Wait for Raj to also see 0 notes (deletion propagated)
    await expect(async () => {
      expect(await countNotes(pageRaj)).toBe(0);
    }).toPass({ timeout: 3000 });

    // Raj adds his own note while Mia's notes are gone
    await createNoteViaToolbar(pageRaj, 'RajNote');
    await expect(async () => {
      expect(await countNotes(pageRaj)).toBe(1);
    }).toPass({ timeout: 3000 });
    await expect(async () => {
      expect(await countNotes(pageMia)).toBe(1);
    }).toPass({ timeout: 3000 });

    // Settle
    await pageMia.waitForTimeout(500);
    await pageRaj.waitForTimeout(500);

    // Mia presses Ctrl+Z to undo her delete
    await pageMia.keyboard.press('Control+z');

    // Mia's 3 notes should be restored on both screens.
    // Total should be at least 3 (Mia's restored notes).
    await expect(async () => {
      const c = await countNotes(pageMia);
      expect(c).toBeGreaterThanOrEqual(3);
    }).toPass({ timeout: 5000 });
    await expect(async () => {
      const c = await countNotes(pageRaj);
      expect(c).toBeGreaterThanOrEqual(3);
    }).toPass({ timeout: 5000 });

    // Mia clicks Redo → her notes disappear again
    await pageMia.getByLabel('Redo').click();

    // Notes go back down (redo propagated)
    await expect(async () => {
      const c = await countNotes(pageMia);
      expect(c).toBeLessThanOrEqual(1);
    }).toPass({ timeout: 5000 });
    await expect(async () => {
      const c = await countNotes(pageRaj);
      expect(c).toBeLessThanOrEqual(1);
    }).toPass({ timeout: 5000 });

    await closeContext(pageMia);
    await closeContext(pageRaj);
  });
});

test.describe('TC-23: Colleague deleted my object', () => {
  test('Mia moves a note, Raj deletes it, Mia undoes → no error, note absent on both', async ({ browser }) => {
    const boardId = await createBoard();
    const pageMia = await openBoardContext(browser, boardId);
    const pageRaj = await openBoardContext(browser, boardId);

    // Mia creates a note
    await createNoteViaToolbar(pageMia, 'MiaNote');
    expect(await countNotes(pageMia)).toBe(1);

    // Wait for Raj to see it
    await expect(async () => {
      expect(await countNotes(pageRaj)).toBe(1);
    }).toPass({ timeout: 5000 });

    // Mia moves the note (drag)
    const box = await pageMia.getByTestId('sticky-note').boundingBox();
    if (box) {
      await pageMia.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await pageMia.mouse.down();
      await pageMia.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2 + 50, { steps: 5 });
      await pageMia.mouse.up();
    }
    await pageMia.waitForTimeout(200);

    // Raj deletes the note
    await pageRaj.getByTestId('sticky-note').click();
    await pageRaj.keyboard.press('Delete');

    // Wait for both to see 0 notes
    await expect(async () => {
      expect(await countNotes(pageRaj)).toBe(0);
    }).toPass({ timeout: 3000 });
    await expect(async () => {
      expect(await countNotes(pageMia)).toBe(0);
    }).toPass({ timeout: 3000 });

    // Mia presses Ctrl+Z (undo her move) → no error, note stays absent
    const consoleErrors: string[] = [];
    pageMia.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await pageMia.keyboard.press('Control+z');

    // Note should still be absent on both screens
    await expect(async () => {
      expect(await countNotes(pageMia)).toBe(0);
    }).toPass({ timeout: 3000 });
    await expect(async () => {
      expect(await countNotes(pageRaj)).toBe(0);
    }).toPass({ timeout: 3000 });

    // No console errors from the undo (filter out network errors)
    const relevantErrors = consoleErrors.filter(e => !e.includes('404') && !e.includes('net::') && !e.includes('ERASED'));
    expect(relevantErrors).toHaveLength(0);

    await closeContext(pageMia);
    await closeContext(pageRaj);
  });
});

test.describe('TC-24: Everyone undoing at once', () => {
  test('5 editors each make and undo own changes concurrently → identical final boards', async ({ browser }) => {
    const boardId = await createBoard();
    const pages: Page[] = [];

    // Open 5 contexts
    for (let i = 0; i < 5; i++) {
      pages.push(await openBoardContext(browser, boardId));
    }

    // Each editor creates a note via toolbar
    for (let i = 0; i < 5; i++) {
      await createNoteViaToolbar(pages[i], `Editor${i}`);
    }

    // Wait for all pages to see 5 notes
    for (const page of pages) {
      await expect(async () => {
        expect(await countNotes(page)).toBe(5);
      }).toPass({ timeout: 5000 });
    }

    // Each editor undoes their own change (Ctrl+Z)
    for (let i = 0; i < 5; i++) {
      await pages[i].keyboard.press('Control+z');
    }

    // After all undo, each editor's note should be gone → 0 notes on all screens
    for (const page of pages) {
      await expect(async () => {
        expect(await countNotes(page)).toBe(0);
      }).toPass({ timeout: 5000 });
    }

    for (const page of pages) {
      await closeContext(page);
    }
  });
});
