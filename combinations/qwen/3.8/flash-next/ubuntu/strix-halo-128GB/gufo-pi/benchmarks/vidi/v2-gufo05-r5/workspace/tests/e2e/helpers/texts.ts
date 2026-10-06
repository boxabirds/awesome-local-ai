/**
 * Text object helpers for browser tests (story 9).
 *
 * A text draws itself as `.board-text`, carries its id in `data-text-id` and its presets in
 * `data-size` / `data-width-mode`. The box a person sees is the *inner* area - the rendered text,
 * or the textarea while it is being written - because the outer element adds the headroom around
 * the letters, which is not part of the stored box.
 *
 * Two points of view show up throughout: the box on the screen (what wrapping and clipping look
 * like) and the box in the document (the numbers that travel). Keeping them apart is what makes a
 * wrapping assertion readable: the first belongs to this browser, the second to everybody.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import type { TextSnapshot } from '../../../src/shared/board-model';
import type { Point } from '../../../src/client/canvas/camera';

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The text objects in this page's document, in render order. */
export async function getTexts(page: Page): Promise<readonly TextSnapshot[]> {
  return page.evaluate(
    () =>
      window
        .__vidi6!.getObjects()
        .filter((object) => object.type === 'text') as unknown as readonly TextSnapshot[],
  );
}

export async function textCount(page: Page): Promise<number> {
  return (await getTexts(page)).length;
}

/** The document's own numbers for one text: where it is and how big it is, in world units. */
export async function textInDoc(page: Page, id: string): Promise<TextSnapshot | undefined> {
  return (await getTexts(page)).find((object) => object.id === id);
}

export function textN(page: Page, id: string): Locator {
  return page.locator(`[data-text-id="${id}"]`);
}

/** The area the text is laid out in: the rendered lines, or the textarea while editing. */
function textArea(page: Page, id: string): Locator {
  return page.locator(`[data-text-id="${id}"] :is(.board-text__content, .board-text__input)`);
}

/** Where the text's box is on the screen. */
export async function textBoxOnScreen(page: Page, id: string): Promise<Box> {
  const box = await textArea(page, id).boundingBox();
  if (!box) throw new Error(`text ${id} is not on the screen`);
  return box;
}

/** The box as the element is sized to it, in world units: independent of zoom and of the window. */
export function storedTextBox(page: Page, id: string): Promise<{ width: number; height: number }> {
  return textN(page, id).evaluate((element) => ({
    width: Number.parseFloat(element.style.width),
    height: Number.parseFloat(element.style.height),
  }));
}

/**
 * True when the browser drew the text inside the height the document stores.
 *
 * The height is computed here and only written by the screen that changed the text, so this is the
 * assertion that a person's words are not cut off on anyone else's screen.
 */
export function textIsWhole(page: Page, id: string): Promise<boolean> {
  return textArea(page, id).evaluate(
    (element) => element.scrollHeight <= element.clientHeight + 1,
  );
}

/** How many lines the browser actually drew, from the height of one line. */
export function renderedLineCount(page: Page, id: string): Promise<number> {
  return textArea(page, id).evaluate((element) => {
    const style = getComputedStyle(element);
    const lineHeight = Number.parseFloat(style.lineHeight);
    if (!Number.isFinite(lineHeight) || lineHeight <= 0) return 0;
    return Math.round(element.scrollHeight / lineHeight);
  });
}

/** The font the text is drawn with, in screen pixels, and its leading. */
export function textFont(page: Page, id: string): Promise<{ fontSize: number; lineHeight: number }> {
  return textArea(page, id).evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      fontSize: Number.parseFloat(style.fontSize),
      lineHeight: Number.parseFloat(style.lineHeight),
    };
  });
}

/** How wide `text` is in the board's own font, measured by this browser. */
export function measureInPage(page: Page, text: string, fontPx: number): Promise<number> {
  return page.evaluate(
    ({ content, font }) => {
      const drawn = document.querySelector<HTMLElement>('.board-text__content');
      const context = document.createElement('canvas').getContext('2d');
      if (!context) throw new Error('this browser cannot measure text');
      // the same face the stylesheet draws with, so the number is the one the app would get
      context.font = `${font}px ${getComputedStyle(drawn ?? document.body).fontFamily}`;
      return context.measureText(content).width;
    },
    { content: text, font: fontPx },
  );
}

export async function expectTextContent(page: Page, id: string, content: string): Promise<void> {
  await expect(textN(page, id)).toContainText(content, { timeout: 10_000 });
}

/** Which tool the board is in, as it is drawn on the viewport. */
export function toolMode(page: Page): Promise<string | null> {
  return page.getByTestId('board-viewport').getAttribute('data-tool');
}

export async function pickTextTool(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await page.keyboard.press('t');
  await expect(page.getByTestId('board-viewport')).toHaveAttribute('data-tool', 'text');
}

export async function pickSelectTool(page: Page): Promise<void> {
  await page.keyboard.press('v');
  await expect(page.getByTestId('board-viewport')).toHaveAttribute('data-tool', 'select');
}

/**
 * Places a text with the Text tool at a screen point, types into it and ends the edit.
 * The text starts - top-left corner - where it was clicked.
 */
export async function addText(page: Page, at: Point, content = ''): Promise<string> {
  await pickTextTool(page);
  const before = new Set((await getTexts(page)).map((object) => object.id));
  await page.mouse.click(at.x, at.y);
  await expect(editorOf(page)).toBeVisible({ timeout: 10_000 });
  if (content) await page.keyboard.type(content, { delay: 5 });
  await page.keyboard.press('Escape');
  await expect(editorOf(page)).toHaveCount(0);
  // which text is the one this click made, when other people may have been writing at the same time
  const fresh = (await getTexts(page)).filter((object) => !before.has(object.id));
  const placed = content ? fresh.find((object) => object.text.includes(content)) ?? fresh.at(-1) : fresh.at(-1);
  if (!placed) throw new Error('the Text tool placed no text');
  if (content) await expectTextContent(page, placed.id, content);
  await pickSelectTool(page);
  return placed.id;
}

/** Selects a text with a single click, leaving it selected and not being written. */
export async function selectText(page: Page, id: string): Promise<void> {
  await pickSelectTool(page);
  const box = await textBoxOnScreen(page, id);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(textN(page, id)).toHaveAttribute('data-selected', 'true', { timeout: 10_000 });
}

/** Adds to a selection without dropping what is already selected. */
export async function addToSelection(page: Page, at: Point): Promise<void> {
  await page.keyboard.down('Shift');
  await page.mouse.click(at.x, at.y);
  await page.keyboard.up('Shift');
}

/** Double-clicks a text to write it, with the caret at the end. */
export async function editText(page: Page, id: string): Promise<void> {
  await pickSelectTool(page);
  const box = await textBoxOnScreen(page, id);
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByTestId('text-object-input')).toBeVisible({ timeout: 10_000 });
}

export function editorOf(page: Page): Locator {
  return page.getByTestId('text-object-input');
}

/** Clicks one of the four size buttons of the selected text, by the word a person reads. */
export async function setTextSize(page: Page, id: string, preset: 'Small' | 'Medium' | 'Large' | 'Extra large'): Promise<void> {
  const sizes = { Small: 'S', Medium: 'M', Large: 'L', 'Extra large': 'XL' } as const;
  // exact: 'Large text' is inside 'Extra large text', and a substring match would be ambiguous
  await textN(page, id).getByLabel(`${preset} text`, { exact: true }).click();
  await expect(textN(page, id)).toHaveAttribute('data-size', sizes[preset], { timeout: 10_000 });
}

/** Drags a resize handle by a screen offset, the way a pointer does it. */
export async function dragHandleBy(page: Page, handle: string, dx: number, dy: number): Promise<void> {
  const box = await page.locator(`.selection-handle[data-handle="${handle}"]`).boundingBox();
  if (!box) throw new Error(`handle ${handle} is not on the screen`);
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 8 });
  await page.mouse.up();
}

export function handleNames(page: Page): Promise<string[]> {
  return page
    .locator('.selection-handle')
    .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-handle') ?? ''));
}
