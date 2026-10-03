/**
 * Browser helpers for story 9: read the pieces of text that are on screen, and drive the
 * Text tool the way a person does.
 *
 * A text object carries its document box in `data-text-*` attributes, the same trick the
 * notes use, and for text that comparison is the feature: the box in the document is meant
 * to be the box the browser painted around the words. Where a test needs what was actually
 * laid out rather than what was stored, it asks the layout engine — `paintedLineCount`
 * counts the line boxes the words really broke into.
 */
import { expect, type Page } from '@playwright/test';

import { readCamera, type ScreenPoint } from './board';

export const TEXT_SELECTOR = '[data-testid="text-object"]';
export const TEXT_EDITOR_SELECTOR = '[data-testid="text-editor"]';
export const TEXT_TOOLBAR_SELECTOR = '[data-testid="text-toolbar"]';
export const HANDLE_SELECTOR = '[data-testid="selection-handle"]';

export interface TextOnScreen {
  id: string;
  /** Document box, in world units. */
  x: number;
  y: number;
  width: number;
  height: number;
  size: string;
  widthMode: string;
  length: number;
  selected: boolean;
  editing: boolean;
  /** Painted rectangle, in CSS pixels. */
  box: { x: number; y: number; width: number; height: number };
}

async function readElements(page: Page): Promise<TextOnScreen[]> {
  return page.$$eval(TEXT_SELECTOR, (elements) =>
    elements.map((element) => {
      const node = element as HTMLElement;
      const rect = node.getBoundingClientRect();
      return {
        id: node.dataset.textId ?? '',
        x: Number(node.dataset.textX),
        y: Number(node.dataset.textY),
        width: Number(node.dataset.textWidth),
        height: Number(node.dataset.textHeight),
        size: node.dataset.textSize ?? '',
        widthMode: node.dataset.textWidthMode ?? '',
        length: Number(node.dataset.textLength),
        selected: node.dataset.selected === 'true',
        editing: node.classList.contains('text-object--editing'),
        box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      };
    }),
  );
}

/** Every piece of text on this screen, in document order. */
export async function readTexts(page: Page): Promise<TextOnScreen[]> {
  return readElements(page);
}

export async function textCount(page: Page): Promise<number> {
  return (await page.$$(TEXT_SELECTOR)).length;
}

/** One piece of text by id, or null when this screen does not have it. */
export async function readText(page: Page, id: string): Promise<TextOnScreen | null> {
  return (await readElements(page)).find((text) => text.id === id) ?? null;
}

/** Wait until the box of a piece of text stops changing: measurement has settled. */
export async function waitForBox(page: Page, id: string): Promise<TextOnScreen> {
  let previous = await readText(page, id);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await page.waitForTimeout(50);
    const current = await readText(page, id);
    if (
      current &&
      previous &&
      current.width === previous.width &&
      current.height === previous.height &&
      current.x === previous.x &&
      current.y === previous.y
    ) {
      return current;
    }
    previous = current;
  }
  if (!previous) throw new Error(`text ${id} is not on this board`);
  return previous;
}

/**
 * Type into the field that is open, and wait for the box to describe what was typed.
 *
 * Two waits, because there are two things to wait for: the keystrokes have to reach the
 * document (the editor commits on a debounce), and the box then has to be measured for the
 * words that arrived. Waiting only for the box to stop moving would notice the pause between
 * two commits and call it settled.
 */
export async function typeIntoText(page: Page, id: string, text: string): Promise<TextOnScreen> {
  await page.keyboard.type(text, { delay: 1 });
  await expect
    .poll(() => readText(page, id).then((current) => current?.length ?? -1), {
      message: `the typing never reached text ${id}`,
      timeout: 10_000,
    })
    .toBe(text.length);
  return waitForBox(page, id);
}

/** Arm the Text tool with the keyboard. */
export async function armTextTool(page: Page): Promise<void> {
  await page.keyboard.press('t');
  await expect(page.locator('[data-testid="board-viewport"].board-viewport--text')).toHaveCount(1);
}

/**
 * Put a piece of text on the board at a screen point, and start typing it: the Text tool,
 * one click, an empty field with the caret in it.
 */
export async function placeText(page: Page, at: ScreenPoint): Promise<string> {
  const before = new Set((await readElements(page)).map((text) => text.id));
  // Stop typing first: a key pressed inside an editor belongs to the editor, so arming the
  // tool from inside one would write a letter rather than switch tools.
  await page.keyboard.press('Escape');
  await armTextTool(page);
  await page.mouse.click(at.x, at.y);
  await expect(page.locator(TEXT_EDITOR_SELECTOR)).toBeVisible();
  await expect
    .poll(() => readElements(page).then((texts) => texts.filter((text) => !before.has(text.id))), {
      message: 'the click did not create a piece of text',
    })
    .not.toHaveLength(0);
  const created = (await readElements(page)).find((text) => !before.has(text.id));
  if (!created) throw new Error('no text appeared after the click');
  return created.id;
}

/** Click a piece of text to select it (it must not be being edited). */
export async function selectText(page: Page, id: string): Promise<ScreenPoint> {
  const box = await page.locator(`${TEXT_SELECTOR}[data-text-id="${id}"]`).boundingBox();
  if (!box) throw new Error(`text ${id} has no box on screen`);
  const point = { x: box.x + Math.min(8, box.width / 2), y: box.y + Math.min(8, box.height / 2) };
  await page.mouse.click(point.x, point.y);
  await expect
    .poll(() => readText(page, id).then((text) => text?.selected ?? false), {
      message: `text ${id} did not become selected`,
    })
    .toBe(true);
  return point;
}

/** Start editing a piece of text that exists, the way Enter does. */
export async function editText(page: Page, id: string): Promise<void> {
  await selectText(page, id);
  await page.keyboard.press('Enter');
  await expect(page.locator(TEXT_EDITOR_SELECTOR)).toBeVisible();
}

/** The handles this screen offers, left to right as the overlay lays them out. */
export async function handleIds(page: Page): Promise<string[]> {
  return page.$$eval(HANDLE_SELECTOR, (elements) =>
    elements.map((element) => (element as HTMLElement).dataset.handle ?? ''),
  );
}

/** The centre of one handle, in screen pixels. */
export async function textHandleCentre(page: Page, handle: string): Promise<ScreenPoint> {
  const box = await page
    .locator(`${HANDLE_SELECTOR}[data-handle="${handle}"]`)
    .boundingBox()
    .catch(() => null);
  if (!box) throw new Error(`there is no ${handle} handle to press`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Drag a handle, and let the frame-coalesced writes settle. */
export async function dragTextHandle(
  page: Page,
  handle: string,
  delta: ScreenPoint,
): Promise<void> {
  const from = await textHandleCentre(page, handle);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + delta.x, from.y + delta.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(120);
}

/**
 * How many line boxes the words are laid out in, counted from the layout engine rather
 * than from the stored height.
 */
export async function paintedLineCount(page: Page, id: string): Promise<number> {
  return page.evaluate((selector) => {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) return -1;
    // The wrapper is a box, not a line: it contributes one rectangle the size of itself.
    // The words live in the editor while the box is typed into, and in the content element
    // the rest of the time.
    const target =
      element.querySelector<HTMLElement>('.text-object__editor') ??
      element.querySelector<HTMLElement>('.text-object__content') ??
      element;
    const range = document.createRange();
    range.selectNodeContents(target);
    // One rectangle per *line box*, but a wrapped line can contribute several as the caret
    // hops; distinct vertical positions are the lines a person counts.
    const rows = new Set<number>();
    for (const rect of Array.from(range.getClientRects())) {
      if (rect.height > 0) rows.add(Math.round(rect.y));
    }
    return rows.size;
  }, `${TEXT_SELECTOR}[data-text-id="${id}"]`);
}

/** The font size the browser is actually painting, in CSS pixels. */
export async function paintedFontSize(page: Page, id: string): Promise<number> {
  const element = await page.$(`${TEXT_SELECTOR}[data-text-id="${id}"]`);
  if (!element) throw new Error(`there is no text ${id} to measure`);
  return element.evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize));
}

/** The words a piece of text holds, as this screen renders them. */
export async function paintedText(page: Page, id: string): Promise<string> {
  const element = await page.$(`${TEXT_SELECTOR}[data-text-id="${id}"]`);
  if (!element) throw new Error(`there is no text ${id} to read`);
  return element.evaluate((node) => node.textContent ?? '');
}

/** Zoom the board is at, so world units and pixels can be compared. */
export async function zoom(page: Page): Promise<number> {
  return (await readCamera(page)).zoom;
}
