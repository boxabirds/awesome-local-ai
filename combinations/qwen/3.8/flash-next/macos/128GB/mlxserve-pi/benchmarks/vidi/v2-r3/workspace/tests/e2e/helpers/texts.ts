// Story 9 e2e helpers: free text objects, the Text tool, and the waits that
// live collaboration needs (the collaboration ones are story 3's, re-exported
// by the spec that uses them rather than doubled here).
//
// Everything a test wants to know about a text object it reads from the object
// itself: the box it was given is drawn from the model, so the element's own
// inline width and height are its stored box in world units, and its size, its
// width mode and how much text it holds are drawn next to them. That is
// deliberate — the object is what a person sees, and a box that only the
// document had, and the element did not, would be a box nobody is looking at.
import { expect, type Page } from '@playwright/test';
import { TEXT_LINE_HEIGHT, TEXT_SIZES, type TextSize } from '../../../src/shared/config';
import { settle, type ScreenPoint } from './board';

export const textButton = (page: Page) => page.getByRole('button', { name: 'Text (T)', exact: true });

export const textLocator = (page: Page, id: string) => page.locator(`[data-text-id="${id}"]`);

/** The object's own displayed text (the display layer, not the textarea). */
export const textDisplay = (page: Page, id: string) =>
  textLocator(page, id).getByTestId('text-display');

/** The open editor. There is at most one on a screen, because a person edits one object at a time. */
export const textEditor = (page: Page) => page.getByTestId('text-editor');

export const textToolbar = (page: Page) => page.getByRole('toolbar', { name: 'Text toolbar' });

export const selectionOverlay = (page: Page) => page.getByTestId('selection-overlay');

const SIZE_LABEL: Record<TextSize, string> = {
  S: 'Small text',
  M: 'Medium text',
  L: 'Large text',
  XL: 'Extra large text',
};

export const sizeButton = (page: Page, size: TextSize) =>
  page.getByRole('button', { name: SIZE_LABEL[size], exact: true });

export const widthModeButton = (page: Page) => page.getByRole('button', { name: 'Fixed width' });

export const deleteTextButton = (page: Page) => page.getByRole('button', { name: 'Delete text' });

export function handle(page: Page, side: 'w' | 'e' | 'n' | 's' | 'nw' | 'ne' | 'sw' | 'se') {
  return selectionOverlay(page).getByTestId(`resize-handle-${side}`);
}

/** Ids of the rendered text objects, in stacking order (bottom first). */
export function textIds(page: Page): Promise<string[]> {
  return page.$$eval('[data-text-id]', (els) =>
    els.filter((el) => !el.classList.contains('text-editor')).map((el) => el.getAttribute('data-text-id')!),
  );
}

export function textCount(page: Page): Promise<number> {
  return page.$$eval('[data-text-id]', (els) => els.length);
}

export interface TextAttrs {
  /** Its box, in world units, as the document holds it and the page draws it. */
  width: number;
  /** The height the box is stored with, which is a minimum: see `drawnHeight`. */
  height: number;
  /** How much room the words actually took on this screen, in world units. */
  drawnHeight: number;
  size: string;
  mode: string;
  fontSize: string;
  font: string;
  text: string;
}

/**
 * What this screen draws for one text object. The width and the stored height are
 * read off the element, which is the only way to test that the box in the document
 * is the box a person is shown. The height is a minimum rather than a clip: the
 * text is the source of truth, so if the browser's own font takes one line more
 * than the measurement counted, the words are all shown and `drawnHeight` says how
 * much room that was.
 */
export function textAttrs(page: Page, id: string): Promise<TextAttrs> {
  return textLocator(page, id).evaluate((el) => {
    const object = el as HTMLElement;
    const display = object.querySelector('[data-testid="text-display"]');
    const zoom = window.__vidi6?.getCamera().zoom ?? 1;
    return {
      width: Number.parseFloat(object.style.width),
      height: Number.parseFloat(object.style.minHeight),
      drawnHeight: Number.parseFloat(object.style.minHeight) === 0
        ? 0
        : object.getBoundingClientRect().height / zoom,
      size: object.dataset.size ?? '',
      mode: object.dataset.mode ?? '',
      fontSize: object.style.fontSize,
      font: getComputedStyle(object).fontFamily,
      text: display?.textContent ?? '',
    };
  });
}

/**
 * How many lines this screen draws the text in, counted from the rendered line
 * boxes. This is the question the wrapping cases are about, and it can only be
 * answered by the browser that is doing the wrapping.
 */
export function renderedLines(page: Page, id: string): Promise<number> {
  return textLocator(page, id).evaluate((el) => {
    const display = el.querySelector('[data-testid="text-display"]');
    if (display === null) return 0;
    const range = document.createRange();
    range.selectNodeContents(display);
    const top = display.getBoundingClientRect().top;
    const tops = new Set<number>();
    for (const rect of Array.from(range.getClientRects())) {
      if (rect.height <= 0 || rect.width <= 0) continue;
      // Lines of the same top are the same line, wherever the browser put it.
      tops.add(Math.round(rect.top - top));
    }
    return tops.size;
  });
}

/** The text objects on this screen, as one comparable string per object. */
export function textStates(page: Page): Promise<string[]> {
  return page.$$eval('[data-text-id]', (els) =>
    els
      .filter((el) => !el.classList.contains('text-editor'))
      .map((el) => {
        const object = el as HTMLElement;
        const display = object.querySelector('[data-testid="text-display"]');
        return [
          object.style.width,
          object.style.minHeight,
          object.dataset.size,
          object.dataset.mode,
          display?.textContent ?? '',
        ].join('|');
      })
      .sort(),
  );
}

/** Arm the Text tool. */
export async function armTextTool(page: Page): Promise<void> {
  await textButton(page).click();
  await expect(textButton(page)).toHaveAttribute('aria-pressed', 'true');
}

/**
 * Put a text object at a screen point the way a person does: the Text tool, a
 * click, and the caret waiting in the empty space.
 */
export async function placeText(page: Page, at: ScreenPoint): Promise<string> {
  await armTextTool(page);
  const before = await textIds(page);
  await page.mouse.click(at.x, at.y);
  await expect(textEditor(page)).toHaveCount(1);
  const made = (await textIds(page)).filter((id) => !before.includes(id));
  if (made.length !== 1) {
    throw new Error(`expected the click to make one text object, saw ${made.length}`);
  }
  return made[0]!;
}

/** Type into the open editor with real keystrokes. */
export async function typeText(page: Page, text: string): Promise<void> {
  await page.keyboard.type(text, { delay: 5 });
}

/** Stop editing, leaving the object where it is and selected. */
export async function stopEditing(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(textEditor(page)).toHaveCount(0);
}

/**
 * Drag a resize handle by (dx, dy) screen pixels. The overlay holds the pointer
 * for the whole gesture, so the mouse does not have to find anything else.
 */
export async function dragHandleBy(
  page: Page,
  side: 'w' | 'e' | 'n' | 's' | 'nw' | 'ne' | 'sw' | 'se',
  dx: number,
  dy: number,
): Promise<void> {
  const box = await handle(page, side).boundingBox();
  if (box === null) throw new Error(`handle ${side} is not on screen`);
  const viewport = page.viewportSize();
  if (
    viewport !== null &&
    (box.x < 0 ||
      box.y < 0 ||
      box.x + box.width > viewport.width ||
      box.y + box.height > viewport.height)
  ) {
    // A drag that starts off the window reaches no page at all, and looks exactly
    // like a resize that was refused; say what it is instead.
    throw new Error(
      `handle ${side} is off the screen at ${Math.round(box.x)},${Math.round(box.y)} ` +
        `of ${viewport.width}x${viewport.height}: the object was placed too near the edge`,
    );
  }
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 8 });
  await page.mouse.up();
  await settle(page);
}

/** Drag an object itself by (dx, dy) screen pixels. */
export async function dragObjectBy(page: Page, id: string, dx: number, dy: number): Promise<void> {
  const box = await textLocator(page, id).boundingBox();
  if (box === null) throw new Error(`text ${id} is not on screen`);
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 8 });
  await page.mouse.up();
  await settle(page);
}

/** Open an existing object for editing, by double-clicking it. */
export async function editText(page: Page, id: string): Promise<void> {
  await textLocator(page, id).dblclick();
  await expect(textEditor(page)).toHaveCount(1);
}

/** Select an object with a single click, with the select tool. */
export async function clickText(page: Page, id: string): Promise<void> {
  await textLocator(page, id).click();
  await expect(textToolbar(page)).toHaveCount(1);
}

/** The height one line of a given size is drawn at, on this screen. */
export function oneLineHeight(size: TextSize): number {
  return TEXT_SIZES[size] * TEXT_LINE_HEIGHT;
}
