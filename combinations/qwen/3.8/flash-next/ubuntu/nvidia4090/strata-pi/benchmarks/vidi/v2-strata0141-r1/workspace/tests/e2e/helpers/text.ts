import { expect, type Page } from '@playwright/test';
import type { TextSnapshot } from '../../../src/shared/objects/text';
import { TEXT_LINE_HEIGHT, TEXT_SIZES, type TextSize } from '../../../src/shared/config';
import type { ScreenPoint } from './board';

export interface TextBox extends ScreenPoint {
  width: number;
  height: number;
}

interface BoardHooks {
  texts(): TextSnapshot[];
  createText(params: { at: ScreenPoint; text?: string; size?: TextSize }): string;
}

/** Read the live text objects through the test-only hooks (test build only). */
export async function getTexts(page: Page): Promise<TextSnapshot[]> {
  return page.evaluate(() => {
    const api = (window as unknown as { __vidi6?: BoardHooks }).__vidi6;
    if (!api) {
      throw new Error('test hooks are not installed');
    }
    return api.texts();
  });
}

/** Put a text object on the board through the model (test setup only). */
export async function createTextOnBoard(
  page: Page,
  at: ScreenPoint,
  options: { text?: string; size?: TextSize } = {},
): Promise<string> {
  const id = await page.evaluate(
    (args) => {
      const api = (window as unknown as { __vidi6?: BoardHooks }).__vidi6;
      if (!api) {
        throw new Error('test hooks are not installed');
      }
      return api.createText({ at: { x: args.x, y: args.y }, text: args.text, size: args.size });
    },
    { x: at.x, y: at.y, text: options.text, size: options.size },
  );
  await page.waitForTimeout(60);
  return id;
}

export function textCard(page: Page, id: string) {
  return page.locator(`[data-testid="text-object-${id}"]`);
}

/** The text as it is drawn, which is what a person reads. */
export function textContent(page: Page, id: string) {
  return page.locator(`[data-testid="text-content-${id}"]`);
}

export async function textBox(page: Page, id: string): Promise<TextBox> {
  const box = await textCard(page, id).boundingBox();
  if (!box) {
    throw new Error(`text object ${id} has no bounding box (is it on screen?)`);
  }
  return { x: box.x, y: box.y, width: box.width, height: box.height };
}

export async function textCentre(page: Page, id: string): Promise<ScreenPoint> {
  const box = await textBox(page, id);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export async function textAttribute(
  page: Page,
  id: string,
  name: string,
): Promise<string | null> {
  return textCard(page, id).getAttribute(name);
}

export async function textOf(page: Page, id: string): Promise<TextSnapshot> {
  const texts = await getTexts(page);
  const found = texts.find((entry) => entry.id === id);
  if (!found) {
    throw new Error(`text object ${id} is not on the board`);
  }
  return found;
}

/** Wait until the board holds exactly `count` text objects. */
export async function waitForTextCount(page: Page, count: number): Promise<readonly TextSnapshot[]> {
  await expect
    .poll(async () => (await getTexts(page)).length, {
      timeout: 15_000,
      message: `the board never showed ${count} text objects`,
    })
    .toBe(count);
  return getTexts(page);
}

/** Wait until a text object with this id exists (true) or is gone (false). */
export async function waitForText(page: Page, id: string, present = true): Promise<void> {
  await expect
    .poll(
      async () => (await getTexts(page)).some((entry) => entry.id === id) === present,
      { timeout: 15_000, message: `text ${id} never became ${present ? 'visible' : 'gone'}` },
    )
    .toBe(true);
}

/**
 * Wait until every page holds exactly the same text objects, and return them.
 *
 * This is what "the same text" means for a test: not what one screen wrote, but what
 * every screen agrees on. It polls rather than samples once, because updates arrive
 * one character at a time and a screen that is mid-delivery is not a disagreement -
 * it is a moment later.
 */
export async function waitForSameTexts(
  pages: readonly Page[],
): Promise<readonly TextSnapshot[]> {
  const asData = (texts: readonly TextSnapshot[]): string =>
    JSON.stringify(
      texts.map((entry) => ({
        id: entry.id,
        text: entry.text,
        x: entry.x,
        y: entry.y,
        width: entry.width,
        height: entry.height,
        size: entry.size,
        widthMode: entry.widthMode,
        z: entry.z,
      })),
    );
  let first = '[]';
  await expect
    .poll(
      async () => {
        const all = await Promise.all(pages.map(async (page) => asData(await getTexts(page))));
        first = all[0] ?? '[]';
        return all.every((list) => list === first);
      },
      { timeout: 15_000, message: 'the boards never became identical' },
    )
    .toBe(true);
  return getTexts(pages[0] as Page);
}

/** The Text tool, held by its shortcut (the shortcut is the product's own). */
export async function pressTextTool(page: Page): Promise<void> {
  await page.keyboard.press('t');
  await page.waitForTimeout(40);
  await expect(page.locator('[data-testid="board"]')).toHaveAttribute('data-tool', 'text');
}

export async function clickTextToolButton(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Text (T)' }).click();
  await page.waitForTimeout(40);
}

/**
 * The product's way of making text: hold Text, click where the top-left should be,
 * and type. The editor is open afterwards unless the caller closes it.
 */
export async function writeTextWithTool(
  page: Page,
  at: ScreenPoint,
  text = '',
): Promise<string> {
  await pressTextTool(page);
  await page.mouse.click(at.x, at.y);
  await page.waitForSelector('[data-testid="text-editor"]');
  // The board says which object this screen is editing, which is the only reliable
  // way to name the new one on a board where other people are writing at the same
  // time (`text.concurrent`).
  const id = await editingTextId(page);
  if (id === '') {
    throw new Error('the Text tool click did not start editing a text object');
  }
  if (text.length > 0) {
    await page.keyboard.type(text);
    await page.waitForTimeout(60);
  }
  return id;
}

/** The text object this screen is editing, from the board's own state. */
export async function editingTextId(page: Page): Promise<string> {
  return page.evaluate(() =>
    document.querySelector('[data-app="vidi6"]')?.getAttribute('data-editing-id') ?? '',
  );
}

/** The text objects this screen is drawing, by id. */
export async function drawnTextIds(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-testid^="text-object-"]')).map(
      (card) => card.getAttribute('data-testid')?.replace('text-object-', '') ?? '',
    ),
  );
}

export async function clickTextSize(page: Page, size: TextSize): Promise<void> {
  await page.getByTestId(`text-size-${size}`).click();
  await page.waitForTimeout(60);
}

export async function clickDeleteText(page: Page): Promise<void> {
  await page.getByTestId('delete-text').click();
  await page.waitForTimeout(60);
}

/** The size pressed in the text toolbar. */
export async function pressedTextSizes(page: Page): Promise<{ size: TextSize; pressed: boolean }[]> {
  const sizes: TextSize[] = ['S', 'M', 'L', 'XL'];
  const out: { size: TextSize; pressed: boolean }[] = [];
  for (const size of sizes) {
    out.push({
      size,
      pressed: (await page.getByTestId(`text-size-${size}`).getAttribute('aria-pressed')) === 'true',
    });
  }
  return out;
}

/** The testids of the selection's resize handles, e.g. ["e", "w"]. */
export async function selectionHandles(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-testid^="resize-handle-"]')).map(
      (handle) => handle.getAttribute('data-testid')?.replace('resize-handle-', '') ?? '',
    ),
  );
}

/** Drag a text object from its drawn centre by (dx, dy) screen pixels. */
export async function dragTextBy(
  page: Page,
  id: string,
  dx: number,
  dy: number,
): Promise<ScreenPoint> {
  const grab = await textCentre(page, id);
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x + dx / 2, grab.y + dy / 2, { steps: 8 });
  await page.mouse.move(grab.x + dx, grab.y + dy, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(80);
  return grab;
}

/**
 * How many lines the browser actually drew, from the drawn text's own box and its
 * computed line height - the rendered answer, not the stored one.
 */
export async function renderedLineCount(page: Page, id: string): Promise<number> {
  return textContent(page, id).evaluate((el) => {
    const style = getComputedStyle(el as HTMLElement);
    const lineHeight =
      parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.3 || 1;
    const height = (el as HTMLElement).getBoundingClientRect().height;
    return Math.max(1, Math.round(height / lineHeight));
  });
}

/** The height one line of `size` takes in board units. */
export const lineHeightOf = (size: TextSize): number => TEXT_SIZES[size] * TEXT_LINE_HEIGHT;
