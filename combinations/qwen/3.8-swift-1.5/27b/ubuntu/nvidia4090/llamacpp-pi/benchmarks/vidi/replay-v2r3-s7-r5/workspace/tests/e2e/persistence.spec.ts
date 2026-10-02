import { test, expect, Page, BrowserContext } from '@playwright/test';
import { PERSIST_TESTED_NOTES, BOARD_LOAD_BUDGET_MS, E2E_EVENTUAL_TIMEOUT_MS, LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';
import { createBoard } from './helpers/board';

/**
 * Helper: create a note on the board via the UI (double-click).
 */
async function createNoteAt(page: Page, x: number, y: number): Promise<void> {
  const viewport = page.getByTestId('board-viewport');
  await viewport.click({ position: { x, y }, clickCount: 2 });
}

/**
 * Helper: count notes on the board.
 */
async function countNotes(page: Page): Promise<number> {
  return page.locator('[data-testid^="sticky-note-"]').count();
}

/**
 * Helper: wait for notes to appear.
 */
async function waitForNotes(page: Page, expected: number, timeout = E2E_EVENTUAL_TIMEOUT_MS): Promise<void> {
  await expect
    .poll(async () => countNotes(page), { timeout })
    .toBe(expected);
}

/**
 * Helper: get note details from the page.
 */
async function getNoteDetails(page: Page): Promise<Array<{ text: string; x: number; y: number; color: string }>> {
  return page.evaluate(() => {
    const notes = document.querySelectorAll('[data-testid^="sticky-note-"]');
    return Array.from(notes).map((el) => {
      const noteEl = el as HTMLElement;
      const textEl = noteEl.querySelector('[data-testid="sticky-text"]');
      return {
        text: textEl?.textContent || '',
        x: parseFloat(noteEl.style.left || '0'),
        y: parseFloat(noteEl.style.top || '0'),
        color: noteEl.style.backgroundColor || '',
      };
    });
  });
}

/**
 * Helper: create a new browser context from the page's browser.
 */
async function newContext(page: Page): Promise<BrowserContext> {
  const browser = page.context().browser();
  if (!browser) throw new Error('No browser available');
  return browser.newContext();
}

test.describe('TC-19: Overnight return — board intact after everyone leaves', () => {
  test('25 notes survive DO hibernation and wake', async ({ page, context }) => {
    test.setTimeout(60000);
    const boardId = await createBoard();
    const boardUrl = `/b/${boardId}`;

    // Phase 1: Create 25 notes
    await page.setViewportSize({ width: 1400, height: 1200 });
    await page.goto(boardUrl);
    await expect(page.getByTestId('connection-status')).toHaveText(/Connected/, { timeout: E2E_EVENTUAL_TIMEOUT_MS });

    // Create 25 notes in a grid
    for (let i = 0; i < 25; i++) {
      const x = 100 + (i % 5) * 220;
      const y = 100 + Math.floor(i / 5) * 220;
      await createNoteAt(page, x, y);
    }

    // Verify all 25 notes are visible
    await waitForNotes(page, 25);

    // Get note details for later comparison
    const detailsBefore = await getNoteDetails(page);
    expect(detailsBefore).toHaveLength(25);

    // Close the browser context (everyone leaves → DO hibernates)
    await context.close();

    // Phase 2: Reopen the board (DO wakes from SQLite)
    const newCtx = await newContext(page);
    const page2 = await newCtx.newPage();
    await page2.goto(boardUrl);

    // Wait for connection and notes
    await expect(page2.getByTestId('connection-status')).toHaveText(/Connected/, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    await waitForNotes(page2, 25);

    // Verify notes are identical
    const detailsAfter = await getNoteDetails(page2);
    expect(detailsAfter).toHaveLength(25);

    // Compare text content
    const textsBefore = detailsBefore.map((d) => d.text).sort();
    const textsAfter = detailsAfter.map((d) => d.text).sort();
    expect(textsAfter).toEqual(textsBefore);

    await newCtx.close();
  });
});

test.describe('TC-20: Leave immediately — change seen by another person survives', () => {
  test('note visible to second user survives immediate exit and DO wake', async ({ page, context }) => {
    test.setTimeout(60000);
    const boardId = await createBoard();
    const boardUrl = `/b/${boardId}`;

    // Alex opens the board and creates a note
    await page.goto(boardUrl);
    await expect(page.getByTestId('connection-status')).toHaveText(/Connected/, { timeout: E2E_EVENTUAL_TIMEOUT_MS });

    // Alex creates a note
    await createNoteAt(page, 400, 300);
    await waitForNotes(page, 1);

    // Sam opens the board in a new context and sees the note
    const samCtx = await newContext(page);
    const samPage = await samCtx.newPage();
    await samPage.goto(boardUrl);
    await expect(samPage.getByTestId('connection-status')).toHaveText(/Connected/, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    await waitForNotes(samPage, 1);

    // Both close immediately (DO hibernates)
    await samCtx.close();
    await context.close();

    // Phase 2: Reopen and verify the note is there (DO wakes from SQLite)
    const newCtx = await newContext(page);
    const page3 = await newCtx.newPage();
    await page3.goto(boardUrl);
    await expect(page3.getByTestId('connection-status')).toHaveText(/Connected/, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    await waitForNotes(page3, 1);

    await newCtx.close();
  });
});

test.describe('TC-21: Big board open — PERSIST_TESTED_NOTES notes render', () => {
  test(`${PERSIST_TESTED_NOTES} notes render completely; load time logged`, async ({ page, context }) => {
    test.setTimeout(120000);
    const boardId = await createBoard();
    const boardUrl = `/b/${boardId}`;

    // Seed the board with PERSIST_TESTED_NOTES notes using Yjs directly
    await page.goto(boardUrl);
    await expect(page.getByTestId('connection-status')).toHaveText(/Connected/, { timeout: E2E_EVENTUAL_TIMEOUT_MS });

    // Use the debug hook to create notes programmatically (faster than UI)
    const noteCount = PERSIST_TESTED_NOTES;
    await page.evaluate(async (count: number) => {
      const { doc } = (window as any).__VIDI_DEBUG__;
      const Y = (window as any).__VIDI_Y__;
      const objects = doc.getMap('objects');
      
      const words = ['the', 'quick', 'brown', 'fox', 'jumps', 'over', 'lazy', 'dog',
        'sprint', 'planning', 'retro', 'backlog', 'story', 'point', 'design', 'review'];
      
      doc.transact(() => {
        for (let i = 0; i < count; i++) {
          const id = 'note-' + i;
          const m = new Y.Map();
          m.set('type', 'sticky');
          m.set('x', (i % 50) * 220);
          m.set('y', Math.floor(i / 50) * 220);
          m.set('color', ['yellow','orange','green','blue','pink','violet'][i % 6]);
          const text = new Y.Text();
          text.insert(0, words[i % words.length] + ' ' + words[(i+3) % words.length] + ' ' + i);
          m.set('text', text);
          m.set('z', i + 1);
          m.set('createdAt', Date.now());
          objects.set(id, m);
        }
      });
    }, noteCount);

    // Wait for all notes to render
    await expect
      .poll(async () => page.locator('[data-testid^="sticky-note-"]').count(), { timeout: 30000 })
      .toBe(PERSIST_TESTED_NOTES);

    // Close the first context (DO hibernates)
    await context.close();

    // Now open in a fresh context and measure load time (DO wakes from SQLite)
    const newCtx = await newContext(page);
    const page2 = await newCtx.newPage();
    
    const navStart = Date.now();
    await page2.goto(boardUrl);
    await expect(page2.getByTestId('connection-status')).toHaveText(/Connected/, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    
    // Wait for all notes to render
    await expect
      .poll(async () => page2.locator('[data-testid^="sticky-note-"]').count(), { timeout: 30000 })
      .toBe(PERSIST_TESTED_NOTES);
    const navEnd = Date.now();

    const loadTime = navEnd - navStart;
    console.log(`\n[TC-21] Board load time: ${loadTime}ms (budget: ${BOARD_LOAD_BUDGET_MS}ms) ${loadTime <= BOARD_LOAD_BUDGET_MS ? '✓' : '⚠ over budget'}`);

    await newCtx.close();
  });
});

test.describe('TC-24: Broken board — honest failure, edit lock, recovery', () => {
  test('corrupted snapshot shows red message; repair recovers without reload', async ({ page, context }) => {
    test.setTimeout(60000);
    const boardId = await createBoard();
    const boardUrl = `/b/${boardId}`;

    // Phase 1: Create a board with notes
    await page.goto(boardUrl);
    await expect(page.getByTestId('connection-status')).toHaveText(/Connected/, { timeout: E2E_EVENTUAL_TIMEOUT_MS });

    // Create some notes
    for (let i = 0; i < 5; i++) {
      await createNoteAt(page, 200 + i * 250, 300);
    }
    await waitForNotes(page, 5);
    await context.close();

    // Corrupt the snapshot via test hook
    const corruptResp = await fetch(`${page.url().replace(/\/b\/.*/, '')}/__test/boards/${boardId}/corrupt-snapshot`, { method: 'POST' });
    expect(corruptResp.status).toBe(200);

    // Phase 2: Open the board - should show red error message
    const newCtx = await newContext(page);
    const page2 = await newCtx.newPage();
    await page2.goto(boardUrl);

    // Wait for the load-failed message
    await expect(page2.getByTestId('connection-status')).toHaveText(
      /This board couldn.t be loaded\. Retrying/,
      { timeout: E2E_EVENTUAL_TIMEOUT_MS }
    );

    // Verify board is not editable (no notes visible)
    expect(await countNotes(page2)).toBe(0);

    // Verify the Sticky note button is disabled
    const stickyBtn = page2.getByRole('button', { name: 'Sticky note' });
    await expect(stickyBtn).toBeDisabled();

    // Phase 3: Repair and wait for recovery
    const repairResp = await fetch(`${page.url().replace(/\/b\/.*/, '')}/__test/boards/${boardId}/repair-snapshot`, { method: 'POST' });
    expect(repairResp.status).toBe(200);

    // Wait for the board to load (provider retries with backoff)
    // The room retries after LOAD_RETRY_MIN_INTERVAL_MS
    await expect(page2.getByTestId('connection-status')).toHaveText(/Connected/, {
      timeout: LOAD_RETRY_MIN_INTERVAL_MS + E2E_EVENTUAL_TIMEOUT_MS,
    });

    // Notes should appear
    await waitForNotes(page2, 5);

    // Creating a note should work now
    await createNoteAt(page2, 600, 400);
    await waitForNotes(page2, 6);

    await newCtx.close();
  });
});
