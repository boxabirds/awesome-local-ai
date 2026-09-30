import { test, expect } from '@playwright/test';
import {
  createParticipant,
  createBoardViaUi,
  expectEventually,
  type Participant,
} from './helpers/participants';

const TEXT_300 =
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor ' +
  'incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud ' +
  'exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat duis aute irure ' +
  'in reprehenderit.';

async function getTextCount(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() =>
    document.querySelectorAll('[role="group"][aria-label="Text"]').length,
  );
}

async function getTextContent(page: import('@playwright/test').Page, index: number): Promise<string> {
  return page.evaluate((i) => {
    const texts = document.querySelectorAll('[role="group"][aria-label="Text"]');
    const el = texts[i];
    if (!el) return '';
    const content = el.querySelector('[data-testid^="text-content-"]');
    return content?.textContent ?? '';
  }, index);
}

async function getTextWorldPos(
  page: import('@playwright/test').Page,
  index: number,
): Promise<{ x: number; y: number; width: number; height: number }> {
  return page.evaluate((i) => {
    const texts = document.querySelectorAll('[role="group"][aria-label="Text"]');
    const el = texts[i] as HTMLElement | undefined;
    if (!el) throw new Error(`text at index ${i} not found`);
    return {
      x: parseFloat(el.style.left),
      y: parseFloat(el.style.top),
      width: parseFloat(el.style.width),
      height: parseFloat(el.style.height),
    };
  }, index);
}

async function activateTextTool(page: import('@playwright/test').Page): Promise<void> {
  // Click the Text tool button in the toolbar
  await page.getByTestId('text-tool-btn').click();
}

async function createTextAtPoint(page: import('@playwright/test').Page, x: number, y: number): Promise<void> {
  await activateTextTool(page);
  await page.mouse.click(x, y);
  await page.waitForSelector('[data-testid="text-editor"]');
}

test.describe('Text objects', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'New board' }).click();
    await page.waitForSelector('[data-testid="board-viewport"]');
  });

  // TC-26 "Long annotation": press T, click, type the 300-character fixture →
  // stored width TEXT_MAX_AUTO_WIDTH_WORLD ±2, several rendered lines.
  test('TC-26: long annotation wraps at max width', async ({ page }) => {
    await createTextAtPoint(page, 400, 300);
    await page.keyboard.type(TEXT_300);
    await page.keyboard.press('Escape');

    // Text object should exist
    expect(await getTextCount(page)).toBe(1);

    // Content should match
    const content = await getTextContent(page, 0);
    expect(content).toBe(TEXT_300);

    // Width should be capped at 600 world units (TEXT_MAX_AUTO_WIDTH_WORLD)
    const pos = await getTextWorldPos(page, 0);
    // At zoom=1, world units = px on screen
    expect(Math.abs(pos.width - 600)).toBeLessThanOrEqual(2);

    // Should have several rendered lines (height > 1 line at M size = 20*1.3 = 26)
    expect(pos.height).toBeGreaterThan(26 * 2);
  });

  // TC-27 drag the right handle narrower → words rewrap, height grows, no top/bottom handles
  test('TC-27: drag e handle narrows text, height grows', async ({ page }) => {
    // Create text with long content
    await createTextAtPoint(page, 400, 300);
    await page.keyboard.type(TEXT_300);
    await page.keyboard.press('Escape');

    // Wait for toolbar to appear (single text selected)
    await page.waitForSelector('[data-testid="text-toolbar"]');

    // Get initial dimensions
    const before = await getTextWorldPos(page, 0);

    // Get the e handle position
    const handleE = page.getByTestId('handle-e');
    const eBox = await handleE.boundingBox();
    expect(eBox).not.toBeNull();

    // Drag e handle to the left (narrower)
    const startX = eBox!.x + eBox!.width / 2;
    const startY = eBox!.y + eBox!.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX - 150, startY, { steps: 5 });
    await page.mouse.up();

    // Text should now be narrower (fixed mode)
    const after = await getTextWorldPos(page, 0);
    expect(after.width).toBeLessThan(before.width);

    // Height should have grown (text rewrapped)
    expect(after.height).toBeGreaterThan(before.height);

    // Should have only horizontal handles (no n, s)
    await expect(page.getByTestId('handle-n')).not.toBeVisible();
    await expect(page.getByTestId('handle-s')).not.toBeVisible();
  });

  // TC-28 "Title a retro section": T, click, type "Went well", Escape,
  // click XL, drag over cluster, Delete, Ctrl+Z restores it.
  test('TC-28: full text lifecycle - create, size, move, delete, undo', async ({ page }) => {
    // Create text
    await createTextAtPoint(page, 400, 300);
    await page.keyboard.type('Went well');
    await page.keyboard.press('Escape');

    // Text object exists with content
    expect(await getTextCount(page)).toBe(1);
    expect(await getTextContent(page, 0)).toBe('Went well');

    // Click XL in toolbar
    await page.getByTestId('text-size-XL').click();

    // Size should change (font is 56px at XL)
    // Verify size in data
    const size = await page.evaluate(() => {
      const el = document.querySelector('[role="group"][aria-label="Text"]') as HTMLElement;
      return el?.style.fontSize ?? '';
    });
    expect(size).toContain('56');

    // Drag text to move it
    const textEl = page.locator('[role="group"][aria-label="Text"]').first();
    const box = await textEl.boundingBox();
    expect(box).not.toBeNull();
    const beforePos = await getTextWorldPos(page, 0);
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width / 2 + 100, box!.y + box!.height / 2 + 50, { steps: 3 });
    await page.mouse.up();

    const afterPos = await getTextWorldPos(page, 0);
    expect(afterPos.x).not.toBe(beforePos.x);
    expect(afterPos.y).not.toBe(beforePos.y);

    // Delete
    await page.keyboard.press('Delete');
    expect(await getTextCount(page)).toBe(0);

    // Undo restores it
    await page.keyboard.press('Control+z');
    await expectEventually(
      () => getTextCount(page),
      (count) => count === 1,
      'TC-28 undo restores text',
    );
  });

  // TC-31 "Abandoned text": T, click, Escape without typing → no text object in the doc;
  // Shift+drag over the spot selects nothing.
  test('TC-31: abandoned text creates nothing', async ({ page }) => {
    await createTextAtPoint(page, 400, 300);
    // Escape without typing
    await page.keyboard.press('Escape');

    // No text objects should exist
    expect(await getTextCount(page)).toBe(0);

    // Shift+drag marquee over that spot should select nothing
    await page.keyboard.down('Shift');
    await page.mouse.move(350, 250);
    await page.mouse.down();
    await page.mouse.move(500, 350, { steps: 3 });
    await page.mouse.up();
    await page.keyboard.up('Shift');

    // No selection toolbar should appear
    const hasOverlay = await page.evaluate(() =>
      document.querySelector('[data-testid="selection-bounding-box"]') !== null,
    );
    expect(hasOverlay).toBe(false);
  });
});

test.describe('Text objects collaboration', () => {
  let alex: Participant;
  let sam: Participant;
  let boardId: string;

  test.beforeEach(async ({ browser }) => {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    boardId = await createBoardViaUi(p);
    await ctx.close();
    alex = await createParticipant(browser, boardId);
    sam = await createParticipant(browser, boardId);
  });

  test.afterEach(async () => {
    await alex.context.close();
    await sam.context.close();
  });

  // TC-29: two contexts type into the same text simultaneously → identical text containing every character
  test('TC-29: concurrent editing converges', async () => {
    // Alex creates a text object
    await createTextAtPoint(alex.page, 400, 300);
    await alex.page.keyboard.type('Hello');
    await alex.page.keyboard.press('Escape');

    // Sam sees the text
    await expectEventually(
      () => getTextCount(sam.page),
      (count) => count === 1,
      'TC-29 Sam sees text',
    );

    // Both double-click the text to enter editing mode
    const alexText = alex.page.locator('[role="group"][aria-label="Text"]').first();
    const alexBox = await alexText.boundingBox();
    expect(alexBox).not.toBeNull();
    await alex.page.mouse.dblclick(alexBox!.x + alexBox!.width / 2, alexBox!.y + alexBox!.height / 2);

    const samText = sam.page.locator('[role="group"][aria-label="Text"]').first();
    const samBox = await samText.boundingBox();
    expect(samBox).not.toBeNull();
    await sam.page.mouse.dblclick(samBox!.x + samBox!.width / 2, samBox!.y + samBox!.height / 2);

    // Alex types at end
    await alex.page.keyboard.press('End');
    await alex.page.keyboard.type(' from Alex');

    // Sam types at end
    await sam.page.keyboard.press('End');
    await sam.page.keyboard.type(' from Sam');

    // Escape both
    await alex.page.keyboard.press('Escape');
    await sam.page.keyboard.press('Escape');

    // Converge: both should have identical text containing all characters
    await expectEventually(
      () => getTextContent(alex.page, 0),
      (text) => text.includes('Alex') && text.includes('Sam'),
      'TC-29 Alex has both texts',
    );

    await expectEventually(
      () => getTextContent(sam.page, 0),
      (text) => text.includes('Alex') && text.includes('Sam'),
      'TC-29 Sam has both texts',
    );

    // Both texts must be identical (Yjs convergence)
    const alexTextContent = await getTextContent(alex.page, 0);
    const samTextContent = await getTextContent(sam.page, 0);
    expect(alexTextContent).toBe(samTextContent);
  });

  // TC-30: MAX_CONCURRENT_EDITORS contexts each create a heading at once via the Text tool → all headings visible on every screen
  test('TC-30: multiple users create text concurrently', async ({ browser }) => {
    // Create 3 more participants (alex + sam already exist = 5 total)
    const others: Participant[] = [];
    for (let i = 0; i < 3; i++) {
      others.push(await createParticipant(browser, boardId));
    }

    const all = [alex, sam, ...others];
    const names = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'];

    // Each creates a text object
    for (let i = 0; i < all.length; i++) {
      const p = all[i];
      const x = 200 + i * 100;
      const y = 200 + i * 50;
      await createTextAtPoint(p.page, x, y);
      await p.page.keyboard.type(names[i]);
      await p.page.keyboard.press('Escape');
    }

    // Wait for convergence: all 5 text objects visible on all screens
    for (const p of all) {
      await expectEventually(
        () => getTextCount(p.page),
        (count) => count === all.length,
        `TC-30 all texts visible`,
      );
    }

    // Cleanup
    for (const p of others) {
      await p.context.close();
    }
  });
});
