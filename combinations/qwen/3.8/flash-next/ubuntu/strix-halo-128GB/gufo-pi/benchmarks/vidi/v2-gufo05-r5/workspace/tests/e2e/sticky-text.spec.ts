/**
 * sticky.text e2e tests: the text limit, the character counter and the auto-fitting font,
 * measured with the browser's real text layout (jsdom lays nothing out).
 *
 * TC-33 (font fit) plus the 1,000 character limit and the counter threshold in the UI.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  editorFontPx,
  editorOf,
  getNotes,
  noteFontPx,
  noteLocator,
  noteTextMetrics,
  stopEditing,
  typeIntoEditor,
} from './helpers/notes';
import { navigateToNewBoard } from './helpers/navigate';
import {
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../src/shared/config';
import { PROSE_1000, PROSE_1200, RETRO_ITEM, SHORT_NOTE } from '../fixtures/texts';

const SPOT = { x: 400, y: 300 };

/** Opens a fresh note in editing mode. */
async function startNote(page: Page): Promise<void> {
  await navigateToNewBoard(page);
  await page.mouse.dblclick(SPOT.x, SPOT.y);
  await expect(editorOf(page)).toBeVisible();
}

/** Opens the existing note again for editing. */
async function editNote(page: Page, index = 0): Promise<void> {
  const centre = await noteLocator(page, index).boundingBox();
  if (!centre) throw new Error('the note has no box');
  await page.mouse.dblclick(
    centre.x + centre.width / 2,
    centre.y + centre.height / 2,
  );
  await expect(editorOf(page)).toBeVisible();
}

test.describe('note text', () => {
  test('TC-33 the font is largest for a short note and shrinks, then clips, for a long one', async ({
    page,
  }) => {
    await startNote(page);

    // one word: the largest allowed size
    await typeIntoEditor(page, 'Idea');
    expect(await editorFontPx(page)).toBeCloseTo(STICKY_FONT_MAX_PX, 1);

    // a few lines that still fit: smaller than the maximum, still fully visible
    await typeIntoEditor(page, `. ${RETRO_ITEM}`);
    const middle = await editorFontPx(page);
    expect(middle).toBeLessThan(STICKY_FONT_MAX_PX);
    expect(middle).toBeGreaterThan(STICKY_FONT_MIN_PX);
    await stopEditing(page);
    expect(await noteFontPx(page, 0)).toBeCloseTo(middle, 1);
    let box = await noteTextMetrics(page);
    expect(box.scrollHeight).toBeLessThanOrEqual(box.clientHeight + 1);
    await expect(noteLocator(page, 0).locator('.sticky-note__fade')).toHaveCount(0);

    // the longest text the app stores: at or above the minimum size, clipped with a fade
    await editNote(page);
    await typeIntoEditor(page, PROSE_1000);
    const fitted = await editorFontPx(page);
    expect(fitted).toBeGreaterThanOrEqual(STICKY_FONT_MIN_PX);
    expect(fitted).toBeLessThan(middle);
    await stopEditing(page);

    box = await noteTextMetrics(page);
    expect(box.scrollHeight).toBeGreaterThan(box.clientHeight + 1); // clipped, not spilling
    await expect(noteLocator(page, 0).locator('.sticky-note__fade')).toHaveCount(1);
    // nothing is painted outside the note: the text stays inside its box
    const noteBox = await noteLocator(page, 0).boundingBox();
    const textBox = await noteLocator(page, 0)
      .locator('[data-testid="sticky-note-text"]')
      .boundingBox();
    if (!noteBox || !textBox) throw new Error('note or text has no box');
    expect(textBox.y).toBeGreaterThanOrEqual(noteBox.y - 1);
    expect(textBox.y + textBox.height).toBeLessThanOrEqual(noteBox.y + noteBox.height + 1);

    // back to a short note and the font grows to the maximum again
    await editNote(page);
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await typeIntoEditor(page, 'Idea');
    expect(await editorFontPx(page)).toBeCloseTo(STICKY_FONT_MAX_PX, 1);
    await stopEditing(page);
    expect(await noteFontPx(page, 0)).toBeCloseTo(STICKY_FONT_MAX_PX, 1);
  });

  test('a paste longer than the limit stores exactly the first 1,000 characters', async ({
    page,
  }) => {
    await startNote(page);
    await typeIntoEditor(page, PROSE_1200);

    const stored = (await getNotes(page))[0]?.text ?? '';
    expect(stored).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(stored).toBe(PROSE_1200.slice(0, STICKY_TEXT_MAX_CHARS));
    // the editor shows the text it stored: nothing keeps growing behind the scenes
    await expect(editorOf(page)).toHaveValue(stored);
  });

  test('typing past the limit adds nothing, and the counter warns near the end', async ({
    page,
  }) => {
    await startNote(page);

    await typeIntoEditor(page, 'x'.repeat(949));
    await expect(page.getByTestId('note-counter')).toHaveCount(0);

    await typeIntoEditor(page, 'x'); // 950 characters: 50 left, the counter appears
    await expect(page.getByTestId('note-counter')).toHaveText('950/1000');

    await typeIntoEditor(page, 'x'.repeat(50)); // exactly 1,000
    expect((await getNotes(page))[0]?.text).toHaveLength(1000);

    await typeIntoEditor(page, 'abc'); // over the limit: nothing is added
    const stored = (await getNotes(page))[0]?.text ?? '';
    expect(stored).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(stored.endsWith('abc')).toBe(false);
    await expect(page.getByTestId('note-counter')).toHaveText('1000/1000');
  });

  test('the note keeps exactly the text that was typed, including new lines', async ({ page }) => {
    await startNote(page);
    await typeIntoEditor(page, RETRO_ITEM);
    await stopEditing(page);

    expect((await getNotes(page))[0]?.text).toBe(RETRO_ITEM);
    await expect(noteLocator(page, 0)).toHaveText(RETRO_ITEM);
  });

  test('Escape keeps the note selected; a click outside stores the text and deselects', async ({
    page,
  }) => {
    await startNote(page);
    await typeIntoEditor(page, SHORT_NOTE);
    await stopEditing(page);
    expect((await getNotes(page))[0]?.text).toBe(SHORT_NOTE);
    await expect(noteLocator(page, 0)).toHaveAttribute('data-selected', 'true');

    // edit the same note again and leave with a click on empty board space
    await editNote(page);
    await typeIntoEditor(page, '.');
    await page.mouse.click(1100, 700);

    await expect(editorOf(page)).toHaveCount(0);
    expect((await getNotes(page))[0]?.text).toBe(`${SHORT_NOTE}.`);
    expect(await (await getNotes(page)).length).toBe(1);
    await expect(noteLocator(page, 0)).not.toHaveAttribute('data-selected');
  });
});
