// Driving free text in a real browser (story 9).
//
// Written in the shape of `helpers/sticky.ts`, and for the same reason: a text object
// is asked about through the screen — the box it was measured into is read out of the
// style the browser was told to use, the size out of `data-size` — never by reaching
// into the document from the test.
import { expect, type Locator, type Page } from '@playwright/test';
import { TEXT_LINE_HEIGHT, TEXT_SIZES, type TextSize } from '../../../src/shared/config';
import { readCamera, VIEWPORT } from './board';

/** What one text object looks like on one screen. */
export interface TextInfo {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
  size: string;
  widthMode: string;
  text: string;
  selected: boolean;
  editing: boolean;
  /** The grey word that says an empty box is where the typing goes. */
  placeholder: boolean;
}

const read = (page: Page): Promise<TextInfo[]> =>
  page.evaluate(() =>
    Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid="text-object"]'),
    ).map((element) => ({
      id: element.dataset.id ?? '',
      left: Number.parseFloat(element.style.left),
      top: Number.parseFloat(element.style.top),
      width: Number.parseFloat(element.style.width),
      height: Number.parseFloat(element.style.height),
      size: element.dataset.size ?? '',
      widthMode: element.dataset.widthMode ?? '',
      text: element.querySelector('[data-testid="text-object-text"]')?.textContent ?? '',
      selected: element.dataset.selected === 'true',
      editing: !!element.querySelector('[data-testid="text-object-editor"]'),
      placeholder: element.dataset.placeholder === 'true',
    })),
  );

export const textCount = async (page: Page): Promise<number> =>
  page.locator('[data-testid="text-object"]').count();

/** All text objects, in draw order. */
export async function readTexts(page: Page): Promise<TextInfo[]> {
  const texts = await read(page);
  for (const text of texts) {
    for (const key of ['left', 'top', 'width', 'height'] as const) {
      if (!Number.isFinite(text[key])) throw new Error(`text "${text.id}" has no ${key}`);
    }
  }
  return texts;
}

export async function textAt(page: Page, index: number): Promise<TextInfo> {
  const texts = await readTexts(page);
  const text = texts[index];
  if (!text) throw new Error(`no text object at index ${String(index)}`);
  return text;
}

/** The one text object on the board, with a clear error when that is not true. */
export async function onlyText(page: Page): Promise<TextInfo> {
  const texts = await readTexts(page);
  if (texts.length !== 1) {
    throw new Error(`expected one text object, found ${String(texts.length)}`);
  }
  const text = texts[0];
  if (!text) throw new Error('no text object on the board');
  return text;
}

/** How the id of the only text object. */
export async function onlyTextId(page: Page): Promise<string> {
  return (await onlyText(page)).id;
}

export const textEditor = (page: Page): Locator =>
  page.locator('[data-testid="text-object-editor"]');

export const textToolButton = (page: Page): Locator =>
  page.getByTestId('tool-text');

export const textToolIsOn = async (page: Page): Promise<boolean> =>
  (await textToolButton(page).getAttribute('aria-pressed')) === 'true';

export const selectToolIsOn = async (page: Page): Promise<boolean> =>
  (await page.getByTestId('tool-select').getAttribute('aria-pressed')) === 'true';

/**
 * Ask for the text tool the way the rail does, by button: it answers whoever has
 * the focus. The keyboard route is `pressTextToolKey`, which needs the board itself
 * to be holding the focus — as it does when nothing has been clicked yet.
 */
export const askForTextTool = (page: Page): Promise<void> =>
  textToolButton(page).click();

export const pressTextToolKey = (page: Page): Promise<void> => page.keyboard.press('t');

export const clickTextToolButton = (page: Page): Promise<void> =>
  textToolButton(page).click();

/**
 * Place text with the tool: ask for it, click where the words start, and wait for the
 * caret to be in the box. Returns the object that came of it.
 */
export async function placeText(page: Page, x: number, y: number): Promise<TextInfo> {
  await askForTextTool(page);
  await expect(textToolIsOn(page)).resolves.toBe(true);
  const camera = await readCamera(page);
  await page.mouse.click(x, y);
  await expect(textEditor(page)).toBeVisible();
  // The one being edited is the one that was just placed, whatever else is on the board.
  const texts = await read(page);
  const placed = texts.find((text) => text.editing);
  if (!placed) throw new Error('the text tool opened no editor');
  // The box is placed by its top-left, which is where the click was.
  const expected = { x: x / camera.zoom + camera.x, y: y / camera.zoom + camera.y };
  if (Math.abs(placed.left - expected.x) > 1 || Math.abs(placed.top - expected.y) > 1) {
    throw new Error(
      `text was placed at (${String(placed.left)}, ${String(placed.top)}), ` +
        `not under the click at (${String(expected.x)}, ${String(expected.y)})`,
    );
  }
  return placed;
}

/** Type into the open box (real keystrokes, so the app's own clamping is exercised). */
export const typeText = (page: Page, value: string): Promise<void> =>
  page.keyboard.type(value);

/** Escape inside the editor: it ends, and a box with words in it stays selected. */
export async function stopEditingText(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="text-object-editor"]')).toHaveCount(0);
}

/** The box the object was measured into, as the browser has it. */
export const textBox = async (
  page: Page,
  index = 0,
): Promise<{ width: number; height: number }> => {
  const text = await textAt(page, index);
  return { width: text.width, height: text.height };
};

/** How many lines the box is as tall as, in the sizes the board uses. */
export const lineCount = (text: TextInfo): number =>
  Math.round(text.height / (TEXT_SIZES[text.size as TextSize] * TEXT_LINE_HEIGHT));

/** Which size the toolbar says is on. */
export async function toolbarSize(page: Page): Promise<TextSize> {
  for (const size of Object.keys(TEXT_SIZES) as TextSize[]) {
    if ((await page.getByTestId(`text-size-${size}`).getAttribute('aria-pressed')) === 'true') {
      return size;
    }
  }
  throw new Error('the text toolbar says no size is on');
}

export const clickSize = (page: Page, size: TextSize): Promise<void> =>
  page.getByTestId(`text-size-${size}`).click();

/** The resize handles the selection is drawing, by name. */
export async function handleNames(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-testid="resize-handle"]')).map(
      (element) => element.dataset.handle ?? '',
    ),
  );
}

/** Drag a named resize handle by (dx, dy) screen pixels. */
export async function dragHandle(
  page: Page,
  name: string,
  dx: number,
  dy: number,
): Promise<void> {
  const handle = page.locator(`[data-testid="resize-handle"][data-handle="${name}"]`);
  await expect(handle).toBeVisible();
  const box = await handle.boundingBox();
  if (!box) throw new Error(`the "${name}" handle has no box`);
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  // A pointer that leaves the window is not a pointer anyone is dragging: Firefox
  // reports its coordinates as (0, 0) outside the window, which the board reads as a
  // jump to the far side of the anchor. So a drag that would leave the viewport is
  // taken to its edge instead, in as many steps as it needs.
  const step = (x: number, y: number) => ({
    x: Math.min(Math.max(x, 4), VIEWPORT.width - 4),
    y: Math.min(Math.max(y, 4), VIEWPORT.height - 4),
  });
  const half = step(from.x + dx / 2, from.y + dy / 2);
  const to = step(from.x + dx, from.y + dy);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(half.x, half.y, { steps: 5 });
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
}

/** Where an object the size of a click is, so a test can click its middle. */
export async function textCentre(page: Page, index = 0): Promise<{ x: number; y: number }> {
  const centre = await page.evaluate((i) => {
    const element = document.querySelectorAll('[data-testid="text-object"]')[i];
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }, index);
  if (!centre) throw new Error('no text object to click');
  return centre;
}

/** Select the object with one click, the way the mouse does. */
export async function selectText(page: Page, index = 0): Promise<void> {
  const centre = await textCentre(page, index);
  await page.mouse.click(centre.x, centre.y);
  await expect.poll(async () => (await textAt(page, index)).selected).toBe(true);
}

/** The ids of every text object on this screen, in draw order. */
export async function textIds(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-testid="text-object"]')).map(
      (element) => element.dataset.id ?? '',
    ),
  );
}

/** Open one text object's editor with a double-click, wherever it is. */
export async function editTextById(page: Page, id: string): Promise<void> {
  const centre = await page.evaluate((wanted) => {
    const element = document.querySelector<HTMLElement>(
      `[data-testid="text-object"][data-id="${wanted}"]`,
    );
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }, id);
  if (!centre) throw new Error(`no text object ${id} on this screen`);
  await page.mouse.dblclick(centre.x, centre.y);
  await expect(page.locator('[data-testid="text-object-editor"]')).toBeVisible();
}

/** How many objects of any kind this screen has selected. */
export async function selectedCount(page: Page): Promise<number> {
  return page.evaluate(() => document.querySelectorAll('[data-selected="true"]').length);
}

/**
 * Give the keyboard back to the board. A toolbar button that was just clicked keeps
 * the focus, and a focused button is a control rather than the board, so the board's
 * own keys are not read while it holds the focus (NOTES #29).
 */
export const focusBoard = (page: Page): Promise<void> =>
  page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });
