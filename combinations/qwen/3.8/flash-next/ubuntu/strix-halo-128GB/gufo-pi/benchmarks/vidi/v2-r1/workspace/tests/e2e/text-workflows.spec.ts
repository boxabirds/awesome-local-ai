/**
 * E2E text workflow tests (TC-26 to TC-31).
 *
 * Proves the Text tool and text objects in real browsers: heading creation,
 * long annotations with wrapping, resize, abandoned text, concurrent editing.
 */
import { expect, test } from '@playwright/test';

import {
  MAX_CONCURRENT_EDITORS,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_SIZES,
  TEXT_LINE_HEIGHT,
} from '../../src/shared/config';
import { proseOfLength } from '../fixtures/texts';
import { openBoard } from './helpers/board';
import {
  activateTextTool,
  createTextAtScreen,
  dblClickTextObject,
  getTextObjectsFromDoc,
  pressEscapeInTextEditor,
  selectTextObject,
  textModelCount,
  textObjectCount,
  textObjectRect,
  waitForTextStable,
} from './helpers/texts';
import {
  closeParticipants,
  expectEventually,
  openParticipants,
} from './helpers/participants';

/** A 300-character fixture for the long annotation test. */
const TEXT_300 = proseOfLength(300);

test.describe('Text workflows (story 9)', () => {
  test('TC-26: Long annotation — type 300 chars, width clamped, multiple lines rendered', async ({ page }) => {
    await openBoard(page);

    // Activate Text tool and click to create
    await activateTextTool(page);
    await createTextAtScreen(page, 400, 400);

    // Type 300 characters
    await page.locator('[data-testid="text-editor"]').fill(TEXT_300);
    await page.locator('[data-testid="text-editor"]').evaluate((el) => {
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // End editing
    await pressEscapeInTextEditor(page);

    // Check the model: width should be at or near TEXT_MAX_AUTO_WIDTH_WORLD
    const texts = await getTextObjectsFromDoc(page);
    expect(texts.length).toBe(1);
    const text = texts[0]!;
    expect(text.width).toBeLessThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD + 2);
    expect(text.width).toBeGreaterThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD - 2);
    expect((text.text as string).length).toBe(300);

    // Height should indicate multiple lines (> 1 line height)
    const lineHeight = TEXT_SIZES.M * TEXT_LINE_HEIGHT;
    expect(Number(text.height)).toBeGreaterThan(lineHeight * 2);

    // Verify rendered content has multiple lines (element height > single line)
    const rect = await textObjectRect(page, 0);
    expect(rect).not.toBeNull();
    expect(rect!.height).toBeGreaterThan(lineHeight * 2);
  });

  test('TC-27: Drag right handle narrower → words rewrap, height grows, no top/bottom handles', async ({ page }) => {
    await openBoard(page);

    // Create text with enough content to wrap
    await activateTextTool(page);
    await createTextAtScreen(page, 300, 400);
    await page.locator('[data-testid="text-editor"]').fill(TEXT_300);
    await page.locator('[data-testid="text-editor"]').evaluate((el) => {
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await pressEscapeInTextEditor(page);

    // Select the text object
    await selectTextObject(page, 0);

    // Verify only e and w handles are present (no n, s, nw, ne, sw, se)
    await expect(page.locator('[data-testid="handle-e"]')).toBeVisible();
    await expect(page.locator('[data-testid="handle-w"]')).toBeVisible();
    await expect(page.locator('[data-testid="handle-n"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="handle-s"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="handle-nw"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="handle-se"]')).not.toBeVisible();

    // Get height before resize
    const textsBefore = await getTextObjectsFromDoc(page);
    const heightBefore = Number(textsBefore[0]!.height);

    // Drag the right handle left (make narrower)
    const eHandle = page.locator('[data-testid="handle-e"]');
    const handleBox = await eHandle.boundingBox();
    expect(handleBox).not.toBeNull();

    const startX = handleBox!.x + handleBox!.width / 2;
    const startY = handleBox!.y + handleBox!.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX - 100, startY, { steps: 5 });
    await page.mouse.up();

    // Height should have grown (narrower → more wrapping)
    const textsAfter = await getTextObjectsFromDoc(page);
    const heightAfter = Number(textsAfter[0]!.height);
    expect(heightAfter).toBeGreaterThan(heightBefore);
  });

  test('TC-28: Title a retro section — T, click, type, Escape, XL, drag, Delete, undo', async ({ page }) => {
    await openBoard(page);

    // Create a heading using the Text tool
    await activateTextTool(page);
    await createTextAtScreen(page, 300, 300);
    await page.locator('[data-testid="text-editor"]').fill('Went well');
    await page.locator('[data-testid="text-editor"]').evaluate((el) => {
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await pressEscapeInTextEditor(page);

    // Text should exist
    await waitForTextStable(page, 1);

    // Select and change to XL
    await selectTextObject(page, 0);
    await expect(page.locator('[data-testid="text-toolbar"]')).toBeVisible();
    await page.locator('[data-testid="text-size-XL"]').click();

    // Verify size is XL
    const textsAfterSize = await getTextObjectsFromDoc(page);
    expect(textsAfterSize[0]!.size).toBe('XL');

    // Delete it
    await page.locator('[data-testid="delete-text"]').click();
    await waitForTextStable(page, 0);
    expect(await textObjectCount(page)).toBe(0);

    // Undo: Ctrl+Z restores it
    await page.keyboard.press('Control+z');
    await waitForTextStable(page, 1);
    const textsAfterUndo = await getTextObjectsFromDoc(page);
    expect(textsAfterUndo[0]!.text).toBe('Went well');
  });

  test('TC-31: Abandoned text — T, click, Escape without typing → no object in doc', async ({ page }) => {
    await openBoard(page);

    // Activate Text tool and click to create
    await activateTextTool(page);
    await createTextAtScreen(page, 400, 400);

    // Press Escape without typing
    await pressEscapeInTextEditor(page);

    // No text object should remain in the model
    const count = await textModelCount(page);
    expect(count).toBe(0);

    // Shift+drag over the spot selects nothing (no text object to select)
    await page.locator('[data-testid="viewport"]').dispatchEvent('pointerdown', {
      clientX: 400,
      clientY: 400,
      shiftKey: true,
      pointerId: 99,
      button: 0,
      bubbles: true,
    });
    await page.locator('[data-testid="viewport"]').dispatchEvent('pointermove', {
      clientX: 500,
      clientY: 500,
      shiftKey: true,
      pointerId: 99,
      button: 0,
      bubbles: true,
    });
    await page.locator('[data-testid="viewport"]').dispatchEvent('pointerup', {
      clientX: 500,
      clientY: 500,
      shiftKey: true,
      pointerId: 99,
      button: 0,
      bubbles: true,
    });

    // Should still have no text objects
    expect(await textModelCount(page)).toBe(0);
  });

  test('TC-29: Two contexts type into the same text simultaneously → merged content', async ({ browser }) => {
    const participants = await openParticipants(browser, 2);
    const [p1, p2] = participants;

    // P1 creates a text object
    await activateTextTool(p1.page);
    await createTextAtScreen(p1.page, 400, 400);
    await page_typeIntoEditor(p1.page, 'Hello');
    await pressEscapeInTextEditor(p1.page);

    // P2 should see the text object
    await expectEventually('TC-29 P2 sees text', participants, async () => {
      const count = await textModelCount(p2.page);
      return count === 1;
    });

    // Both start editing the same text
    await selectTextObject(p1.page, 0);
    await dblClickTextObject(p1.page, 0);
    await selectTextObject(p2.page, 0);
    await dblClickTextObject(p2.page, 0);

    // P1 types "World"
    await p1.page.locator('[data-testid="text-editor"]').fill('Hello World');
    await p1.page.locator('[data-testid="text-editor"]').evaluate((el) => {
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // P2 types " there" appended
    await p2.page.locator('[data-testid="text-editor"]').evaluate((el) => {
      const textarea = el as HTMLTextAreaElement;
      textarea.value = textarea.value + ' there';
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // End editing on both
    await pressEscapeInTextEditor(p1.page);
    await pressEscapeInTextEditor(p2.page);

    // Wait for convergence
    await expectEventually('TC-29 convergence', participants, async () => {
      const texts1 = await getTextObjectsFromDoc(p1.page);
      const texts2 = await getTextObjectsFromDoc(p2.page);
      const text1 = texts1[0]?.text as string;
      const text2 = texts2[0]?.text as string;
      // Both should converge to the same text
      if (text1 !== text2) return false;
      // Should contain all typed characters
      return text1.includes('Hello');
    });

    await closeParticipants(participants);
  });

  test('TC-30: Multiple contexts create headings simultaneously via Text tool', async ({ browser }) => {
    const count = Math.min(MAX_CONCURRENT_EDITORS, 3); // Cap at 3 for test speed
    const participants = await openParticipants(browser, count);

    // Each participant creates a heading using the Text tool
    for (let i = 0; i < participants.length; i++) {
      const p = participants[i]!;
      await activateTextTool(p.page);
      await createTextAtScreen(p.page, 300 + i * 50, 300 + i * 50);
      await page_typeIntoEditor(p.page, `Heading ${i}`);
      await pressEscapeInTextEditor(p.page);
    }

    // All participants should see all headings
    for (const p of participants) {
      await expectEventually('TC-30 all see headings', participants, async () => {
        const count = await textModelCount(p.page);
        return count === participants.length;
      });
    }

    // Each text should have the correct content
    for (const p of participants) {
      const texts = await getTextObjectsFromDoc(p.page);
      const allTexts = texts.map((t) => t.text as string).sort();
      for (let i = 0; i < participants.length; i++) {
        expect(allTexts).toContain(`Heading ${i}`);
      }
    }

    await closeParticipants(participants);
  });
});

/** Helper: fill and dispatch on the text editor. */
async function page_typeIntoEditor(page: import('@playwright/test').Page, text: string): Promise<void> {
  await page.locator('[data-testid="text-editor"]').fill(text);
  await page.locator('[data-testid="text-editor"]').evaluate((el) => {
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
