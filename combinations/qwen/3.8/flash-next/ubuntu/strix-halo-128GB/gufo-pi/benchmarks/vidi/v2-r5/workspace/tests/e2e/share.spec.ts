import { test, expect } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';
import { E2E_EVENTUAL_TIMEOUT_MS, CREATE_BUDGET_MS } from '../../src/shared/config';
import { expectEventually, createNoteViaToolbar, readBoardNotes } from './helpers/participants';

async function waitForConnected(page: import('@playwright/test').Page, timeout = E2E_EVENTUAL_TIMEOUT_MS): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const state = await page.evaluate(() => (window as any).__vidi6?.connectionState);
    if (state === 'connected' || state === 'confirmed') return;
    await page.waitForTimeout(200);
  }
  throw new Error('Timed out waiting for connection');
}

async function initializeBoard(page: import('@playwright/test').Page, boardId: string): Promise<void> {
  const res = await page.request.post(`/__test/boards/${boardId}/initialize`);
  if (!res.ok()) throw new Error(`initialize failed: ${res.status()}`);
}

test.describe('TC-26: Create, share, join', () => {
  test('Maya creates board, adds note, shares link; Sam joins and edits; both see changes', async ({ browser }) => {
    // Grant clipboard permissions for Chromium
    const mayaContext = await browser.newContext({
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    const maya = await mayaContext.newPage();

    // Navigate to home page
    await maya.goto('/');
    await expect(maya.getByText('A shared board for thinking together')).toBeVisible();

    // Click New board and measure time
    const startTime = Date.now();
    await maya.getByRole('button', { name: 'New board' }).click();

    // Wait for the board to appear
    await expect(maya.getByTestId('board-viewport')).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
    await waitForConnected(maya);
    const clickToBoardMs = Date.now() - startTime;
    console.log(`[timing] TC-26 click-to-board: ${clickToBoardMs}ms (budget ${CREATE_BUDGET_MS}ms, NOT asserted)`);

    // Create a note
    const noteId = await createNoteViaToolbar(maya);

    // Share the board
    await maya.getByRole('button', { name: 'Share' }).click();
    await expect(maya.getByRole('dialog', { name: 'Share board' })).toBeVisible();

    // Copy link
    await maya.getByRole('button', { name: 'Copy link' }).click();
    await expect(maya.getByText(/Link copied/)).toBeVisible();

    // Read clipboard content (Chromium has clipboard permissions granted)
    const link = await maya.evaluate(() => navigator.clipboard.readText());
    expect(link).toMatch(/\/b\/[A-Za-z0-9_-]{22}$/);

    // Sam opens the link in a new context
    const samContext = await browser.newContext();
    const sam = await samContext.newPage();
    await sam.goto(link);
    await expect(sam.getByTestId('board-viewport')).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
    await waitForConnected(sam);

    // Sam sees the note Maya created
    await expectEventually('TC-26 Sam sees note', async () => {
      const notes = await readBoardNotes(sam);
      expect(notes.length).toBe(1);
      expect(notes[0]!.id).toBe(noteId);
    });

    // Sam edits the note (moves it)
    const noteEl = sam.locator(`[data-testid="sticky-note"][data-note-id="${noteId}"]`);
    const box = await noteEl.boundingBox();
    if (box) {
      const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      await sam.mouse.move(from.x, from.y);
      await sam.mouse.down();
      await sam.mouse.move(from.x + 80, from.y + 80, { steps: 3 });
      await sam.mouse.up();
    }

    // Maya sees Sam's edit
    await expectEventually('TC-26 Maya sees Sam edit', async () => {
      const mayaNotes = await readBoardNotes(maya);
      const samNotes = await readBoardNotes(sam);
      expect(mayaNotes[0]!.x).toBe(samNotes[0]!.x);
      expect(mayaNotes[0]!.y).toBe(samNotes[0]!.y);
    });

    await mayaContext.close();
    await samContext.close();
  });
});

test.describe('TC-27: Bad link recovery', () => {
  test('open unknown board link shows Board not found, New board creates fresh board', async ({ browser }) => {
    const fakeId = newBoardId(); // Never created
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(`/b/${fakeId}`);
    await expect(page.getByText('Board not found')).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });

    // Click New board from NotFoundPage
    await page.getByRole('button', { name: 'New board' }).click();
    await expect(page.getByTestId('board-viewport')).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
    await waitForConnected(page);

    // Verify it's a new empty board
    const notes = await readBoardNotes(page);
    expect(notes.length).toBe(0);

    await context.close();
  });
});

test.describe('TC-28: Flaky service on open', () => {
  test('board check aborts then succeeds, board opens without reload', async ({ browser }) => {
    const boardId = newBoardId();

    // First initialize the board server-side
    const initCtx = await browser.newContext();
    const initPage = await initCtx.newPage();
    await initializeBoard(initPage, boardId);
    await initCtx.close();

    const context = await browser.newContext();
    const page = await context.newPage();

    // Block all /api/boards/* requests
    await page.route('**/api/boards/**', (route) => route.abort());

    await page.goto(`/b/${boardId}`);

    // Should show retry message
    await expect(page.getByText("Couldn't reach vidi6. Retrying…")).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });

    // Remove the route block
    await page.unroute('**/api/boards/**');

    // Board should open without reload
    await expect(page.getByTestId('board-viewport')).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
    await waitForConnected(page);

    await context.close();
  });
});

test.describe('TC-29: Clipboard blocked', () => {
  test('writeText rejects triggers manual copy message and selection', async ({ browser }) => {
    const boardId = newBoardId();

    const context = await browser.newContext();
    const page = await context.newPage();

    // Initialize the board
    await initializeBoard(page, boardId);

    // Init script that makes writeText reject
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: () => Promise.reject(new Error('denied')) },
        writable: true,
        configurable: true,
      });
    });

    await page.goto(`/b/${boardId}`);
    await expect(page.getByTestId('board-viewport')).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });

    // Open share panel
    await page.getByRole('button', { name: 'Share' }).click();
    await expect(page.getByRole('dialog', { name: 'Share board' })).toBeVisible();

    // Click Copy link
    await page.getByRole('button', { name: 'Copy link' }).click();

    // Manual copy message appears
    await expect(page.getByText('Press Ctrl+C (Cmd+C on Mac) to copy')).toBeVisible({ timeout: 5000 });

    // Selection equals the full link
    const selection = await page.evaluate(() => {
      const input = document.querySelector<HTMLInputElement>('[aria-label="Board link"]');
      if (!input) return null;
      return { start: input.selectionStart, end: input.selectionEnd, value: input.value };
    });
    expect(selection).not.toBeNull();
    expect(selection!.start).toBe(0);
    expect(selection!.end).toBe(selection!.value.length);

    await context.close();
  });
});

test.describe('TC-31: Pre-existing (legacy) board', () => {
  test('legacy board with updates but no created_at opens correctly', async ({ browser }) => {
    const boardId = newBoardId();

    // Seed legacy board using Yjs in Node context
    const Y = await import('yjs');
    const doc = new Y.Doc();
    const objects = doc.getMap('objects');
    const noteMap = new Y.Map<any>();
    noteMap.set('type', 'sticky');
    noteMap.set('x', 100);
    noteMap.set('y', 200);
    noteMap.set('z', 1);
    noteMap.set('color', 'yellow');
    const text = new Y.Text();
    text.insert(0, 'legacy note');
    noteMap.set('text', text);
    objects.set('legacy-note-1', noteMap);

    // Encode as a Yjs update
    const update = Y.encodeStateAsUpdate(doc);
    const hex = Array.from(update).map(b => b.toString(16).padStart(2, '0')).join('');

    // Seed the legacy board
    const context = await browser.newContext();
    const page = await context.newPage();
    const seedRes = await page.request.post(`/__test/boards/${boardId}/seed-legacy`, {
      data: { updates: [hex] },
    });
    expect(seedRes.ok()).toBe(true);

    // Open the legacy board
    await page.goto(`/b/${boardId}`);
    await expect(page.getByTestId('board-viewport')).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
    await waitForConnected(page);

    // Verify the seeded note is there
    const seededNotes = await readBoardNotes(page);
    expect(seededNotes.length).toBeGreaterThanOrEqual(1);
    expect(seededNotes[0]!.text).toContain('legacy note');

    await context.close();
  });
});
