import { expect, type Locator, type Page } from '@playwright/test';

import type { Point } from '../../../src/client/canvas/camera.js';
import type { ObjectSnapshot } from '../../../src/shared/board-model.js';
import type { TextSnapshot } from '../../../src/shared/objects/text.js';
import { TEXT_LINE_HEIGHT, TEXT_SIZES, type TextSize } from '../../../src/shared/config.js';
import { waitForRender } from './board.js';

/**
 * Text object helpers (story 9).
 *
 * The same bargain the sticky note helpers make: the document is read through the
 * test-only hook (`window.__vidi6Board`, in the test build) and the pixels are read
 * through the DOM, and a test asserts the two against each other. For a text object
 * that bargain is the whole story of the feature - the box in the document is a
 * *measurement* of the words, so a test that only looked at the document would not
 * notice a box that does not fit its text, and a test that only looked at the screen
 * would not notice a box that disagrees with its neighbour's screen.
 */

export const textElements = (page: Page): Locator => page.getByTestId('text-object');

export const textAt = (page: Page, index: number): Locator => textElements(page).nth(index);

export const textEditor = (page: Page): Locator => page.getByTestId('text-editor');

export const textToolbar = (page: Page): Locator => page.getByTestId('text-toolbar');

export const textSizeButton = (page: Page, size: TextSize): Locator =>
  page.locator(`[data-testid="text-size-button"][data-size="${size}"]`);

export const textToolButton = (page: Page): Locator => page.getByTestId('text-tool-button');

export const selectToolButton = (page: Page): Locator => page.getByTestId('select-tool-button');

/**
 * Every object on the board, of whatever type, in drawing order.
 * 
 * Story 9 shares a board with story 2, so a test that wants to say something about how
 * a text object and a note sit relative to each other needs both, in the order the
 * board draws them.
 */
export async function docObjects(page: Page): Promise<ObjectSnapshot[]> {
  return page.evaluate(() => {
    const hooks = window.__vidi6Board;
    if (!hooks) {
      throw new Error('window.__vidi6Board is missing: the e2e suite needs the test build');
    }
    return [...hooks.getNotes()];
  });
}

/**
 * The text objects as this page's document holds them, in drawing order.
 *
 * Filtered by type rather than assumed: a board in story 9 holds notes and text, and
 * a test that reads `getNotes()[0]` and calls it a text object is a test that breaks
 * the moment something else is on the board.
 */
export async function docTexts(page: Page): Promise<TextSnapshot[]> {
  return page.evaluate(() => {
    const hooks = window.__vidi6Board;
    if (!hooks) {
      throw new Error('window.__vidi6Board is missing: the e2e suite needs the test build');
    }
    return [...hooks.getNotes()].filter(
      (object): object is TextSnapshot => object.type === 'text',
    ) as TextSnapshot[];
  });
}

export async function textCount(page: Page): Promise<number> {
  return (await docTexts(page)).length;
}

/** One text object by id, wherever it currently sits in the drawing order. */
export async function textById(page: Page, id: string): Promise<TextSnapshot> {
  const found = (await docTexts(page)).find((object) => object.id === id);
  if (!found) throw new Error(`no text object with id ${id} on the board`);
  return found;
}

/** The text object at a drawing position. */
export async function textData(page: Page, index = 0): Promise<TextSnapshot> {
  const all = await docTexts(page);
  const found = all[index];
  if (!found) throw new Error(`no text object at position ${index} of ${all.length}`);
  return found;
}

/** Poll until the document holds `count` text objects and they are drawn. */
export async function waitForTextCount(page: Page, count: number): Promise<void> {
  await expect
    .poll(async () => (await docTexts(page)).length, { message: `expected ${count} text objects` })
    .toBe(count);
  await expect(textElements(page)).toHaveCount(count);
}

/** Turn the Text tool on and wait for the board to say so. */
export async function pressTextTool(page: Page): Promise<void> {
  await page.keyboard.press('t');
  await expect(textToolButton(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(boardSurface(page)).toHaveAttribute('data-text-tool', 'true');
}

/** The board surface, which is the element the Text tool's cursor belongs to. */
export const boardSurface = (page: Page): Locator => page.getByTestId('board-viewport');

/**
 * Place a text object with the real gesture: T, then a click at a screen point.
 *
 * Returns its id, read back out of the document rather than remembered from the
 * click. The editor is left open and focused, which is what the tool is for: the
 * object appears where it was clicked and is ready to be typed into.
 */
export async function placeText(page: Page, at: Point): Promise<string> {
  await pressTextTool(page);
  await page.mouse.click(at.x, at.y);
  await expect(textEditor(page)).toBeFocused();
  // The tool has done its job and stood down: one object per click, and the cursor
  // is a caret where the person expects to type.
  await expect(textToolButton(page)).toHaveAttribute('aria-pressed', 'false');
  const ids = await textIdsInOrder(page);
  if (ids.length === 0) throw new Error('the Text tool placed no object');
  return ids[ids.length - 1]!;
}

/** The ids of the typed text, in document order. */
export const textIdsInOrder = async (page: Page): Promise<string[]> =>
  (await docTexts(page)).map((object) => object.id);

/** Type into the text object that is open for editing, and wait for the document. */
export async function typeIntoText(page: Page, id: string, text: string): Promise<void> {
  await page.keyboard.type(text);
  await expect
    .poll(async () => (await textById(page, id)).text, {
      message: `typed text never reached text object ${id}`,
    })
    .toBe(text);
}

/** Leave editing through the keyboard, which keeps the object selected. */
export async function escapeText(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(textEditor(page)).toHaveCount(0);
  await waitForRender(page);
}

/** The box the text object is drawn at, in CSS pixels. */
export async function textBoxOnScreen(page: Page, index = 0): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await textAt(page, index).boundingBox();
  if (!box) throw new Error(`text object ${index} is not drawn`);
  return box;
}

/** Where a drawn text object is, for starting a drag on it. */
export async function textCentre(page: Page, index = 0): Promise<Point> {
  const box = await textBoxOnScreen(page, index);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * How many lines the words are drawn on, counted as the browser drew them: a Range
 * over the text gives one rectangle per line box. This is the only honest way to
 * say "the words rewrapped" - the stored height is a number the board wrote itself,
 * and a board that wrote a height of five while drawing one line would otherwise
 * agree with itself.
 *
 * The object must not be being edited: a textarea keeps its own lines inside a
 * widget the DOM cannot see into.
 */
export async function drawnTextLines(page: Page, index = 0): Promise<number> {
  const lines = await page.evaluate((textIndex) => {
    const object = document.querySelectorAll<HTMLElement>('[data-testid="text-object"]')[textIndex];
    if (!object) throw new Error(`text object ${textIndex} is not drawn`);
    if (object.querySelector('[data-testid="text-editor"]') !== null) {
      // A textarea keeps its own line boxes where the DOM cannot see them, so a count
      // taken now would be a zero dressed up as a measurement.
      throw new Error(`text object ${textIndex} is being edited: leave editing before counting lines`);
    }
    const content = object.querySelector<HTMLElement>('[data-testid="text-content"]');
    const node = content?.firstChild;
    if (node === null || node === undefined) return 0;
    const range = document.createRange();
    range.selectNodeContents(node);
    return range.getClientRects().length;
  }, index);
  if (!Number.isFinite(lines)) throw new Error(`unreadable line count for text object ${index}`);
  return lines;
}

/** The font size the words are drawn at, in CSS pixels. */
export async function drawnFontSize(page: Page, index = 0): Promise<number> {
  const size = await page.evaluate((textIndex) => {
    const object = document.querySelectorAll<HTMLElement>('[data-testid="text-object"]')[textIndex];
    if (!object) throw new Error(`text object ${textIndex} is not drawn`);
    const content =
      object.querySelector<HTMLElement>('[data-testid="text-content"]') ??
      object.querySelector<HTMLElement>('[data-testid="text-editor"]');
    if (!content) throw new Error(`text object ${textIndex} draws no text`);
    return Number.parseFloat(window.getComputedStyle(content).fontSize);
  }, index);
  if (!Number.isFinite(size)) throw new Error(`unreadable font size for text object ${index}`);
  return size;
}

/**
 * The height one line of this object's size is drawn at, from the object's own
 * computed style rather than from a number this file repeats: the line height is a
 * setting the board and the stylesheet both hold, and a test should measure the one
 * that is actually drawing.
 */
export async function drawnLineHeight(page: Page, index = 0): Promise<number> {
  const height = await page.evaluate((textIndex) => {
    const object = document.querySelectorAll<HTMLElement>('[data-testid="text-object"]')[textIndex];
    const content =
      object?.querySelector<HTMLElement>('[data-testid="text-content"]') ??
      object?.querySelector<HTMLElement>('[data-testid="text-editor"]');
    if (!content) return Number.NaN;
    const lineHeight = Number.parseFloat(window.getComputedStyle(content).lineHeight);
    return Number.isFinite(lineHeight) ? lineHeight : Number.NaN;
  }, index);
  if (!Number.isFinite(height)) {
    // Fall back to the setting the stylesheet is supposed to mirror, so a test still
    // gets a number (and a wrong one, which is what the assertion is for).
    const size = (await textData(page, index)).size;
    return TEXT_SIZES[size] * TEXT_LINE_HEIGHT;
  }
  return height;
}

/** Which text objects this page has selected, in drawing order. */
export function selectedTextIds(page: Page): Promise<string[]> {
  return page.$$eval('[data-testid="text-object"][data-selected="true"]', (elements) =>
    elements.map((element) => (element as HTMLElement).dataset.objectId ?? ''),
  );
}

/** The size the text toolbar shows as pressed, or null when it shows none. */
export async function pressedTextSize(page: Page): Promise<TextSize | null> {
  const pressed = page.locator('[data-testid="text-size-button"][aria-pressed="true"]');
  if ((await pressed.count()) === 0) return null;
  return (await pressed.first().getAttribute('data-size')) as TextSize | null;
}

/**
 * Click a size in the text toolbar.
 *
 * By attribute rather than by accessible name, because the four names are built the
 * same way ("Text size S (14)") and what these tests walk through is the four of
 * them, in order.
 */
export async function clickTextSize(page: Page, size: TextSize): Promise<void> {
  await textSizeButton(page, size).click();
  await waitForRender(page);
}

/** Click the Text tool's own toolbar button. */
export async function clickTextToolButton(page: Page): Promise<void> {
  await textToolButton(page).click();
  await waitForRender(page);
}

/** Click the board with the Text tool active, at a screen point. */
export async function clickBoardWithTextTool(page: Page, at: Point): Promise<void> {
  await page.mouse.click(at.x, at.y);
  await waitForRender(page);
}

/** The text object that would take a click at this point: the top one, by pixels. */
export async function topTextId(page: Page, point: Point): Promise<string | null> {
  return page.evaluate(
    ({ x, y }) => {
      const element = document.elementFromPoint(x, y);
      const object = element?.closest<HTMLElement>('[data-text-object]');
      return object?.dataset.textObject ?? null;
    },
    { x: point.x, y: point.y },
  );
}

/** The texts on the board, in drawing order: what a screen shows, in words. */
export const textContents = async (page: Page): Promise<string[]> =>
  (await docTexts(page)).map((object) => object.text);

/** Character counts of a string, for "every character both people typed is there". */
export function characterCounts(text: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const character of text) counts[character] = (counts[character] ?? 0) + 1;
  return counts;
}

/** The counts of a list of strings added together. */
export function expectedCounts(texts: string[]): Record<string, number> {
  return texts.reduce<Record<string, number>>((total, text) => {
    const counts = characterCounts(text);
    for (const [character, count] of Object.entries(counts)) {
      total[character] = (total[character] ?? 0) + count;
    }
    return total;
  }, {});
}
