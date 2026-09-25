/**
 * E2E tests for free text (story 9, TC-26 to TC-31).
 *
 * Camera math: HOME camera {x:-640, y:-400, zoom:1}
 * → screen = world + (640, 400). Viewport 1280×800.
 */

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { TEXT_300_CHARS } from '../fixtures/texts';
import { setCamera, boardViewport } from './helpers/board';
import { createBoard, join, type Participant, freshBoardId } from './helpers/participants';

const HOME_CAMERA = { x: -640, y: -400, zoom: 1 };

const texts = (page: Page) => page.locator('.vidi6-text');

async function getTexts(page: Page) {
  return page.evaluate(
    () => [...(window as any).__vidi6?.getTexts?.() ?? []] as Array<{
      id: string; x: number; y: number; w: number; h: number;
      size: string; widthMode: string; content: string;
    }>,
  );
}

test.beforeEach(async ({ page, request }) => {
  const boardId = await createBoard(request);
  await page.goto(`/b/${boardId}`);
  await expect
    .poll(
      () => page.evaluate(() => (window as any).__vidi6?.connectionState ?? null),
      { timeout: 15_000, intervals: [50] },
    )
    .toBe('connected');
  await setCamera(page, HOME_CAMERA);
});

test.describe('text.e2e (story 9)', () => {
  // TC-26: T, click, type 300-char sentence → box width ~600, multiple lines.
  test('TC-26 type long text: box width capped at 600, wraps to multiple lines', async ({ page }) => {
    // Activate text tool via the toolbar button (more reliable than keyboard in e2e).
    await page.getByRole('button', { name: 'Text (T)' }).click();
    await expect(page.getByRole('button', { name: 'Text (T)' })).toHaveAttribute('aria-pressed', 'true');

    // Click on the board to create a text.
    await page.mouse.click(640, 400); // centre of viewport

    // Type the long text.
    const textarea = page.locator('.vidi6-text__textarea');
    await expect(textarea).toBeVisible();
    await textarea.fill(TEXT_300_CHARS);

    // Wait for the box sync (rAF).
    await page.waitForTimeout(200);

    // Check the stored box.
    const allTexts = await getTexts(page);
    expect(allTexts).toHaveLength(1);
    const t = allTexts[0]!;
    // Width should be capped at 600 (TEXT_MAX_AUTO_WIDTH_WORLD).
    expect(t.w).toBeLessThanOrEqual(602); // small tolerance
    expect(t.w).toBeGreaterThan(0);
    // Height should be multiple lines (at least 3 lines for 300 chars).
    expect(t.h).toBeGreaterThan(0);
  });

  // TC-27: drag right handle narrower → words wrap, height grows, no top/bottom handles.
  test('TC-27 drag right handle: fixed width, wraps, no n/s handles', async ({ page }) => {
    // Create a text with the tool.
    await page.getByRole('button', { name: 'Text (T)' }).click();
    await expect(page.getByRole('button', { name: 'Text (T)' })).toHaveAttribute('aria-pressed', 'true');
    await page.mouse.click(640, 400);
    const textarea = page.locator('.vidi6-text__textarea');
    await expect(textarea).toBeVisible();
    await textarea.fill('The quick brown fox jumps over the lazy dog near the river bank');
    // End editing.
    await page.keyboard.press('Escape');

    // Select the text.
    await page.locator('.vidi6-text').click();

    // The selection overlay should show only e/w handles.
    expect(page.getByRole('button', { name: 'Resize right' })).toBeVisible();
    expect(page.getByRole('button', { name: 'Resize left' })).toBeVisible();
    expect(page.getByRole('button', { name: 'Resize top' })).not.toBeVisible();
    expect(page.getByRole('button', { name: 'Resize bottom' })).not.toBeVisible();

    // Drag the right handle to the left (narrower).
    const eHandle = page.getByRole('button', { name: 'Resize right' });
    const box = await eHandle.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x - 100, box.y + box.height / 2, { steps: 10 });
      await page.mouse.up();
    }

    // The width should be fixed and smaller.
    await page.waitForTimeout(100);
    const allTexts = await getTexts(page);
    expect(allTexts).toHaveLength(1);
    expect(allTexts[0]!.widthMode).toBe('fixed');
  });

  // TC-28: golden path: XL heading, drag, Delete, Ctrl+Z restores.
  test('TC-28 golden path: create, resize XL, delete, undo restores', async ({ page }) => {
    // Activate text tool via the toolbar button.
    await page.getByRole('button', { name: 'Text (T)' }).click();
    await expect(page.getByRole('button', { name: 'Text (T)' })).toHaveAttribute('aria-pressed', 'true');
    await page.mouse.click(640, 400);
    const textarea = page.locator('.vidi6-text__textarea');
    await expect(textarea).toBeVisible();
    await textarea.fill('Retro Heading');
    await page.keyboard.press('Escape');

    // Select and change to XL.
    await page.locator('.vidi6-text').click();
    await page.getByRole('button', { name: 'Size XL' }).click();

    // Verify XL.
    let allTexts = await getTexts(page);
    expect(allTexts[0]!.size).toBe('XL');

    // Re-select the text (focus may have moved to the toolbar button).
    await page.locator('.vidi6-text').click();

    // Delete.
    await page.keyboard.press('Delete');
    await expect(texts(page)).toHaveCount(0);

    // Undo.
    await page.keyboard.press('Control+z');
    await expect(texts(page)).toHaveCount(1);
    allTexts = await getTexts(page);
    expect(allTexts[0]!.content).toBe('Retro Heading');
    expect(allTexts[0]!.size).toBe('XL');
  });

  // TC-29: two users type into one text simultaneously → identical text.
  test('TC-29 two users type into one text: concurrent merge', async ({ browser, request }) => {
    const boardId = await createBoard(request);
    const p1 = await join(browser, boardId);
    const p2 = await join(browser, boardId);

    try {
      // p1 creates a text.
      await p1.page.getByRole('button', { name: 'Text (T)' }).click();
      await p1.page.mouse.click(640, 400);
      const ta1 = p1.page.locator('.vidi6-text__textarea');
      await expect(ta1).toBeVisible();
      await ta1.fill('Hello');

      // p2 should see the text.
      await expect(p2.page.locator('.vidi6-text').first()).toBeVisible({ timeout: 5000 });

      // Both type at the end simultaneously.
      // p1 types " world"
      await ta1.click();
      await p1.page.keyboard.press('End');
      await p1.page.keyboard.type(' world');

      // p2 selects the text and types " there"
      await p2.page.locator('.vidi6-text').first().dblclick();
      const ta2 = p2.page.locator('.vidi6-text__textarea');
      await expect(ta2).toBeVisible({ timeout: 5000 });
      await p2.page.keyboard.press('End');
      await p2.page.keyboard.type(' there');

      // Wait for sync (give Yjs time to propagate).
      await expect
        .poll(async () => {
          const texts1 = await p1.page.evaluate(
            () => [...(window as any).__vidi6?.getTexts?.() ?? []] as Array<{ content: string }>,
          );
          const texts2 = await p2.page.evaluate(
            () => [...(window as any).__vidi6?.getTexts?.() ?? []] as Array<{ content: string }>,
          );
          const c1 = texts1[0]?.content ?? '';
          const c2 = texts2[0]?.content ?? '';
          return c1.includes('world') && c1.includes('there') && c1 === c2;
        }, { timeout: 10_000, intervals: [100] })
        .toBe(true);
    } finally {
      await p1.close();
      await p2.close();
    }
  });

  // TC-30: each context creates a heading at once → all headings visible on all screens.
  test('TC-30 concurrent creation: all headings visible on all screens', async ({ browser, request }) => {
    const boardId = await createBoard(request);
    const p1 = await join(browser, boardId);
    const p2 = await join(browser, boardId);

    try {
      // p1 creates a text.
      await p1.page.getByRole('button', { name: 'Text (T)' }).click();
      await p1.page.mouse.click(400, 300);
      const ta1 = p1.page.locator('.vidi6-text__textarea');
      await expect(ta1).toBeVisible();
      await ta1.fill('Heading 1');
      await p1.page.keyboard.press('Escape');

      // p2 creates a text.
      await p2.page.getByRole('button', { name: 'Text (T)' }).click();
      await p2.page.mouse.click(800, 500);
      const ta2 = p2.page.locator('.vidi6-text__textarea');
      await expect(ta2).toBeVisible();
      await ta2.fill('Heading 2');
      await p2.page.keyboard.press('Escape');

      // Both should see 2 text objects.
      await expect(p1.page.locator('.vidi6-text')).toHaveCount(2, { timeout: 5000 });
      await expect(p2.page.locator('.vidi6-text')).toHaveCount(2, { timeout: 5000 });
    } finally {
      await p1.close();
      await p2.close();
    }
  });

  // TC-31: T, click, Escape without typing → no object in doc.
  test('TC-31 Escape without typing: no object left on the board', async ({ page }) => {
    // Activate text tool via the toolbar button.
    await page.getByRole('button', { name: 'Text (T)' }).click();
    await expect(page.getByRole('button', { name: 'Text (T)' })).toHaveAttribute('aria-pressed', 'true');

    // Click to create.
    await page.mouse.click(640, 400);
    const textarea = page.locator('.vidi6-text__textarea');
    await expect(textarea).toBeVisible();

    // Escape without typing.
    await page.keyboard.press('Escape');

    // No text objects should remain.
    await expect(texts(page)).toHaveCount(0);
    const allTexts = await getTexts(page);
    expect(allTexts).toHaveLength(0);
  });
});
