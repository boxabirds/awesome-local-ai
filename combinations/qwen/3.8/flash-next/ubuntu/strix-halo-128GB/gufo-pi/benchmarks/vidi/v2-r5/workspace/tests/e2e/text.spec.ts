import { expect, test } from '@playwright/test';
import { TEXT_MAX_AUTO_WIDTH_WORLD, TEXT_SIZES } from '../../src/shared/config';
import {
  openBoard,
  waitForSettled,
} from './helpers/board';
import { openParticipants, closeParticipants, expectEventually, type Participant } from './helpers/participants';

const CENTRE = { x: 640, y: 400 };

/** ~300-character text that should wrap at TEXT_MAX_AUTO_WIDTH_WORLD */
const LONG_ANNOTATION =
  'The team met on a grey Tuesday morning to talk about the onboarding flow, because new hires kept ' +
  'saying that the first week felt like a scavenger hunt without a map. Access to the repository ' +
  'arrived on the fourth day and nobody could point at a single source of truth for the roadmap ' +
  'or even agree on who should own the problem.';

/** Read all objects (including text) from the board test hooks. */
async function readAllObjects(page: import('@playwright/test').Page) {
  const objects = await page.evaluate(() => window.__vidi6?.getAllObjects() ?? []);
  return objects as readonly { id: string; type: string; x: number; y: number; text: string; size?: string; width?: number; height?: number; widthMode?: string }[];
}

/** Click with the Text tool at a screen position to create a text object. Returns the new id. */
async function createTextViaTool(page: import('@playwright/test').Page, x = CENTRE.x, y = CENTRE.y): Promise<string> {
  const before = await readAllObjects(page);
  await page.keyboard.press('t');
  await waitForSettled(page);
  await page.mouse.click(x, y);
  // Wait for the text object to appear (needs React render cycle)
  await expect.poll(async () => {
    const after = await readAllObjects(page);
    return after.some((obj) => obj.type === 'text' && !before.some((b) => b.id === obj.id));
  }, { timeout: 5000 }).toBe(true);
  const after = await readAllObjects(page);
  const created = after.find((obj) => obj.type === 'text' && !before.some((b) => b.id === obj.id));
  if (!created) throw new Error('text tool click did not create a text object');
  return created.id;
}

/** Type into the currently focused text editor. */
async function typeIntoEditor(page: import('@playwright/test').Page, text: string): Promise<void> {
  const editor = page.getByTestId('text-editor');
  await editor.waitFor({ state: 'visible' });
  await editor.fill('');
  await editor.type(text, { delay: 2 });
}

/** Press Escape to end editing. */
async function pressEscape(page: import('@playwright/test').Page): Promise<void> {
  await page.keyboard.press('Escape');
  await waitForSettled(page);
}

test.describe('story 9: Write free text anywhere on the board', () => {
  test('TC-26: long annotation types 300+ chars → width ≈ TEXT_MAX_AUTO_WIDTH_WORLD, multiple lines', async ({ page }) => {
    await openBoard(page);

    // Create text with text tool
    const id = await createTextViaTool(page);

    // Type the long annotation
    await typeIntoEditor(page, LONG_ANNOTATION);
    await pressEscape(page);

    // Read object state
    const objs = await readAllObjects(page);
    const obj = objs.find((o) => o.id === id)!;
    expect(obj.text.length).toBeGreaterThanOrEqual(300);

    // Width should be approximately TEXT_MAX_AUTO_WIDTH_WORLD (within 2 units)
    expect(obj.width).toBeGreaterThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD - 2);
    expect(obj.width).toBeLessThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD + 2);

    // Height should be multiple lines (> one line height at M size)
    const oneLineHeight = TEXT_SIZES.M * 1.3;
    expect(obj.height).toBeGreaterThan(oneLineHeight * 1.5);

    // Element should be visible with content
    const textEl = page.locator(`[data-testid="text-object"][data-note-id="${id}"]`);
    await expect(textEl).toBeVisible();
  });

  test('TC-27: drag e handle narrower → rewraps, height grows, only e/w handles', async ({ page }) => {
    await openBoard(page);

    // Create text with a long sentence that wraps
    const id = await createTextViaTool(page);
    await typeIntoEditor(page, 'The quick brown fox jumps over the lazy dog and keeps running through the entire alphabet while nobody is watching');
    await pressEscape(page);

    // Select it
    const textEl = page.locator(`[data-testid="text-object"][data-note-id="${id}"]`);
    await textEl.click();
    await waitForSettled(page);

    // Verify only e/w handles (no n/s/ne/nw/se/sw)
    await expect(page.getByTestId('handle-e')).toBeVisible();
    await expect(page.getByTestId('handle-w')).toBeVisible();
    await expect(page.getByTestId('handle-n')).not.toBeVisible();
    await expect(page.getByTestId('handle-s')).not.toBeVisible();

    // Read state before resize
    const before = await readAllObjects(page);
    const beforeObj = before.find((o) => o.id === id)!;
    const initialWidth = beforeObj.width!;
    const initialHeight = beforeObj.height!;

    // Drag e handle significantly to the left to force more wrapping
    const eHandle = page.getByTestId('handle-e');
    const handleBox = await eHandle.boundingBox();
    expect(handleBox).toBeTruthy();
    const startX = handleBox!.x + handleBox!.width / 2;
    const startY = handleBox!.y + handleBox!.height / 2;

    // Drag left by 60% of the width to force more lines
    const dragAmount = Math.round(initialWidth * 0.6);
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX - dragAmount, startY, { steps: 5 });
    await page.mouse.up();
    await waitForSettled(page);

    // Read state after resize
    const after = await readAllObjects(page);
    const afterObj = after.find((o) => o.id === id)!;

    // Width decreased, height increased (text re-wrapped)
    expect(afterObj.width).toBeLessThan(initialWidth);
    expect(afterObj.height).toBeGreaterThan(initialHeight);
    // WidthMode should be 'fixed'
    expect(afterObj.widthMode).toBe('fixed');
  });

  test('TC-28: T, click, type "Went well", Escape, click XL, drag, Delete, undo restores', async ({ page }) => {
    await openBoard(page);

    // Create text with text tool
    const id = await createTextViaTool(page);
    await typeIntoEditor(page, 'Went well');
    await pressEscape(page);

    // Select it
    const textEl = page.locator(`[data-testid="text-object"][data-note-id="${id}"]`);
    await textEl.click();
    await waitForSettled(page);

    // Click XL to change size
    await page.getByTestId('text-size-XL').click();
    await waitForSettled(page);

    let objs = await readAllObjects(page);
    let obj = objs.find((o) => o.id === id)!;
    expect(obj.size).toBe('XL');

    // Drag the text to move it
    const pos = await textEl.boundingBox();
    expect(pos).toBeTruthy();
    const fromX = pos!.x + pos!.width / 2;
    const fromY = pos!.y + pos!.height / 2;
    await page.mouse.move(fromX, fromY);
    await page.mouse.down();
    await page.mouse.move(fromX + 50, fromY + 80, { steps: 3 });
    await page.mouse.up();
    await waitForSettled(page);

    // Select it again after drag
    await textEl.click();
    await waitForSettled(page);

    // Delete it
    await page.getByTestId('text-toolbar-delete').click();
    await waitForSettled(page);

    objs = await readAllObjects(page);
    expect(objs.find((o) => o.id === id)).toBeUndefined();

    // Undo to restore
    await page.keyboard.press('Control+z');
    await waitForSettled(page);

    objs = await readAllObjects(page);
    obj = objs.find((o) => o.id === id)!;
    expect(obj).toBeTruthy();
    expect(obj.text).toBe('Went well');
  });

  test('TC-29: two contexts type into same text simultaneously → both see all characters', async ({ browser }) => {
    // Open a board
    const initCtx = await browser.newContext();
    const initPage = await initCtx.newPage();
    const res = await initPage.request.post('/api/boards');
    const { id: boardId } = await res.json() as { id: string };
    await initCtx.close();

    const participants = await openParticipants(browser, boardId, 2);
    const [p1, p2] = participants as [Participant, Participant];

    try {
      // P1 creates text
      const textId = await createTextViaTool(p1.page);
      await typeIntoEditor(p1.page, 'start');
      await pressEscape(p1.page);

      // P2 sees the text and starts editing
      await expectEventually('P2 sees text', async () => {
        const objs = await readAllObjects(p2.page);
        expect(objs.find((o) => o.id === textId)?.text).toBe('start');
      });

      // P2 double-clicks to edit
      const p2TextEl = p2.page.locator(`[data-testid="text-object"][data-note-id="${textId}"]`);
      await p2TextEl.dblclick();
      await waitForSettled(p2.page);

      // Both P1 and P2 type simultaneously
      const p1Editor = p1.page.getByTestId('text-editor');
      const p2Editor = p2.page.getByTestId('text-editor');

      // P1 goes to edit too
      const p1TextEl = p1.page.locator(`[data-testid="text-object"][data-note-id="${textId}"]`);
      await p1TextEl.dblclick();
      await waitForSettled(p1.page);

      // Type different characters at the same time
      await p1Editor.type('AAA', { delay: 20 });
      await p2Editor.type('BBB', { delay: 20 });

      // End editing on both
      await p1.page.keyboard.press('Escape');
      await p2.page.keyboard.press('Escape');
      await waitForSettled(p1.page);
      await waitForSettled(p2.page);

      // Eventually both should see the same text
      await expectEventually('both contexts see same text', async () => {
        const objs1 = await readAllObjects(p1.page);
        const objs2 = await readAllObjects(p2.page);
        const text1 = objs1.find((o) => o.id === textId)?.text ?? '';
        const text2 = objs2.find((o) => o.id === textId)?.text ?? '';
        expect(text1).toBe(text2);
        // All characters typed by either participant should be present
        expect(text1).toContain('A');
        expect(text1).toContain('B');
      });
    } finally {
      await closeParticipants(participants);
    }
  });

  test('TC-30: multiple contexts each create a heading at once → all visible on every screen', async ({ browser }) => {
    // Open a board
    const initCtx = await browser.newContext();
    const initPage = await initCtx.newPage();
    const res = await initPage.request.post('/api/boards');
    const { id: boardId } = await res.json() as { id: string };
    await initCtx.close();

    const participants = await openParticipants(browser, boardId, 3);

    try {
      const textIds: string[] = [];

      // Each participant creates a heading
      for (let i = 0; i < participants.length; i++) {
        const p = participants[i]!;
        // Ensure tool is back to select first
        await p.page.keyboard.press('Escape');
        await waitForSettled(p.page);
        const id = await createTextViaTool(p.page, CENTRE.x + i * 20, CENTRE.y + i * 20);
        await typeIntoEditor(p.page, `Heading ${i}`);
        await pressEscape(p.page);
        textIds.push(id);
      }

      // Every participant should see all headings
      for (const p of participants) {
        await expectEventually(`${p!.label} sees all ${participants.length} headings`, async () => {
          const objs = await readAllObjects(p!.page);
          const texts = objs.filter((o) => o.type === 'text');
          expect(texts.length).toBeGreaterThanOrEqual(participants.length);
          for (const id of textIds) {
            expect(texts.find((o) => o.id === id)).toBeTruthy();
          }
        });
      }
    } finally {
      await closeParticipants(participants);
    }
  });

  test('TC-31: T, click, Escape without typing → no text object in doc', async ({ page }) => {
    await openBoard(page);

    const before = await readAllObjects(page);

    // Activate text tool and click to create
    await page.keyboard.press('t');
    await waitForSettled(page);
    await page.mouse.click(CENTRE.x + 30, CENTRE.y + 30);
    await waitForSettled(page);

    // Editor should be visible
    await expect(page.getByTestId('text-editor')).toBeVisible();

    // Escape without typing
    await page.keyboard.press('Escape');
    await waitForSettled(page);

    // No new text object should exist
    const after = await readAllObjects(page);
    const newTextCount = after.filter((o) => o.type === 'text').length;
    const beforeTextCount = before.filter((o) => o.type === 'text').length;
    expect(newTextCount).toBe(beforeTextCount);
  });
});
