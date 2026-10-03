// Story 9 e2e helpers: the Text tool and free text objects, as a person's screen
// shows them.
//
// Two kinds of read are deliberately kept apart. What is *painted* (lines, boxes,
// selection, the cursor) is read from the DOM and its computed style, because that is
// what the person sees. What is *stored* (width, height, size, widthMode, the text) is
// read from the live shared document through the test-build handle `window.__vidi6Board`
// — the same Y.Doc the sync server is replicating — so a test can tell "the box was
// measured and written" apart from "the box happens to look right on this screen".

import { expect, type Page } from '@playwright/test';
import {
  TEXT_LINE_HEIGHT,
  TEXT_SIZES,
  type TextSize,
} from '../../../src/shared/config';

export function selectToolButton(page: Page) {
  return page.getByTestId('select-tool');
}

export function textToolButton(page: Page) {
  return page.getByTestId('text-tool');
}

/** The open free-text editor (the same component a note uses, its own label). */
export function textEditor(page: Page) {
  return page.getByRole('textbox', { name: 'Text' });
}

export function textSizeButton(page: Page, size: TextSize) {
  return page.getByTestId(`text-size-${size}`);
}

export function textDeleteButton(page: Page) {
  return page.getByTestId('text-delete');
}

export function textObject(page: Page, id: string) {
  return page.getByTestId(`text-object-${id}`);
}

/** Every text object on the screen, in document order. */
export async function textIds(page: Page): Promise<string[]> {
  return page.$$eval('[data-text-object-id]', (els) =>
    els.map((e) => e.getAttribute('data-text-object-id') as string),
  );
}

/** Which tool is held, as the rail declares it. */
export async function toolState(
  page: Page,
): Promise<{ select: boolean; text: boolean; textDisabled: boolean }> {
  return {
    select: (await selectToolButton(page).getAttribute('aria-pressed')) === 'true',
    text: (await textToolButton(page).getAttribute('aria-pressed')) === 'true',
    textDisabled: await textToolButton(page).isDisabled(),
  };
}

/** The cursor the board itself is showing (Text tool ⇒ a text caret). */
export function boardCursor(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.querySelector(
      '[data-testid="board-viewport"]',
    ) as HTMLElement;
    return getComputedStyle(el).cursor;
  });
}

/** Hold the Text tool with its keyboard shortcut and wait for the rail to agree. */
export async function holdTextTool(page: Page): Promise<void> {
  await page.keyboard.press('t');
  await expect(textToolButton(page)).toHaveAttribute('aria-pressed', 'true');
}

/**
 * The id of the text object whose editor this person is typing into, read from the
 * element that holds the focused editor. On a busy board other people's objects arrive
 * while this person is clicking, so this is the only honest way to know which object
 * *this* click made.
 */
export function editingTextId(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const el = document.activeElement;
    const holder = el?.closest('[data-text-object-id]');
    return holder?.getAttribute('data-text-object-id') ?? null;
  });
}

/**
 * The Text tool's whole gesture: hold T, click the board at a screen point, and wait
 * for the new object's editor to be open. Returns the new object's id.
 */
export async function createTextWithTool(
  page: Page,
  x: number,
  y: number,
): Promise<string> {
  await holdTextTool(page);
  await page.mouse.click(x, y);
  await expect(textEditor(page)).toBeVisible();
  const created = await editingTextId(page);
  if (!created) throw new Error('the Text tool click created no text object');
  return created;
}

/** Type into the open editor as a person does, keystroke by keystroke. */
export async function typeIntoTextEditor(page: Page, text: string): Promise<void> {
  await textEditor(page).focus();
  await page.keyboard.type(text, { delay: 8 });
}

/** Stop editing, keeping the object selected (Escape, the editor's own key). */
export async function endTextEdit(page: Page): Promise<void> {
  await textEditor(page).focus();
  await page.keyboard.press('Escape');
  await expect(textEditor(page)).toHaveCount(0);
}

/** Open a text object's editor by double-clicking it where it is painted. */
export async function editText(page: Page, id: string): Promise<void> {
  await textObject(page, id).dblclick();
  await expect(textEditor(page)).toBeVisible();
}

export interface StoredText {
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  size: TextSize;
  widthMode: string;
  text: string;
  createdBy: string;
}

/**
 * The object as it is stored in the shared document — the fields every client reads,
 * including the box somebody measured and wrote. Throws when the object is gone, so a
 * test that expects it to be gone says so on purpose.
 */
export async function storedText(page: Page, id: string): Promise<StoredText> {
  const read = await page.evaluate((oid) => {
    const doc = (window as unknown as { __vidi6Board?: unknown }).__vidi6Board as {
      getMap(name: string): {
        get(id: string):
          | {
              get(key: string): unknown;
            }
          | undefined;
      };
    };
    const obj = doc.getMap('objects').get(oid);
    if (!obj) return null;
    return {
      type: obj.get('type') as string,
      x: obj.get('x') as number,
      y: obj.get('y') as number,
      width: obj.get('width') as number,
      height: obj.get('height') as number,
      z: obj.get('z') as number,
      size: obj.get('size') as TextSize,
      widthMode: obj.get('widthMode') as string,
      text: (obj.get('text') as { toString(): string }).toString(),
      createdBy: obj.get('createdBy') as string,
    };
  }, id);
  if (!read) throw new Error(`text object ${id} is not in the document`);
  return read;
}

/** The stored text of an object, or null when the document no longer has it. */
export async function storedTextOrNull(
  page: Page,
  id: string,
): Promise<string | null> {
  return page.evaluate((oid) => {
    const doc = (window as unknown as { __vidi6Board?: unknown }).__vidi6Board as {
      getMap(name: string): {
        get(id: string): { get(key: string): unknown } | undefined;
      };
    };
    const obj = doc.getMap('objects').get(oid);
    if (!obj) return null;
    return (obj.get('text') as { toString(): string }).toString();
  }, id);
}

/**
 * How many lines of text this person's screen actually shows. A pre-wrap block paints
 * one *line box* per wrapped line, and the browser's client rects are per text run
 * inside those boxes — a wrapped line whose trailing space hangs at the margin gives
 * two rects, for instance — so the honest count of painted lines is the number of
 * distinct tops among the non-empty rects.
 */
export async function paintedLineCount(page: Page, id: string): Promise<number> {
  return page.evaluate((oid) => {
    const el = document.querySelector(`[data-testid="text-content-${oid}"]`);
    if (!el) throw new Error(`text object ${oid} is not on screen`);
    const range = document.createRange();
    range.selectNodeContents(el);
    const tops = new Set<number>();
    for (const rect of Array.from(range.getClientRects())) {
      if (rect.width > 0.5) tops.add(Math.round(rect.top));
    }
    return tops.size;
  }, id);
}

/** The painted box of a text object, in client pixels. */
export async function textScreenBox(
  page: Page,
  id: string,
): Promise<{ x: number; y: number; w: number; h: number }> {
  const box = await textObject(page, id).boundingBox();
  if (!box) throw new Error(`text object ${id} has no box on screen`);
  return { x: box.x, y: box.y, w: box.width, h: box.height };
}

/** Is this text object painted as selected? */
export async function textSelected(page: Page, id: string): Promise<boolean> {
  return page.evaluate(
    (oid) =>
      document
        .querySelector(`[data-text-object-id="${oid}"]`)
        ?.getAttribute('data-selected') === 'true',
    id,
  );
}

/** Which text objects are painted as selected. */
export async function selectedTextIds(page: Page): Promise<string[]> {
  return page.$$eval(
    '[data-text-object-id][data-selected="true"]',
    (els) => els.map((e) => e.getAttribute('data-text-object-id') as string),
  );
}

/** The font size the text is painted at, in CSS pixels. */
export function paintedFontSize(page: Page, id: string): Promise<number> {
  return page.evaluate((oid) => {
    const el = document.querySelector(
      `[data-testid="text-content-${oid}"]`,
    ) as HTMLElement;
    return parseFloat(getComputedStyle(el).fontSize);
  }, id);
}

/** The height one line of `size` occupies: the unit every stored height is a multiple of. */
export function lineHeightOf(size: TextSize): number {
  return TEXT_SIZES[size] * TEXT_LINE_HEIGHT;
}

/** Select the object and pick a size preset from the bar above it. */
export async function textSizePreset(page: Page, size: TextSize): Promise<void> {
  await expect(textSizeButton(page, size)).toBeVisible();
  await textSizeButton(page, size).click();
}

/** Click the board with the Select tool: what it does depends on the tool. */
export async function clickBoard(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.click(x, y);
}
