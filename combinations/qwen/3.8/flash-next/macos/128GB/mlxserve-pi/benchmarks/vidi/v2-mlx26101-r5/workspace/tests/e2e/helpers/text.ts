/**
 * The pieces of the board story 9 added, seen from a browser.
 *
 * Everything here is read out of what the page drew, in the same way `helpers/board.ts` reads a sticky
 * note out of its `data-` attributes: the numbers a text object carries on its element are the numbers
 * the document holds, and what the test compares is what a person would compare — the words on the
 * screen, the size they are written at, the handles drawn around them. Nothing here reaches into the
 * page's `Y.Doc`, because a person cannot do that either.
 *
 * What this file adds to the note helpers is the two things a text object has that a note does not: a
 * width that belongs to the text until somebody takes it, and a size that is one of four rather than
 * fitted to a square of paper.
 */

import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

import { TEXT_LINE_HEIGHT, TEXT_SIZES, type TextSize } from '../../../src/shared/config';
import { E2E_EVENTUAL_TIMEOUT_MS } from '../../../src/shared/config';
import { objectOf, readCamera } from './board';

/** A piece of text on the board, by id. */
export const textObject = (page: Page, id: string): Locator => objectOf(page, id);

/** The words as the board draws them (empty while somebody is typing them). */
export const textBody = (page: Page, id: string): ReturnType<Page['locator']> =>
  objectOf(page, id).locator('.text-object-body');

/** The box a person types board text into; there is at most one on a board. */
export const textEditor = (page: Page): Locator => page.locator('.text-editor');

/** The four sizes and the bin, shown for one piece of text. */
export const textToolbar = (page: Page): Locator => page.getByTestId('text-toolbar');

/** The counter that appears when a very long text runs out of room. */
export const textCounter = (page: Page): Locator => page.getByTestId('text-counter');

/** Ids of every piece of text on the board, in stacking order. */
export function textIds(page: Page): Promise<string[]> {
  return page
    .locator('.text-object')
    .evaluateAll((els) => els.map((el) => el.dataset['textId'] ?? ''));
}

/** How many pieces of text are on the board. */
export function textCount(page: Page): Promise<number> {
  return page.locator('.text-object').count();
}

/** Waits for this many pieces of text, and returns their ids. */
export async function expectTextCount(page: Page, count: number): Promise<string[]> {
  await expect(page.locator('.text-object'), `waiting for ${count} pieces of text`).toHaveCount(count);
  return textIds(page);
}

/** The words one piece of text holds, as drawn; empty while it is being typed into. */
export async function textContent(page: Page, id: string): Promise<string> {
  const body = textBody(page, id);
  if ((await body.count()) === 0) return '';
  return (await body.textContent()) ?? '';
}

/** What the box being typed into holds. */
export function textEditorValue(page: Page): Promise<string> {
  return textEditor(page).inputValue();
}

/** The numbers of one piece of text, in world units, as the document holds them. */
export function textWorld(
  page: Page,
  id: string,
): Promise<{
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  size: TextSize;
  widthMode: string;
  interaction: string;
}> {
  return objectOf(page, id).evaluate((el) => ({
    x: Number(el.dataset['x']),
    y: Number(el.dataset['y']),
    width: Number(el.dataset['width']),
    height: Number(el.dataset['height']),
    z: Number(el.dataset['z']),
    size: el.dataset['size'] as TextSize,
    widthMode: el.dataset['widthMode'] ?? '',
    interaction: el.dataset['interaction'] ?? '',
  }));
}

/** The size the words are drawn at, in CSS pixels: the size the document holds, as rendered. */
export async function textFontPx(page: Page, id: string): Promise<number> {
  const editing = (await textEditor(page).count()) > 0;
  const target = editing ? textEditor(page) : textBody(page, id);
  const size = await target.evaluate((el) => getComputedStyle(el).fontSize);
  return Number.parseFloat(size);
}

/**
 * How many lines the words are drawn over.
 *
 * Measured with a range over the drawn text rather than worked out from the stored height: the stored
 * height is the board's claim about the words, and what a person sees is line boxes on the screen. The
 * two agreeing is a fact about the product, so it is checked as one, and the browser's own wrapping is
 * what is being looked at here.
 */
export function renderedLines(page: Page, id: string): Promise<number> {
  return textBody(page, id).evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    // Rectangles are per line box; an empty text draws none, which is zero lines and not one.
    return el.textContent === '' ? 0 : range.getClientRects().length;
  });
}

/** The height one line of a given size takes on the screen, in CSS pixels. */
export const lineHeightPx = (size: TextSize): number => TEXT_SIZES[size] * TEXT_LINE_HEIGHT;

/** Where a piece of text sits on the screen, with its centre. */
export async function textScreenBox(
  page: Page,
  id: string,
): Promise<{ x: number; y: number; width: number; height: number; cx: number; cy: number }> {
  const box = await objectOf(page, id).boundingBox();
  if (!box) throw new Error(`text ${id} is not on screen`);
  return { ...box, cx: box.x + box.width / 2, cy: box.y + box.height / 2 };
}

/**
 * The Text tool, and a click where a person wants to write.
 *
 * Returns the id of the text that appeared. The tool is taken by its key, because the key is what the
 * story opens the feature with; the button is clicked in the tests that are about the button.
 */
export async function placeText(page: Page, x: number, y: number): Promise<string> {
  await page.keyboard.press('t');
  await expect(page.getByTestId('board-viewport')).toHaveAttribute('data-tool', 'text');
  await page.mouse.click(x, y);
  await expect(textEditor(page), 'waiting for the box to write in').toBeVisible();
  // The object this click made is the one this page has open for writing — which is a better way of
  // finding it than looking for an object that was not there a moment ago, because on a board other
  // people are using there is no such thing: somebody else's heading can arrive between the click and
  // the look.
  const open = await page
    .locator('.text-object[data-interaction="editing"]')
    .evaluateAll((els) => els.map((el) => el.dataset['textId'] ?? ''));
  expect(open, 'exactly one piece of text is open for writing').toHaveLength(1);
  const id = open[0];
  if (id === undefined) throw new Error('no text object was created');
  return id;
}

/** Writes into the box that is open, one character at a time as a keyboard does. */
export async function typeText(page: Page, words: string): Promise<void> {
  await page.keyboard.type(words);
}

/**
 * Stops writing, however the writing was started, and waits for the box to be gone.
 *
 * `helpers/participants.ts` has a `stopEditing` for a note; a text object's box is a different box, and
 * the difference matters exactly once: a piece of text left with nothing in it is taken away when the
 * box closes, so a test that pressed Escape and then looked at the board is looking at a board with one
 * less object on it.
 */
export async function stopWriting(page: Page): Promise<void> {
  if ((await textEditor(page).count()) > 0) await page.keyboard.press('Escape');
  await expect(textEditor(page), 'waiting for the box to close').toHaveCount(0, {
    timeout: E2E_EVENTUAL_TIMEOUT_MS,
  });
}

/** Chooses one of the four sizes from the bar over the selection. */
export async function chooseTextSize(page: Page, size: TextSize): Promise<void> {
  await page.getByTestId(`text-size-${size}`).click();
  await expect(page.locator('.text-object[data-size]')).toHaveCount(1);
}

/** Opens a piece of text for writing by clicking it and pressing Enter, as the keyboard does. */
export async function openText(page: Page, id: string): Promise<void> {
  const box = await textScreenBox(page, id);
  await page.mouse.click(box.cx, box.cy);
  await page.keyboard.press('Enter');
  await expect(textEditor(page), 'waiting for the box to open').toBeVisible();
}

/** Where the pointer has to go to put the caret at a world point inside the box being typed into. */
export async function caretScreenOf(page: Page, world: { x: number; y: number }): Promise<{ x: number; y: number }> {
  const camera = await readCamera(page);
  return { x: (world.x - camera.x) * camera.zoom, y: (world.y - camera.y) * camera.zoom };
}

/** The two tools, for a test that is about the buttons rather than the keys. */
export const textToolButton = (page: Page): Locator => page.getByTestId('tool-text');
export const selectToolButton = (page: Page): Locator => page.getByTestId('tool-select');

/**
 * Three hundred characters of annotation, which is what the story says somebody pastes.
 *
 * The length is part of the fixture rather than a number in a test: the story's claim is about a
 * paragraph of a particular size, and a fixture that quietly grew would leave the test checking
 * something else. It is longer than the widest box the board gives text, which is the whole point.
 */
export const LONG_ANNOTATION =
  'We said the retro worked because everybody wrote something down before they argued about it, ' +
  'and the headings over each cluster helped people put their cards in the right place without ' +
  'asking where a thing was supposed to go, which saved much more time than anyone expected at the ' +
  'very start of this.';

/**
 * A sentence long enough to be drawn over more than one line and short enough to be read.
 *
 * This is the fixture for the tests about wrapping: a width pulled narrower has to move words onto new
 * lines for it to mean anything, and one short word cannot do that.
 */
export const WRAPPED_NOTE =
  'The headings over each cluster helped people put their cards in the right place. Nobody had to ask twice.';

/** Whether the Text tool is the one lit up. */
export function toolState(page: Page): Promise<string | null> {
  return page.getByTestId('board-viewport').getAttribute('data-tool');
}

/** Every piece of text on the board, as one string: place, size, width, words. Two screens agree. */
export function textSnapshot(page: Page): Promise<string> {
  return page.evaluate(() => {
    const texts = Array.from(document.querySelectorAll<HTMLElement>('.text-object')).map((el) => {
      const shown = el.querySelector<HTMLElement>('.text-object-body')?.textContent;
      const typing = el.querySelector<HTMLTextAreaElement>('.text-editor')?.value ?? '';
      return [
        el.dataset['textId'] ?? '',
        el.dataset['x'] ?? '',
        el.dataset['y'] ?? '',
        el.dataset['size'] ?? '',
        el.dataset['widthMode'] ?? '',
        el.dataset['width'] ?? '',
        shown ?? typing,
      ].join('~');
    });
    return texts.sort().join('|');
  });
}
