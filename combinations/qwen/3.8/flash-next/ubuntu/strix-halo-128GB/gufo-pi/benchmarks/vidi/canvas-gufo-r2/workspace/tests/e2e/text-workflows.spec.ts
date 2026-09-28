/**
 * E2E text workflows (TC-26 to TC-31) — story 9.
 * Proves the Text tool and text objects with real fonts and the real sync server.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  boardLocator,
  type Dot,
} from './helpers/board';
import {
  openParticipants,
  closeParticipants,
  type Participant,
} from './helpers/participants';
import { newBoardId } from '../../src/shared/board-id';
import { TEXT_MAX_AUTO_WIDTH_WORLD, MAX_CONCURRENT_EDITORS } from '../../src/shared/config';

const CENTRE: Dot = { x: 640, y: 400 };

/** A 300-character string that forces wrapping. */
const LONG_ANNOTATION =
  'Collaborative whiteboards help teams organise their thinking during brainstorming sessions. ' +
  'Sticky notes are a familiar metaphor that anyone can pick up without any formal training. ' +
  'Ideas flow more freely when the tools stay out of the way and respond instantly to gestures. ' +
  'Working together in real time builds trust and reduces misunderstandings.';

/** Locate the first text element on the board. */
const firstText = (page: Page) => page.locator('[data-text-id]').first();

async function waitForBoard(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create a board' }).click();
  await expect(boardLocator(page)).toBeVisible();
  await expect
    .poll(
      async () => {
        const cam = await boardLocator(page).evaluate((el) => ({
          x: Number(el.dataset.cameraX),
          y: Number(el.dataset.cameraY),
        }));
        return cam.x !== 0 || cam.y !== 0;
      },
      { timeout: 4000 },
    )
    .toBe(true);
}

/** Activate Text tool, click board, wait for editor and ensure focus. */
async function createTextAt(page: Page, point: Dot): Promise<void> {
  await page.keyboard.press('t');
  await page.waitForTimeout(50);
  await page.mouse.click(point.x, point.y);
  await page.waitForSelector('.text-editor-textarea', { timeout: 3000 });
  // Focus the textarea explicitly (the component's useEffect may race with click)
  await page.locator('.text-editor-textarea').focus();
}

/** Create text, type content, then Escape to end editing. */
async function createTextWithContent(page: Page, point: Dot, content: string): Promise<void> {
  await createTextAt(page, point);
  await page.keyboard.type(content, { delay: 5 });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
}

/** Get stored width/height from a text object element. */
async function getTextDimensions(page: Page, index = 0): Promise<{ width: number; height: number }> {
  const el = page.locator('[data-text-id]').nth(index);
  return el.evaluate((elem) => ({
    width: parseFloat(elem.style.width),
    height: parseFloat(elem.style.minHeight || elem.style.height),
  }));
}

test.describe('story 9: text workflows', () => {
  test.beforeEach(async ({ page }) => {
    await waitForBoard(page);
  });

  // TC-26: "Long annotation": T, click, type 300 chars → width ~600, multiple lines.
  test('TC-26: long annotation wraps at TEXT_MAX_AUTO_WIDTH_WORLD', async ({ page }) => {
    expect(LONG_ANNOTATION.length).toBeGreaterThanOrEqual(300);

    await createTextWithContent(page, CENTRE, LONG_ANNOTATION);

    const textEl = firstText(page);
    await expect(textEl).toBeVisible();

    const dims = await getTextDimensions(page);
    // Width should be approximately TEXT_MAX_AUTO_WIDTH_WORLD (600) ± some tolerance
    // due to different font rendering across browsers.
    expect(dims.width).toBeGreaterThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD - 50);
    expect(dims.width).toBeLessThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD + 50);

    // Height should indicate multiple lines (at least 3 lines at 20px * 1.3 = ~78)
    expect(dims.height).toBeGreaterThan(78);
  });

  // TC-27: Drag the right (e) handle narrower → words rewrap, height grows, no n/s handles.
  test('TC-27: e-handle drag narrows text and grows height', async ({ page }) => {
    const content = 'Collaborative whiteboards help teams organise their thinking during brainstorming sessions and sticky notes are a familiar metaphor that anyone can pick up without any formal training whatsoever';
    await createTextWithContent(page, CENTRE, content);
    await page.waitForTimeout(100);

    const textEl = firstText(page);
    await expect(textEl).toBeVisible();

    // Click to select
    const box = await textEl.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;
    await page.mouse.click(box.x + 5, box.y + 5);
    await page.waitForTimeout(100);

    // Verify only e and w handles are visible (no n/s/nw/ne/sw/se)
    await expect(page.locator('[data-resize-handle="e"]')).toBeVisible();
    await expect(page.locator('[data-resize-handle="w"]')).toBeVisible();
    await expect(page.locator('[data-resize-handle="n"]')).toHaveCount(0);
    await expect(page.locator('[data-resize-handle="s"]')).toHaveCount(0);
    await expect(page.locator('[data-resize-handle="nw"]')).toHaveCount(0);
    await expect(page.locator('[data-resize-handle="ne"]')).toHaveCount(0);
    await expect(page.locator('[data-resize-handle="sw"]')).toHaveCount(0);
    await expect(page.locator('[data-resize-handle="se"]')).toHaveCount(0);

    const dimsBefore = await getTextDimensions(page);

    // Drag e handle to the left (narrower)
    const eHandle = page.locator('[data-resize-handle="e"]');
    const handleBox = await eHandle.boundingBox();
    expect(handleBox).not.toBeNull();
    if (!handleBox) return;

    const hcx = handleBox.x + handleBox.width / 2;
    const hcy = handleBox.y + handleBox.height / 2;
    await page.mouse.move(hcx, hcy);
    await page.mouse.down();
    await page.mouse.move(hcx - 250, hcy, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(500);

    // Width should be narrower, height should grow (more wrapping lines)
    await expect.poll(async () => {
      const dims = await getTextDimensions(page);
      return dims.height;
    }, { timeout: 3000 }).toBeGreaterThan(dimsBefore.height);

    const dimsAfter = await getTextDimensions(page);
    expect(dimsAfter.width).toBeLessThan(dimsBefore.width);
  });

  // TC-28: "Title a retro section": T, click, type, Escape, XL, drag, Delete, Ctrl+Z restores.
  test('TC-28: create text, resize XL, move, delete, undo restores', async ({ page }) => {
    // Create a sticky as a "cluster" first
    await page.mouse.dblclick(CENTRE.x + 100, CENTRE.y + 100);
    await page.keyboard.type('Cluster item');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);

    // Create heading text above the cluster
    await createTextWithContent(page, { x: CENTRE.x, y: CENTRE.y - 50 }, 'Went well');

    const textEl = firstText(page);
    await expect(textEl).toBeVisible();

    // Click to select the text
    const tbox = await textEl.boundingBox();
    expect(tbox).not.toBeNull();
    if (!tbox) return;
    await page.mouse.click(tbox.x + 5, tbox.y + 5);
    await page.waitForTimeout(100);

    // Change to XL size
    await page.getByRole('button', { name: 'XL text size' }).click();
    await page.waitForTimeout(100);

    // Drag the text over the cluster
    const tboxXL = await textEl.boundingBox();
    expect(tboxXL).not.toBeNull();
    if (!tboxXL) return;
    const dragStart: Dot = { x: tboxXL.x + tboxXL.width / 2, y: tboxXL.y + 10 };
    const dragEnd: Dot = { x: CENTRE.x + 100, y: CENTRE.y + 80 };
    await page.mouse.move(dragStart.x, dragStart.y);
    await page.mouse.down();
    await page.mouse.move(dragEnd.x, dragEnd.y, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(100);

    // Select and delete the text
    await textEl.click({ position: { x: 5, y: 5 } });
    await page.waitForTimeout(100);
    await page.keyboard.press('Delete');
    await page.waitForTimeout(100);

    // Text should be gone
    await expect(page.locator('[data-text-id]')).toHaveCount(0);

    // Ctrl+Z restores the text
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);
    await expect(page.locator('[data-text-id]')).toHaveCount(1);
  });

  // TC-31: "Abandoned text": T, click, Escape without typing → no text object.
  test('TC-31: abandoned text (Escape without typing) removes the object', async ({ page }) => {
    await createTextAt(page, CENTRE);

    // Escape without typing
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);

    // No text object should exist
    await expect(page.locator('[data-text-id]')).toHaveCount(0);

    // Shift+drag over the spot selects nothing (no ghost object)
    await page.keyboard.down('Shift');
    await page.mouse.move(CENTRE.x - 50, CENTRE.y - 50);
    await page.mouse.down();
    await page.mouse.move(CENTRE.x + 50, CENTRE.y + 50, { steps: 4 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await page.waitForTimeout(100);

    // No selection overlay should appear (nothing selected)
    await expect(page.locator('[data-testid="selection-overlay"]')).toHaveCount(0);
  });
});

test.describe('story 9: concurrent text', () => {
  let participants: Participant[];

  test.afterEach(async () => {
    if (participants) await closeParticipants(participants);
  });

  // TC-29: two contexts type into the same text simultaneously → all characters present.
  test('TC-29: concurrent typing merges without data loss', async ({ browser }) => {
    const boardId = newBoardId();
    participants = await openParticipants(browser, 2, boardId);

    const [alice, bob] = participants;

    // Alice creates a text object with some initial content
    await alice.page.keyboard.press('t');
    await alice.page.waitForTimeout(50);
    await alice.page.mouse.click(640, 400);
    await alice.page.waitForSelector('.text-editor-textarea', { timeout: 3000 });
    await alice.page.keyboard.type('Hello', { delay: 10 });
    await alice.page.keyboard.press('Escape');
    await alice.page.waitForTimeout(200);

    // Both users see the text object
    await expect(alice.page.locator('[data-text-id]')).toHaveCount(1);
    await expect(bob.page.locator('[data-text-id]')).toHaveCount(1, { timeout: 5000 });

    // Both users start editing the same text simultaneously
    const textLocator = (page: Page) => page.locator('[data-text-id]').first();

    // Alice starts editing
    await textLocator(alice.page).dblclick();
    await alice.page.waitForSelector('.text-editor-textarea', { timeout: 3000 });

    // Bob starts editing
    await textLocator(bob.page).dblclick();
    await bob.page.waitForSelector('.text-editor-textarea', { timeout: 3000 });

    // Both type different content
    await alice.page.keyboard.type(' from Alice', { delay: 20 });
    await bob.page.keyboard.type(' from Bob', { delay: 20 });

    // Wait for sync to converge
    await alice.page.waitForTimeout(500);
    await bob.page.waitForTimeout(500);

    // End editing on both
    await alice.page.keyboard.press('Escape');
    await bob.page.keyboard.press('Escape');
    await alice.page.waitForTimeout(300);

    // Both should see text with all characters (order may vary due to merge)
    const aliceContent = await textLocator(alice.page).textContent();
    const bobContent = await textLocator(bob.page).textContent();

    expect(aliceContent).toBe(bobContent);
    // All key characters should be present (order may vary, but 'Hello', 'Alice', 'Bob' should all appear)
    expect(aliceContent).toContain('Hello');
    expect(aliceContent).toContain('Alice');
    expect(aliceContent).toContain('Bob');
  });

  // TC-30: MAX_CONCURRENT_EDITORS each create a heading → all visible everywhere.
  test('TC-30: concurrent heading creation — all visible on every screen', async ({ browser }) => {
    const boardId = newBoardId();
    participants = await openParticipants(browser, MAX_CONCURRENT_EDITORS, boardId);

    // Each participant creates a heading at a unique position
    for (let i = 0; i < participants.length; i++) {
      const p = participants[i];
      const x = 300 + i * 150;
      const y = 300 + i * 50;
      await p.page.keyboard.press('t');
      await p.page.waitForTimeout(50);
      await p.page.mouse.click(x, y);
      await p.page.waitForSelector('.text-editor-textarea', { timeout: 3000 });
      await p.page.keyboard.type(`Heading ${i}`, { delay: 10 });
      await p.page.keyboard.press('Escape');
      await p.page.waitForTimeout(100);
    }

    // Wait for all to sync
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Every participant should see all headings
    for (const p of participants) {
      await expect(p.page.locator('[data-text-id]')).toHaveCount(MAX_CONCURRENT_EDITORS, { timeout: 5000 });
    }
  });
});
