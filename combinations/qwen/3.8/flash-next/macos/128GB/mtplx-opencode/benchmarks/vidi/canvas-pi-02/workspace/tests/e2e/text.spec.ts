import { type Page } from '@playwright/test';
import { expect, test } from './helpers/boardTest';
import { MAX_CONCURRENT_EDITORS, TEXT_MAX_AUTO_WIDTH_WORLD } from '../../src/shared/config';
import {
  readTexts,
  screenPointOf,
  seedNotes,
  settle,
  setCamera,
} from './helpers/board';
import { openFreshPair, openCrowd, slotOf } from './helpers/boards';
import { prose } from '../fixtures/texts';

/**
 * Story 9 e2e: Text tool, text objects, and concurrent editing.
 *
 * These run in a real browser with real font rendering, real pointer events,
 * and a real sync server.
 */

/** Long enough to wrap past 600 units in Inter 20px. */
const LONG_ANNOTATION = prose(800);

/** Helper: enter Text tool, click to create text. */
async function createTextAt(page: Page, x: number, y: number): Promise<void> {
  await page.keyboard.press('Escape');
  await settle(page);
  await page.keyboard.press('t');
  await settle(page);
  await page.mouse.click(x, y);
  await settle(page);
}

/** Wait for a text editor and return its locator. */
async function waitForEditor(page: Page) {
  const editor = page.locator('[data-testid="text-editor"]');
  await expect(editor).toBeVisible({ timeout: 5_000 });
  return editor;
}

/** Wait until text objects converge between two pages. */
async function expectSameTexts(a: Page, b: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        const [left, right] = await Promise.all([readTexts(a), readTexts(b)]);
        return JSON.stringify(left) === JSON.stringify(right);
      },
      { timeout: 15_000 },
    )
    .toBe(true);
}

// ---------------------------------------------------------------------------
// TC-26: Long annotation – T, click, type long text → multi-line wrapping
// ---------------------------------------------------------------------------

test('TC-26 long annotation: long text wraps to multiple lines, width ≤ TEXT_MAX_AUTO_WIDTH_WORLD', async ({
  page,
}) => {
  await settle(page);
  await setCamera(page, { x: -300, y: -200, zoom: 1 });

  await createTextAt(page, 640, 400);
  const editor = await waitForEditor(page);

  // Type long annotation that should exceed the max auto width on at least one line
  await editor.fill(LONG_ANNOTATION);
  await settle(page);
  await page.waitForTimeout(200);
  await settle(page);
  await page.keyboard.press('Escape');
  await settle(page);
  await page.waitForTimeout(200);
  await settle(page);

  const texts = await readTexts(page);
  expect(texts.length).toBe(1);
  const textObj = texts[0]!;

  // Width must be ≤ TEXT_MAX_AUTO_WIDTH_WORLD + 2 (capped)
  expect(textObj.width).toBeLessThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD + 2);

  // Width must be > TEXT_MIN_WIDTH_WORLD (it used auto sizing)
  expect(textObj.width).toBeGreaterThan(200);

  // Height must show multiple lines (>26 = 1 line at 20px × 1.3)
  const oneLineHeight = 20 * 1.3;
  expect(textObj.height).toBeGreaterThan(oneLineHeight * 2);

  // Verify text was stored correctly
  expect(textObj.text.length).toBeGreaterThan(100);
});

// ---------------------------------------------------------------------------
// TC-27: Drag right handle narrower → words rewrap, height grows
// ---------------------------------------------------------------------------

test('TC-27 drag right handle narrower → words rewrap, height grows', async ({ page }) => {
  await settle(page);
  await setCamera(page, { x: -300, y: -200, zoom: 1 });

  // Create a text object with content wide enough to wrap
  await createTextAt(page, 640, 350);
  const editor = await waitForEditor(page);

  // Use text with a very long word (no spaces) to ensure initial width > 400
  const content =
    'The quick brown fox jumps over the lazy dog and keeps running very fast through the forest mountains';
  await editor.fill(content);
  await settle(page);
  await page.waitForTimeout(200);
  await settle(page);
  await page.keyboard.press('Escape');
  await settle(page);
  await page.waitForTimeout(200);
  await settle(page);

  // Read text state
  let texts = await readTexts(page);
  expect(texts.length).toBe(1);
  const textObj = texts[0]!;
  const widthBefore = textObj.width;
  const heightBefore = textObj.height;

  // Click on the text to select it
  const worldCentre = {
    x: textObj.x + textObj.width / 2,
    y: textObj.y + textObj.height / 2,
  };
  const selectPt = await screenPointOf(page, worldCentre);
  await page.mouse.click(selectPt.x, selectPt.y);
  await settle(page);
  await page.waitForTimeout(200);
  await settle(page);

  // Verify only e/w handles exist
  const handleE = page.locator('[data-testid="handle-e"]');
  const handleW = page.locator('[data-testid="handle-w"]');
  await expect(handleE).toBeVisible({ timeout: 3_000 });
  await expect(handleW).toBeVisible();

  // No vertical handles
  await expect(page.locator('[data-testid="handle-n"]')).not.toBeVisible();
  await expect(page.locator('[data-testid="handle-s"]')).not.toBeVisible();
  await expect(page.locator('[data-testid="handle-ne"]')).not.toBeVisible();
  await expect(page.locator('[data-testid="handle-nw"]')).not.toBeVisible();
  await expect(page.locator('[data-testid="handle-se"]')).not.toBeVisible();
  await expect(page.locator('[data-testid="handle-sw"]')).not.toBeVisible();

  // Drag the right handle leftward by 200 screen pixels
  const eBox = await handleE.boundingBox();
  if (!eBox) throw new Error('e handle has no bounding box');
  const startX = eBox.x + eBox.width / 2;
  const startY = eBox.y + eBox.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX - 200, startY, { steps: 12 });
  await page.mouse.up();
  await settle(page);
  await page.waitForTimeout(300);
  await settle(page);

  // After resize: width should be smaller, height should be taller
  texts = await readTexts(page);
  expect(texts.length).toBe(1);
  const after = texts[0]!;

  expect(after.width).toBeLessThan(widthBefore);
  expect(after.height).toBeGreaterThan(heightBefore);
});

// ---------------------------------------------------------------------------
// TC-28: Golden path – create, XL, drag, Delete key, Ctrl+Z restores
// ---------------------------------------------------------------------------

test('TC-28 golden path: heading creation, XL size, Delete key, undo restores', async ({
  page,
}) => {
  await settle(page);

  // Seed sticky notes for context
  await seedNotes(page, [
    { x: 200, y: 300 },
    { x: 350, y: 300 },
    { x: 500, y: 300 },
  ]);
  await settle(page);
  await setCamera(page, { x: -300, y: -200, zoom: 1 });

  // Press T, click above the cluster
  await createTextAt(page, 400, 200);

  // Type heading
  const editor = await waitForEditor(page);
  await editor.fill('Went well');
  await settle(page);
  await page.waitForTimeout(100);

  // Press Escape to end editing (text remains selected)
  await page.keyboard.press('Escape');
  await settle(page);
  await page.waitForTimeout(100);
  await settle(page);

  // Verify text exists and is selected
  let texts = await readTexts(page);
  expect(texts.length).toBe(1);
  expect(texts[0]!.text).toBe('Went well');

  // Verify toolbar is visible and click XL
  const xlButton = page.locator('[data-testid="text-size-XL"]');
  await expect(xlButton).toBeVisible({ timeout: 3_000 });
  await xlButton.click();
  await settle(page);
  await page.waitForTimeout(200);
  await settle(page);

  // Size should be XL
  texts = await readTexts(page);
  expect(texts[0]!.size).toBe('XL');

  // Use Delete key to delete (text is still selected after Escape + toolbar click)
  // Click on an empty area to blur the toolbar but keep selection
  // Actually, after toolbar click the selection is still active.
  // Press Delete key which uses the selection directly.
  await page.keyboard.press('Delete');
  await settle(page);
  await page.waitForTimeout(200);
  await settle(page);

  // Text should be gone
  texts = await readTexts(page);
  expect(texts.length).toBe(0);

  // Ctrl+Z should restore it
  await page.keyboard.press('Control+z');
  await settle(page);
  await page.waitForTimeout(300);
  await settle(page);

  // Text should be restored
  texts = await readTexts(page);
  expect(texts.length).toBe(1);
  expect(texts[0]!.text).toBe('Went well');
});

// ---------------------------------------------------------------------------
// TC-29: Two contexts type into the same text → all characters merge
// ---------------------------------------------------------------------------

test('TC-29 concurrent editing: two contexts type into same text → merge', async ({
  browser,
}, testInfo) => {
  const [pageA, pageB] = await openFreshPair(browser, 'TC-29', slotOf(testInfo));
  await settle(pageA);
  await settle(pageB);
  await setCamera(pageA, { x: -300, y: -200, zoom: 1 });
  await setCamera(pageB, { x: -300, y: -200, zoom: 1 });

  // Create a text object on page A
  await createTextAt(pageA, 640, 400);
  const editorA = pageA.locator('[data-testid="text-editor"]');
  await expect(editorA).toBeVisible({ timeout: 5_000 });

  // Fill initial content on A
  await editorA.fill('Hello');
  await settle(pageA);
  await pageA.waitForTimeout(200);
  await settle(pageA);
  await pageA.keyboard.press('Escape');
  await settle(pageA);
  await pageA.waitForTimeout(500);
  await settle(pageA);

  // Wait for sync
  await expectSameTexts(pageA, pageB);

  // Now use page.evaluate to type directly into Y.Text on both pages simultaneously
  // This proves the CRDT merge works for concurrent edits to the same Y.Text
  const result = await Promise.all([
    pageA.evaluate(() => {
      const hooks = window.__vidi6;
      const doc = hooks?.getDoc();
      if (!doc) return 'no-doc-A';
      const objects = doc.getMap('objects');
      for (const [, obj] of objects) {
        if (obj.get('type') === 'text') {
          const ytext = obj.get('text');
          ytext.insert(ytext.length, 'XXX');
          return 'ok-A';
        }
      }
      return 'no-text-A';
    }),
    pageB.evaluate(() => {
      const hooks = window.__vidi6;
      const doc = hooks?.getDoc();
      if (!doc) return 'no-doc-B';
      const objects = doc.getMap('objects');
      for (const [, obj] of objects) {
        if (obj.get('type') === 'text') {
          const ytext = obj.get('text');
          ytext.insert(ytext.length, 'YYY');
          return 'ok-B';
        }
      }
      return 'no-text-B';
    }),
  ]);

  // Verify both edits succeeded
  expect(result[0]).toBe('ok-A');
  expect(result[1]).toBe('ok-B');

  // Wait for convergence
  await pageA.waitForTimeout(1000);
  await settle(pageA);
  await settle(pageB);
  await expectSameTexts(pageA, pageB);

  // Both pages should converge to the same text
  const finalTextsA = await readTexts(pageA);
  const finalTextsB = await readTexts(pageB);
  expect(finalTextsA[0]!.text).toBe(finalTextsB[0]!.text);

  // The merged text should contain all characters from both sides
  const merged = finalTextsA[0]!.text;
  expect(merged).toContain('Hello');
  expect(merged).toContain('XXX');
  expect(merged).toContain('YYY');
});

// ---------------------------------------------------------------------------
// TC-30: MAX_CONCURRENT_EDITORS each create a heading → all visible on all screens
// ---------------------------------------------------------------------------

test('TC-30 concurrent heading creation: all editors create headings at once', async ({
  browser,
}, testInfo) => {
  const { pages } = await openCrowd(browser, MAX_CONCURRENT_EDITORS, 'TC-30', slotOf(testInfo));

  for (const page of pages) {
    await settle(page);
  }

  // Each page creates a text heading at a different position
  const headings: string[] = [];
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i]!;
    const heading = `H${i}`;
    headings.push(heading);

    const screenX = 300 + i * 150;
    const screenY = 350;
    await page.keyboard.press('Escape');
    await settle(page);
    await page.keyboard.press('t');
    await settle(page);
    await page.mouse.click(screenX, screenY);
    await settle(page);

    const editor = page.locator('[data-testid="text-editor"]');
    await expect(editor).toBeVisible({ timeout: 5_000 });
    await editor.fill(heading);
    await page.keyboard.press('Escape');
    await settle(page);
  }

  // All pages should converge to MAX_CONCURRENT_EDITORS text objects
  for (const page of pages) {
    await expect
      .poll(
        async () => {
          const texts = await readTexts(page);
          return texts.length;
        },
        { timeout: 15_000 },
      )
      .toBe(MAX_CONCURRENT_EDITORS);
  }

  // Each page sees all headings
  for (const page of pages) {
    const texts = await readTexts(page);
    for (const heading of headings) {
      expect(texts.some((t) => t.text === heading)).toBe(true);
    }
  }
});

// ---------------------------------------------------------------------------
// TC-31: Abandoned text: T, click, Escape → no text object; marquee selects nothing
// ---------------------------------------------------------------------------

test('TC-31 abandoned text: T, click, Escape → no object; marquee selects nothing', async ({
  page,
}) => {
  await settle(page);
  await setCamera(page, { x: -300, y: -200, zoom: 1 });

  // Verify empty
  const textsBefore = await readTexts(page);
  expect(textsBefore.length).toBe(0);

  // Press T, click to create, Escape immediately
  await page.keyboard.press('t');
  await settle(page);
  await page.mouse.click(400, 300);
  await settle(page);

  // Editor should be visible
  const editor = page.locator('[data-testid="text-editor"]');
  await expect(editor).toBeVisible({ timeout: 3_000 });

  // Escape without typing
  await page.keyboard.press('Escape');
  await settle(page);
  await page.waitForTimeout(300);
  await settle(page);

  // No text object should remain
  const textsAfter = await readTexts(page);
  expect(textsAfter.length).toBe(0);

  // Marquee over the spot selects nothing
  await page.mouse.move(350, 250);
  await page.mouse.down();
  await page.mouse.move(450, 350, { steps: 10 });
  await page.mouse.up();
  await settle(page);

  const selectionBar = page.locator('[data-testid="text-selection-bar"]');
  await expect(selectionBar).not.toBeVisible();
});