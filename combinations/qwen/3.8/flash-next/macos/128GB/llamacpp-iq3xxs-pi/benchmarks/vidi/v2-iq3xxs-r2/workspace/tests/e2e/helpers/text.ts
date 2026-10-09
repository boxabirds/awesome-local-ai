import { expect, type Page } from '@playwright/test';
import { TEXT_SIZES, type TextSize } from '../../../src/shared/config';
import { settle } from './board';
import { clickSpot, EMPTY_SPOT, markerOf } from './selection';
import type { Participant } from './participants';

/**
 * Reading and driving free text (story 9) in a real browser: the Text tool, text objects as
 * the document holds them, their size buttons, their handles, and the editor.
 *
 * A text object is read out of the document rather than the DOM wherever a number matters —
 * its width, its height, its width mode — because the document is what the other browsers on
 * the board would see, and what the client measured with its own fonts. Where the test is
 * about what is painted (how many lines the words wrapped into), it asks the painted element.
 */

export interface Point {
  x: number;
  y: number;
}

/** One text object as its board document holds it. */
export interface TextRecord {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly width: number;
  readonly height: number;
  readonly size: TextSize;
  readonly widthMode: string;
  readonly text: string;
}

/* ------------------------------------------------------------------ reading */

/** Every text object on the board, sorted by (z, id). */
export async function texts(page: Page): Promise<TextRecord[]> {
  const rows = await page.evaluate(() => {
    const doc = window.__vidi6?.boardDoc?.();
    if (!doc) throw new Error('test hook window.__vidi6.boardDoc() is missing');
    const objects = doc.getMap('objects').toJSON() as Record<string, Record<string, unknown>>;
    return Object.entries(objects)
      .filter(([, value]) => value.type === 'text')
      .map(([id, value]) => ({
        id,
        x: Number(value.x),
        y: Number(value.y),
        z: Number(value.z),
        width: Number(value.width),
        height: Number(value.height),
        size: value.size as TextSize,
        widthMode: String(value.widthMode),
        text: String(value.text),
      }));
  });
  return rows.sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : 1));
}

export async function textOf(page: Page, id: string): Promise<TextRecord> {
  const found = (await texts(page)).find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no text object ${id} in the document`);
  return found;
}

export async function waitForTextCount(page: Page, count: number): Promise<TextRecord[]> {
  await expect
    .poll(async () => (await texts(page)).length, { timeout: 10_000, message: `${count} texts` })
    .toBe(count);
  return texts(page);
}

/** Which tool this browser is holding, as its toolbar says. */
export async function activeTool(page: Page): Promise<'select' | 'text'> {
  if (await page.locator('[data-testid="tool-text"][aria-pressed="true"]').count()) return 'text';
  if (await page.locator('[data-testid="tool-select"][aria-pressed="true"]').count()) return 'select';
  throw new Error('no tool button says it is pressed');
}

/** What the board drew for a text object: its box, its size, and its state. */
export async function textElement(page: Page, id: string): Promise<{
  editing: boolean;
  selected: boolean;
  dragging: boolean;
  size: TextSize;
  widthMode: string;
  width: number;
  height: number;
  fontPx: number;
}> {
  return page.evaluate((noteId) => {
    const element = document.querySelector<HTMLElement>(`[data-note-id="${noteId}"]`);
    if (!element) throw new Error(`no element for text object ${noteId}`);
    return {
      editing: element.dataset.editing === 'true',
      selected: element.dataset.selected === 'true',
      dragging: element.dataset.dragging === 'true',
      size: element.dataset.textSize as TextSize,
      widthMode: String(element.dataset.textWidthMode),
      width: Number(element.dataset.noteWidth),
      height: Number(element.dataset.noteHeight),
      fontPx: Number.parseFloat(window.getComputedStyle(element).fontSize),
    };
  }, id);
}

/**
 * How many lines the text is wrapped into on this screen, counted from the line boxes the
 * browser made — the honest measure, since a text's height is its content.
 */
export async function renderedLines(page: Page, id: string): Promise<number> {
  return page.evaluate((noteId) => {
    const content = document
      .querySelector<HTMLElement>(`[data-note-id="${noteId}"]`)
      ?.querySelector<HTMLElement>('[data-testid="text-content"]');
    if (!content) throw new Error(`no rendered text for ${noteId}`);
    const range = document.createRange();
    range.selectNodeContents(content);
    const rects = range.getClientRects();
    return rects.length > 0 ? rects.length : 1;
  }, id);
}

/** The handles the selection drew, left to right in the order the overlay lists them. */
export async function handleNames(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-handle]')].map(
      (element) => element.dataset.handle ?? '',
    ),
  );
}

export async function pressedSizeButtons(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-testid="text-sizes"] button')]
      .filter((button) => button.getAttribute('aria-pressed') === 'true')
      .map((button) => button.dataset.size ?? ''),
  );
}

/* ----------------------------------------------------------------- driving */

/** `t`, and wait until the toolbar agrees the Text tool is up. */
export async function pressTextTool(page: Page): Promise<void> {
  await page.keyboard.press('t');
  await expect
    .poll(() => activeTool(page), { timeout: 10_000, message: 'the Text tool' })
    .toBe('text');
}

/**
 * The id of the text object this screen is typing into.
 *
 * Asked of the screen rather than of the document, because on a board several people are
 * working on, the newest text in the document may be somebody else's.
 */
export async function editingTextId(page: Page): Promise<string> {
  let id = '';
  await expect
    .poll(
      async () => {
        id = await page.evaluate(() => {
          const editor = document.querySelector<HTMLElement>('[data-testid="text-editor"]');
          return editor?.closest<HTMLElement>('[data-note-id]')?.dataset.noteId ?? '';
        });
        return id;
      },
      { timeout: 10_000, message: 'a text object is being edited on this screen' },
    )
    .not.toBe('');
  return id;
}

/** The Text tool and a click on empty board: a text object is made there and typed into. */
export async function createTextOnBoardAt(page: Page, at: Point): Promise<string> {
  await pressTextTool(page);
  const before = (await texts(page)).length;
  await clickSpot(page, at);
  await expect
    .poll(async () => (await texts(page)).length, {
      timeout: 10_000,
      message: `a new text object at ${Math.round(at.x)},${Math.round(at.y)}`,
    })
    .toBeGreaterThan(before);
  return editingTextId(page);
}

/** Escape out of the text object's editor, however empty it is. */
export async function endTextEdit(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="text-editor"]')).toHaveCount(0);
  await settle(page);
}

/** Double-click the text object to edit it again. */
export async function startTextEdit(page: Page, id: string): Promise<void> {
  const at = await markerOf(page, id);
  await page.mouse.dblclick(Math.round(at.x), Math.round(at.y));
  await expect(page.locator('[data-testid="text-editor"]')).toHaveCount(1);
}

/** Click one of the size buttons in the selection bar. */
export async function clickTextSize(page: Page, size: TextSize): Promise<void> {
  const label = `${SIZE_LABELS[size]} text`;
  await page.locator(`button[aria-label="${label}"]`).click();
  await expect
    .poll(() => pressedSizeButtons(page), { timeout: 10_000, message: `${size} pressed` })
    .toEqual([size]);
  await settle(page);
}

const SIZE_LABELS: Record<TextSize, string> = {
  S: 'Small',
  M: 'Medium',
  L: 'Large',
  XL: 'Extra large',
};

/** The font size the settings define for a size key, in board units. */
export function fontOf(size: TextSize): number {
  return TEXT_SIZES[size];
}

/** Click the selection bar's Delete. */
export async function deleteSelection(page: Page): Promise<void> {
  await page.locator('button[aria-label="Delete selection"]').click();
  await settle(page);
}

/** Click somewhere empty, e.g. to end an edit. */
export async function clickAway(page: Page): Promise<void> {
  await clickSpot(page, EMPTY_SPOT);
}

/* ---------------------------------------------------------- participants */

/** A person making a text object on their own screen, at a spot on the board. */
export async function createTextAt(person: Participant, at: Point): Promise<string> {
  return createTextOnBoardAt(person.page, at);
}
