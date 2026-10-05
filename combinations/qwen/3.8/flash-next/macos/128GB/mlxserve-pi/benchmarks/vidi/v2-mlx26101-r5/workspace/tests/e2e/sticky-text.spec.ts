import { expect, test, type Page } from '@playwright/test';

import {
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_SIZE_WORLD,
  STICKY_TEXT_MAX_CHARS,
} from '../../src/shared/config';
import { LONG_PROSE_1000, LONG_PROSE_1200, RETRO_ITEM, SHORT_PHRASE } from '../fixtures/texts';
import {
  doubleClickCreate,
  editorValue,
  hasTestId,
  note,
  noteFontPx,
  noteScreenBox,
  noteText,
  openBoard,
  readCamera,
  setCamera,
  settled,
} from './helpers/board';

/** Boxes of the note's text layer (or editor while editing) and of the note. */
async function boxes(page: Page, id: string) {
  const editing = (await note(page, id).locator('.sticky-editor').count()) > 0;
  const inner = await note(page, id)
    .locator(editing ? '.sticky-editor' : '.sticky-text')
    .boundingBox();
  const outer = await noteScreenBox(page, id);
  return { inner, outer };
}

/** Sets the zoom through the test hook and waits for the label to agree. */
async function zoomTo(page: Page, zoom: number): Promise<void> {
  await setCamera(page, { zoom });
  await expect(page.getByTestId('zoom-label')).toHaveText(`${Math.round(zoom * 100)}%`);
}

test.describe('long text in a sticky note', () => {
  // TC-33: a short note is drawn at the biggest font size
  test('one word is drawn at the maximum font size', async ({ page }) => {
    await openBoard(page);
    const id = await doubleClickCreate(page, 400, 300);
    await page.keyboard.type('Awesome');
    await settled(page);

    expect(await editorValue(page)).toBe('Awesome');
    expect(await noteFontPx(page, id)).toBe(STICKY_FONT_MAX_PX);

    await page.keyboard.press('Escape');
    expect(await noteText(page, id)).toBe('Awesome');
    expect(await noteFontPx(page, id)).toBe(STICKY_FONT_MAX_PX);
    // Nothing overflows, so there is no fade.
    expect(await hasTestId(page, 'sticky-overflow-fade')).toBe(false);
    expect(await note(page, id).getAttribute('data-overflow')).toBe('false');
  });

  // TC-33: a thousand characters shrink to the smallest font and fade out
  test('a 1,000 character note shrinks, fades and stays inside its box', async ({ page }) => {
    await openBoard(page);
    const id = await doubleClickCreate(page, 640, 400);

    // A paste of exactly the fixture: one input event, like a real paste.
    await page.keyboard.insertText(LONG_PROSE_1000);
    await settled(page);

    expect((await editorValue(page)).length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(await editorValue(page)).toBe(LONG_PROSE_1000);
    const editingSize = await noteFontPx(page, id);
    expect(editingSize).toBeGreaterThanOrEqual(STICKY_FONT_MIN_PX);
    expect(editingSize).toBeLessThan(STICKY_FONT_MAX_PX);

    // The counter shows the limit has been reached.
    await expect(page.getByTestId('sticky-counter')).toHaveText(
      `${STICKY_TEXT_MAX_CHARS} / ${STICKY_TEXT_MAX_CHARS}`,
    );

    // While editing, nothing is drawn outside the note box.
    const whileEditing = await boxes(page, id);
    if (!whileEditing.inner) throw new Error('the editor has no box');
    expect(whileEditing.inner.x).toBeGreaterThanOrEqual(whileEditing.outer.x - 0.5);
    expect(whileEditing.inner.y).toBeGreaterThanOrEqual(whileEditing.outer.y - 0.5);
    expect(whileEditing.inner.x + whileEditing.inner.width).toBeLessThanOrEqual(
      whileEditing.outer.x + whileEditing.outer.width + 0.5,
    );
    expect(whileEditing.inner.y + whileEditing.inner.height).toBeLessThanOrEqual(
      whileEditing.outer.y + whileEditing.outer.height + 0.5,
    );

    await page.keyboard.press('Escape');
    await settled(page);

    // The read-only view holds the whole text, at the fitted size, and the fade
    // tells the author there is more than fits.
    expect(await noteText(page, id)).toBe(LONG_PROSE_1000);
    expect(await noteFontPx(page, id)).toBeGreaterThanOrEqual(STICKY_FONT_MIN_PX);
    expect(await note(page, id).getAttribute('data-overflow')).toBe('true');
    await expect(page.getByTestId('sticky-overflow-fade')).toBeVisible();

    const after = await boxes(page, id);
    if (!after.inner) throw new Error('the text layer has no box');
    expect(after.inner.width).toBeLessThanOrEqual(after.outer.width + 0.5);
    expect(after.inner.height).toBeLessThanOrEqual(after.outer.height + 0.5);
    expect(after.outer.width).toBeCloseTo(STICKY_SIZE_WORLD, 0);
  });

  // A paste that is too long keeps the first 1,000 characters
  test('a paste of 1,200 characters is cut at the limit', async ({ page }) => {
    await openBoard(page);
    const id = await doubleClickCreate(page, 640, 400);

    await page.keyboard.insertText(LONG_PROSE_1200);
    await settled(page);
    expect((await editorValue(page)).length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(await editorValue(page)).toBe(LONG_PROSE_1000);
    await page.keyboard.press('Escape');
    expect(await noteText(page, id)).toBe(LONG_PROSE_1000);
    expect(await noteFontPx(page, id)).toBeGreaterThanOrEqual(STICKY_FONT_MIN_PX);
  });

  // Three lines fit at a readable size between the two extremes
  test('a three-line note is drawn at a font size between the limits', async ({ page }) => {
    await openBoard(page);
    const id = await doubleClickCreate(page, 400, 300);
    await page.keyboard.insertText(RETRO_ITEM);
    await settled(page);
    await page.keyboard.press('Escape');

    expect(await noteText(page, id)).toBe(RETRO_ITEM);
    const size = await noteFontPx(page, id);
    expect(size).toBeGreaterThanOrEqual(STICKY_FONT_MIN_PX);
    expect(size).toBeLessThanOrEqual(STICKY_FONT_MAX_PX);
    expect(await hasTestId(page, 'sticky-overflow-fade')).toBe(false);
  });

  // The text layer never spills out of the note, at any zoom
  test('the text stays inside the note at 50 % and 200 % zoom', async ({ page }) => {
    await openBoard(page);
    const id = await doubleClickCreate(page, 640, 400);
    await page.keyboard.insertText(LONG_PROSE_1000);
    await settled(page);
    await page.keyboard.press('Escape');

    for (const zoom of [0.5, 2]) {
      await zoomTo(page, zoom);
      await settled(page);
      const { inner, outer } = await boxes(page, id);
      if (!inner) throw new Error(`no text box at zoom ${zoom}`);
      expect(inner.x).toBeGreaterThanOrEqual(outer.x - 0.5);
      expect(inner.y).toBeGreaterThanOrEqual(outer.y - 0.5);
      expect(inner.x + inner.width).toBeLessThanOrEqual(outer.x + outer.width + 0.5);
      expect(inner.y + inner.height).toBeLessThanOrEqual(outer.y + outer.height + 0.5);
      // The note is 200 world units wide, so it is 200 * zoom on screen.
      expect(outer.width).toBeCloseTo(STICKY_SIZE_WORLD * zoom, 0);
      expect((await readCamera(page)).zoom).toBeCloseTo(zoom, 6);
    }
  });

  // Typing a short phrase keeps the largest font, as the PRD asks
  test('typing the golden-path phrase keeps the maximum font size', async ({ page }) => {
    await openBoard(page);
    const id = await doubleClickCreate(page, 400, 300);
    await page.keyboard.type(SHORT_PHRASE);
    await settled(page);
    await page.keyboard.press('Escape');
    expect(await noteText(page, id)).toBe(SHORT_PHRASE);
    expect(await noteFontPx(page, id)).toBe(STICKY_FONT_MAX_PX);
  });
});
