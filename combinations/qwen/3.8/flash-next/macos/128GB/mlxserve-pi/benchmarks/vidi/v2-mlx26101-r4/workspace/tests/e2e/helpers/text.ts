/**
 * Helpers for the story 9 e2e tests: pieces of free text in a real browser.
 *
 * What these add over the sticky-note helpers is the part of a text object that only a real browser can
 * answer — how wide the machine's own font makes a word, and whether the words fit inside the box the board
 * decided they needed. Everything here either drives the tool, reads the document back through the page's
 * own hook, or measures the element the page actually painted; the assertions themselves stay in the spec,
 * where they can be argued about.
 */
import { expect, type Locator, type Page } from '@playwright/test';

import type { TextSnapshot } from '../../../src/shared/objects/text';
import { settled } from './board';
import type { Point } from './board';
import type { Box } from './sticky';
import { boxOf } from './sticky';

/**
 * The pieces of text as the page's document holds them, in stacking order — what was stored, which is not
 * always what is painted, and the difference between the two is most of this story.
 */
export async function texts(page: Page): Promise<readonly TextSnapshot[]> {
  const found = await page.evaluate(() => window.__vidi6?.getTexts());
  if (!found) throw new Error('the page does not expose its document; run `npm run test:e2e`');
  return found;
}

export async function textCount(page: Page): Promise<number> {
  return (await texts(page)).length;
}

export async function textAt(page: Page, index = 0): Promise<TextSnapshot> {
  const all = await texts(page);
  const found = all[index];
  if (!found) throw new Error(`there is no piece of text number ${index + 1} on the board`);
  return found;
}

/** The painted pieces of text, in the order they were made. */
export function textElements(page: Page): Locator {
  return page.getByTestId('text-object');
}

export function textElementAt(page: Page, index = 0): Locator {
  return textElements(page).nth(index);
}

/** The editor, while somebody is typing. */
export function textEditor(page: Page): Locator {
  return page.getByTestId('text-textarea');
}

export function textCounter(page: Page): Locator {
  return page.getByTestId('text-counter');
}

export function textButton(page: Page): Locator {
  return page.getByRole('button', { name: 'Text (T)', exact: true });
}

export function selectButton(page: Page): Locator {
  return page.getByRole('button', { name: 'Select (V)', exact: true });
}

export function textSizeButton(page: Page, size: 'S' | 'M' | 'L' | 'XL'): Locator {
  return page.getByTestId(`text-size-${size}`);
}

export function textDeleteButton(page: Page): Locator {
  return page.getByTestId('text-delete');
}

/** Which tool is in use, by the accessible name of the button that says so. */
export async function pressedTool(page: Page): Promise<string | null> {
  return page.evaluate(
    () =>
      document.querySelector<HTMLElement>('.toolbar__button[aria-pressed="true"]')?.getAttribute('aria-label') ?? null,
  );
}

/** Whether the board is armed for putting a piece of text down. */
export async function textIsArmed(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.querySelector<HTMLElement>('[data-testid="board-viewport"]')?.dataset.textTool === 'armed',
  );
}

/** The box a piece of text paints, in screen coordinates. */
export async function textBox(page: Page, index = 0): Promise<Box> {
  return boxOf(textElementAt(page, index));
}

/**
 * How much of a piece of text sticks out of the box it was given, in screen pixels.
 *
 * Zero is the only good answer, and it is the answer a browser can give that a headless test cannot: the
 * element's own measurement of its words against the width it was laid out with. A box measured with a
 * different font, or a box that stopped being measured at all, shows up here as a positive number — text
 * running out of the side of a heading, which is the failure this story exists to avoid.
 */
export async function textOverflowPx(page: Page, index = 0): Promise<number> {
  return textElementAt(page, index).evaluate((element) => {
    const text = element.querySelector<HTMLElement>('[data-testid="text-content"]');
    if (!text) throw new Error('the piece of text paints no text to measure');
    return text.scrollWidth - text.clientWidth;
  });
}

/**
 * How wide the words themselves are, in screen pixels: the widest line the page had to draw.
 *
 * This is the number the box is supposed to have been built from, so it is measured off the text rather than
 * off the box — a `Range` over the words, whose client rectangles are the lines. `scrollWidth` and
 * `clientWidth` cannot answer this question: both of them include the element's own padding, so both are the
 * width of the box and neither is the width of a word.
 */
export async function textContentWidthPx(page: Page, index = 0): Promise<number> {
  return textElementAt(page, index).evaluate((element) => {
    const text = element.querySelector<HTMLElement>('[data-testid="text-content"]');
    if (!text) throw new Error('the piece of text paints no text to measure');
    const range = document.createRange();
    range.selectNodeContents(text);
    let widest = 0;
    for (const rect of Array.from(range.getClientRects())) widest = Math.max(widest, rect.width);
    range.detach();
    return widest;
  });
}

/** The font size the page actually paints, in screen pixels — computed, not the value in a style attribute. */
export async function paintedFontPx(page: Page, index = 0): Promise<number> {
  return textElementAt(page, index).evaluate((element) => {
    const text = element.querySelector<HTMLElement>('[data-testid="text-content"]');
    if (!text) throw new Error('the piece of text paints no text to measure');
    return Number.parseFloat(getComputedStyle(text).fontSize);
  });
}

/**
 * Arm the text tool, click a point on the board and type, leaving the caret in the object.
 *
 * The id is found by diffing the document rather than by counting, because a test that runs after another
 * test on the same board would otherwise read somebody else's heading.
 */
export async function startTextAt(page: Page, at: Point, text = ''): Promise<string> {
  const before = new Set((await texts(page)).map((item) => item.id));
  await textButton(page).click();
  await expect(textIsArmed(page)).resolves.toBe(true);
  // The board is clicked with the mouse rather than through a helper, because the whole point of the tool is
  // that the click lands where a person put it and means "here".
  await page.mouse.click(at.x, at.y);
  await expect(textEditor(page)).toBeVisible();
  const added = (await texts(page)).filter((item) => !before.has(item.id));
  if (added.length !== 1) throw new Error(`the click should have made one piece of text, made ${added.length}`);
  if (text !== '') await page.keyboard.type(text);
  return added[0].id;
}

/** The same, and then Escape: a finished piece of text, selected and not being typed in. */
export async function createTextAt(page: Page, at: Point, text = ''): Promise<string> {
  const id = await startTextAt(page, at, text);
  await page.keyboard.press('Escape');
  await expect(textEditor(page)).toHaveCount(0);
  await settled(page);
  return id;
}

/**
 * Drag one of the two handles a selected piece of text has, by screen travel.
 *
 * Screen pixels, not board units: this is the pointer's side of the story, and the zoom is applied by the
 * page rather than by the test.
 */
export async function dragTextHandle(page: Page, handle: 'e' | 'w', dx: number): Promise<void> {
  const box = await page.locator(`[data-testid="resize-handle-${handle}"]`).boundingBox();
  if (!box) throw new Error(`there is no ${handle} handle to drag`);
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y, { steps: 4 });
  await page.mouse.move(from.x + dx, from.y, { steps: 4 });
  await page.mouse.up();
  await settled(page);
}

/** What a second browser paints for one piece of text: its words, and the box it puts them in. */
export interface PaintedText {
  id: string;
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
  fontPx: number;
}

export async function paintedText(page: Page, index = 0): Promise<PaintedText> {
  const element = textElementAt(page, index);
  const box = await boxOf(element);
  const [text, fontPx, id] = await Promise.all([
    element.evaluate((node) => node.querySelector('[data-testid="text-content"]')?.textContent ?? ''),
    paintedFontPx(page, index),
    element.getAttribute('data-text-id'),
  ]);
  return { id: id ?? '', text, left: box.x, top: box.y, width: box.width, height: box.height, fontPx };
}

/** The painted piece of text with a given id, wherever it is in the stacking order. */
export function textElementById(page: Page, id: string): Locator {
  return page.locator(`[data-text-id="${id}"]`);
}

/** Where a piece of text is painted, in screen coordinates. */
export async function textBoxById(page: Page, id: string): Promise<Box> {
  return boxOf(textElementById(page, id));
}

/** The middle of a piece of text, on screen — the point to press it with. */
export async function textCentre(page: Page, id: string): Promise<Point> {
  const box = await textBoxById(page, id);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * Select a piece of text and open it for typing.
 *
 * Two actions rather than a double-click, because that is the route this story's own component tests take
 * and the one the board documents: press the object, then press Enter. A test that double-clicked would be
 * testing a shortcut that sticky notes have and that nobody promised for a heading.
 */
export async function editTextById(page: Page, id: string): Promise<void> {
  await textElementById(page, id).click();
  await page.keyboard.press('Enter');
  await expect(textEditor(page), 'this person has no text box open').toBeVisible();
}

/** The stacking order the page paints, bottom first: the `z-index` of every piece of text on the board. */
export async function paintedTextIds(page: Page): Promise<string[]> {
  const listed = await textElements(page).evaluateAll((elements) =>
    elements.map((element, index) => ({
      id: element.getAttribute('data-text-id') ?? '',
      z: Number.parseFloat(getComputedStyle(element).zIndex) || 0,
      index,
    })),
  );
  return listed.sort((a, b) => a.z - b.z || a.index - b.index).map((item) => item.id);
}
