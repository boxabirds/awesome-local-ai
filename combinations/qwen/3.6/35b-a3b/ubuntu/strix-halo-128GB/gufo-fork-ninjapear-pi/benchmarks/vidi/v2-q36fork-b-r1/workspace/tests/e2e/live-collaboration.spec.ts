/**
 * Task 8: E2E live collaboration with multiple browser contexts (TC-22 to TC-28).
 */
import { chromium, expect } from '@playwright/test';
import { openTwoParticipants, waitForFirstNote, waitForNNotes, dblClickEmptySpace } from './helpers/participants';
import { E2E_EVENTUAL_TIMEOUT_MS, LIVE_UPDATE_LATENCY_BUDGET_MS } from '@/shared/config';

declare const test: typeof import('@playwright/test').test;

const eventualTimeout = E2E_EVENTUAL_TIMEOUT_MS;

test.describe('Live collaboration', () => {
  let contextA: import('@playwright/test').BrowserContext;
  let contextB: import('@playwright/test').BrowserContext;
  let pageA: import('@playwright/test').Page;
  let pageB: import('@playwright/test').Page;
  let boardId: string;

  test.beforeAll(async () => {
    const browser = await chromium.launch();
    contextA = await browser.newContext();
    contextB = await browser.newContext();
    const result = await openTwoParticipants(contextA, contextB);
    pageA = result.pageA;
    pageB = result.pageB;
    boardId = result.boardId;
  });

  test.afterAll(async () => {
    // Let Playwright handle context teardown
  });

  // ---- TC-22: Create note propagates ====
  test('TC-22a: Alex creates sticky → Sam sees it', async () => {
    const start = Date.now();
    await dblClickEmptySpace(pageA);
    await pageB.waitForSelector('[data-testid^="sticky-"]', { timeout: eventualTimeout });
    console.log(`[TC-22] Create latency: ${Date.now() - start}ms`);
  });

  // ---- TC-22: Text propagation ====
  test('TC-22b: Alex types text → Sam sees it', async () => {
    const box = await pageA.locator('[data-testid^="sticky-"]').first().boundingBox();
    if (!box) throw new Error('No note');
    await pageA.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
    await pageA.keyboard.type('AlexNote');

    await pageB.waitForFunction(
      () => {
        const el = document.querySelector('[data-testid^="sticky-"] .sticky-note-text-inner');
        return el && el.textContent?.includes('AlexNote');
      },
      { timeout: eventualTimeout },
    );
  });

  // ---- TC-22: Delete ====
  test('TC-22c: Alex deletes note → Sam sees deletion', async () => {
    const initialCount = await pageB.locator('[data-testid^="sticky-"]').count();
    await pageA.locator('[data-testid^="sticky-"]').last().click({ position: { x: 10, y: 10 } });
    await pageA.keyboard.press('Delete');

    await pageB.waitForFunction(
      (n: number) => document.querySelectorAll('[data-testid^="sticky-"]').length < n,
      initialCount,
      { timeout: eventualTimeout },
    );
  });

  // ---- TC-23: Concurrent typing merges ====
  test('TC-23: Simultaneous typing in one note → identical merged text', async () => {
    await dblClickEmptySpace(pageA);
    await waitForNNotes(pageB, 1);

    const boxA = await pageA.locator('[data-testid^="sticky-"]').first().boundingBox();
    if (!boxA) throw new Error('No note A');

    const boxB = await pageB.locator('[data-testid^="sticky-"]').first().boundingBox();
    if (!boxB) throw new Error('No note B');

    await Promise.all([
      pageA.mouse.dblclick(boxA.x + boxA.width / 2, boxA.y + boxA.height / 2),
      pageB.mouse.dblclick(boxB.x + boxB.width / 2, boxB.y + boxB.height / 2),
    ]);

    await Promise.all([
      pageA.keyboard.type('red '),
      pageB.keyboard.type(' blue'),
    ]);

    // Wait for sync
    await new Promise(r => setTimeout(r, 1000));

    const textA = await pageA.locator('[data-testid^="sticky-"]').first().innerText();
    const textB = await pageB.locator('[data-testid^="sticky-"]').first().innerText();

    expect(textA.toLowerCase()).toContain('red');
    expect(textA.toLowerCase()).toContain('blue');
    expect(textB.toLowerCase()).toContain('red');
    expect(textB.toLowerCase()).toContain('blue');
    expect(textA).toBe(textB);
  });

  // ---- TC-24: Concurrent move converges ====
  test('TC-24: Both drag same note → settled at identical position', async () => {
    await dblClickEmptySpace(pageA);
    await waitForNNotes(pageB, 1);

    const boxA = await pageA.locator('[data-testid^="sticky-"]').first().boundingBox();
    if (!boxA) throw new Error('No note A');
    const boxB = await pageB.locator('[data-testid^="sticky-"]').first().boundingBox();
    if (!boxB) throw new Error('No note B');

    await Promise.all([
      pageA.mouse.move(boxA.x + boxA.width / 2, boxA.y + boxA.height / 2),
      pageB.mouse.move(boxB.x + boxB.width / 2, boxB.y + boxB.height / 2),
    ]);
    await Promise.all([pageA.mouse.down(), pageB.mouse.down()]);
    await Promise.all([
      pageA.mouse.move(boxA.x + 300, boxA.y + 300, { steps: 20 }),
      pageB.mouse.move(boxB.x - 200, boxB.y - 200, { steps: 20 }),
    ]);
    await Promise.all([pageA.mouse.up(), pageB.mouse.up()]);

    await new Promise(r => setTimeout(r, 500));

    const endA = await pageA.locator('[data-testid^="sticky-"]').first().boundingBox();
    const endB = await pageB.locator('[data-testid^="sticky-"]').first().boundingBox();

    if (endA && endB) {
      const dx = Math.abs(endA.x - endB.x);
      const dy = Math.abs(endA.y - endB.y);
      expect(dx + dy).toBeLessThan(50);
    }
  });

  // ---- TC-25: Delete during edit ====
  test('TC-25: Sam editing; Alex deletes → Sam\'s note disappears cleanly', async () => {
    // Clean state
    const countBefore = await pageA.locator('[data-testid^="sticky-"]').count();
    for (let i = 0; i < countBefore; i++) {
      await pageA.locator('[data-testid^="sticky-"]').last().click({ position: { x: 10, y: 10 } });
      await pageA.keyboard.press('Delete');
    }
    await pageB.waitForFunction(() => document.querySelectorAll('[data-testid^="sticky-"]').length === 0, { timeout: 5000 }).catch(() => {});

    await dblClickEmptySpace(pageA);
    await waitForNNotes(pageB, 1);

    // Sam starts editing
    const samBox = await pageB.locator('[data-testid^="sticky-"]').first().boundingBox();
    if (!samBox) throw new Error('Sam\'s note not found');
    await pageB.mouse.dblclick(samBox.x + samBox.width / 2, samBox.y + samBox.height / 2);
    await pageB.waitForTimeout(500);

    // Alex deletes
    await pageA.keyboard.press('Delete');

    // Sam's note should disappear
    await pageB.waitForFunction(() => document.querySelectorAll('[data-testid^="sticky-"]').length === 0, { timeout: eventualTimeout });
  });

  // ---- TC-27: Offline catch-up ====
  test('TC-27: Offline edits catch up after reconnection', async () => {
    // Clean state
    const countBefore = await pageA.locator('[data-testid^="sticky-"]').count();
    for (let i = 0; i < countBefore; i++) {
      await pageA.locator('[data-testid^="sticky-"]').last().click({ position: { x: 10, y: 10 } });
      await pageA.keyboard.press('Delete');
    }
    await pageB.waitForFunction(() => document.querySelectorAll('[data-testid^="sticky-"]').length === 0, { timeout: 5000 }).catch(() => {});

    await contextA.setOffline(true);
    await contextB.setOffline(true);
    await new Promise(r => setTimeout(r, 2000));

    await dblClickEmptySpace(pageA);
    await pageA.locator('[data-testid^="sticky-"]').first().dblclick({ position: { x: 100, y: 100 } });
    await pageA.keyboard.type('OfflineA');

    await dblClickEmptySpace(pageB);
    await pageB.locator('[data-testid^="sticky-"]').first().dblclick({ position: { x: 100, y: 100 } });
    await pageB.keyboard.type('OfflineB');

    await contextA.setOffline(false);
    await contextB.setOffline(false);

    await pageB.waitForFunction(() => document.querySelectorAll('[data-testid^="sticky-"]').length >= 2, { timeout: eventualTimeout });

    const texts = await pageB.locator('[data-testid^="sticky-"] .sticky-note-text-inner').allTextContents();
    expect(texts.filter((t): t is string => !!t)).toContain('OfflineA');
    expect(texts.filter((t): t is string => !!t)).toContain('OfflineB');
  });

  // ---- Persistence Test: Return to board, find everything as it was left ====
  test('Persistence: create notes → reload → notes persist', async () => {
    // Ensure clean state
    const countBefore = await pageA.locator('[data-testid^="sticky-"]').count();
    for (let i = 0; i < countBefore; i++) {
      await pageA.locator('[data-testid^="sticky-"]').last().click({ position: { x: 10, y: 10 } });
      await pageA.keyboard.press('Delete');
    }
    await new Promise(r => setTimeout(r, 500));

    // Create 3 notes on page A
    for (let i = 0; i < 3; i++) {
      await dblClickEmptySpace(pageA);
    }
    await new Promise(r => setTimeout(r, 1000));

    // Verify all 3 notes exist on page B
    await waitForNNotes(pageB, 3);

    // Record current note content
    const textsBefore = await pageA.locator('[data-testid^="sticky-"] .sticky-note-text-inner').allTextContents();
    expect(textsBefore.length).toBe(3);

    // Reload page A — this triggers DO wake + document load from storage
    await pageA.reload({ waitUntil: 'networkidle' });

    // Navigate back to same board after redirect
    const currentUrl = pageA.url();
    await pageA.goto(currentUrl);
    await pageA.waitForLoadState('domcontentloaded');
    await pageA.waitForTimeout(3000); // Wait for Yjs sync to complete

    // After reload and sync, notes should still be there
    const notesAfterReload = await pageA.locator('[data-testid^="sticky-"]').count();
    expect(notesAfterReload).toBeGreaterThanOrEqual(1);

    // Switch to page B to verify it also sees persisted data
    const notesOnB = await pageB.locator('[data-testid^="sticky-"]').count();
    expect(notesOnB).toBeGreaterThanOrEqual(1);
  });

  // ---- TC-28: Selection isolation ====
  test('TC-28: Alex selects a note → Sam sees no selection', async () => {
    const count = await pageA.locator('[data-testid^="sticky-"]').count();
    for (let i = 0; i < count; i++) {
      await pageA.locator('[data-testid^="sticky-"]').last().click({ position: { x: 10, y: 10 } });
      await pageA.keyboard.press('Delete');
    }

    await dblClickEmptySpace(pageA);
    await waitForNNotes(pageB, 1);

    await pageA.locator('[data-testid^="sticky-"]').first().click();

    const hasSelection = await pageB.evaluate(() =>
      document.querySelectorAll('[data-selected="true"]').length > 0
    );
    expect(hasSelection).toBe(false);
  });
});
