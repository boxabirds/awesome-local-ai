import { expect, type Page } from '@playwright/test';
import type { TextSnapshot } from '../../../src/shared/objects/text';

/** What a screen sees, box and all, for every free text on the board. */
export function textSnapshots(page: Page): Promise<readonly TextSnapshot[]> {
  return page.evaluate(() => [...window.__vidi6!.getTexts()]);
}

export async function textById(page: Page, id: string): Promise<TextSnapshot | null> {
  const found = (await textSnapshots(page)).find((t) => t.id === id);
  return found ?? null;
}

/** The newest text this screen has: the one just created. */
export async function newestText(page: Page): Promise<TextSnapshot | null> {
  const all = await textSnapshots(page);
  return all.length > 0 ? all[all.length - 1]! : null;
}

export async function waitForTextCount(page: Page, count: number): Promise<readonly TextSnapshot[]> {
  await expect
    .poll(async () => (await textSnapshots(page)).length, { timeout: 10_000 })
    .toBe(count);
  return textSnapshots(page);
}

export const textLocator = (page: Page, id: string) => page.locator(`[data-text-id="${id}"]`);
export const textInput = (page: Page) => page.getByTestId('text-object-input');

/** Where a text is drawn on the screen, in CSS pixels. */
export async function textBoxOnScreen(
  page: Page,
  id: string,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await textLocator(page, id).boundingBox();
  if (!box) throw new Error(`text ${id} is not on screen`);
  return box;
}

/** The Text tool's whole gesture: press T, click where the top-left should go. */
export async function createTextWithTool(
  page: Page,
  at: { x: number; y: number },
): Promise<string> {
  await page.keyboard.press('t');
  await page.mouse.click(at.x, at.y);
  await expect(textInput(page)).toBeVisible();
  const created = await newestText(page);
  if (!created) throw new Error('the Text tool click created no text');
  return created.id;
}

/** Type with the caret where the board put it, then leave the edit. */
export async function typeIntoEditor(page: Page, text: string): Promise<void> {
  await page.keyboard.type(text);
}

export async function endTextEdit(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(textInput(page)).toHaveCount(0);
}

/** Create a text with content in it, deselected and out of editing. */
export async function seedText(
  page: Page,
  at: { x: number; y: number },
  text: string,
): Promise<string> {
  const id = await createTextWithTool(page, at);
  await typeIntoEditor(page, text);
  await endTextEdit(page);
  await page.mouse.click(6, 6); // drop the selection too
  return id;
}

/** Double-click an existing text to edit it. */
export async function editText(page: Page, id: string): Promise<void> {
  await textLocator(page, id).dblclick();
  await expect(textInput(page)).toBeVisible();
}

/** Press on a text so it becomes the selection (without editing it). */
export async function clickText(page: Page, id: string): Promise<void> {
  const box = await textBoxOnScreen(page, id);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

/** Drag an object by its body, by a screen-pixel offset. */
export async function dragText(
  page: Page,
  id: string,
  dx: number,
  dy: number,
  steps = 10,
): Promise<void> {
  const box = await textBoxOnScreen(page, id);
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps });
  await page.mouse.up();
}

/** Drag the east or west handle by a screen-pixel offset (a text's only handles). */
export async function dragSideHandle(
  page: Page,
  side: 'e' | 'w',
  dx: number,
  steps = 10,
): Promise<void> {
  const handle = page.getByTestId(`handle-${side}`);
  await expect(handle).toBeVisible();
  const box = await handle.boundingBox();
  if (!box) throw new Error(`no ${side} handle on screen`);
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y, { steps });
  await page.mouse.up();
}

/** The size buttons of the text toolbar, in the order a tab reaches them. */
export const sizeButton = (page: Page, size: 'S' | 'M' | 'L' | 'XL') =>
  page.getByRole('button', { name: { S: 'Small (S)', M: 'Medium (M)', L: 'Large (L)', XL: 'Extra large (XL)' }[size] });

/** What the board actually drew: the text and the height of its line box. */
export async function renderedText(page: Page, id: string): Promise<string> {
  const value = await textLocator(page, id).locator('.board-text-content').textContent();
  return value ?? '';
}

export async function renderedTextHeight(page: Page, id: string): Promise<number> {
  const height = await textLocator(page, id).locator('.board-text-content').evaluate((el) => {
    // The line boxes are what wrapping produced; their union is the painted height.
    const range = document.createRange();
    range.selectNodeContents(el);
    const rects = range.getClientRects();
    let top = Infinity;
    let bottom = -Infinity;
    for (const rect of rects) {
      top = Math.min(top, rect.top);
      bottom = Math.max(bottom, rect.bottom);
    }
    return rects.length > 0 ? bottom - top : el.getBoundingClientRect().height;
  });
  return height;
}

/** The lines the browser ended up with, from the caret positions of the content. */
export async function renderedLineCount(page: Page, id: string): Promise<number> {
  const count = await textLocator(page, id)
    .locator('.board-text-content')
    .evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      // One client rect per line box of the wrapped text.
      return range.getClientRects().length;
    });
  return count;
}
