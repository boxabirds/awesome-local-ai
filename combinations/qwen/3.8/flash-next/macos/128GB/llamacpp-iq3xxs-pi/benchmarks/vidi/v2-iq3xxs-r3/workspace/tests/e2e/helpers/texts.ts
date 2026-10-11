/**
 * Story 9's e2e helpers: the Text tool as a person uses it (press T, click the
 * board, type, leave it), and the reading of what a text object became.
 *
 * As everywhere else in the browser suite, mouse points come from real things — a
 * note's box, a handle's box, a slot of empty grid — and what is asserted is read
 * back in *board* units from each object's own data attributes, which is also how
 * a test tells a stored measurement from a browser's opinion of one.
 */
import { expect, type Locator, type Page } from '@playwright/test';

import { E2E_EVENTUAL_TIMEOUT_MS } from '../../../src/shared/config';
import type { TextSize } from '../../../src/shared/config';
import type { Point } from './board';

/** One text object as this screen draws it: box in board units, words as rendered. */
export interface TextView {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly fontPx: number;
  readonly size: TextSize;
  readonly widthMode: string;
  readonly words: string;
  readonly selected: boolean;
  /** Is this the object being typed into right now? */
  readonly editing: boolean;
}

/** The field a text object shows while it is being typed into. */
export const textEditor = (page: Page): Locator => page.getByTestId('text-editor');

/** The words of a text object, as the board renders them (not while typing). */
export const textWords = (page: Page, id: string): Locator =>
  page.locator(`[data-text-id="${id}"] [data-testid="text-content"]`);

/** Every text object this screen is drawing. */
export function texts(page: Page): Promise<TextView[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-text-id]')].map((element) => ({
      id: element.dataset.textId ?? '',
      x: Number(element.dataset.x),
      y: Number(element.dataset.y),
      width: Number(element.dataset.width),
      height: Number(element.dataset.height),
      fontPx: Number.parseFloat(element.style.fontSize),
      size: (element.dataset.size ?? '') as TextSize,
      widthMode: element.dataset.widthMode ?? '',
      words: element.querySelector<HTMLElement>('[data-testid="text-content"]')?.textContent ?? '',
      selected: element.dataset.selected === 'true',
      editing: element.querySelector('[data-testid="text-editor"]') !== null,
    })),
  );
}

/**
 * Wait until this screen draws exactly these words, in any order. The words are
 * what is waited for, not the number of objects: on a board where several people
 * are writing at once, the objects arrive before each other's characters do, and a
 * test that stopped at the count would read a heading before it was finished
 * (`text.consistent`).
 */
export async function expectTextWords(page: Page, wanted: readonly string[]): Promise<TextView[]> {
  const want = [...wanted].sort().join('\n');
  await expect
    .poll(async () => (await texts(page)).map((text) => text.words).sort().join('\n'), {
      message: `this screen never showed ${want.replace(/\n/g, ', ')}`,
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
    })
    .toBe(want);
  return texts(page);
}

/** One text object, by id; a test that asks for a missing one is told so. */
export async function textView(page: Page, id: string): Promise<TextView> {
  const found = (await texts(page)).find((text) => text.id === id);
  if (!found) throw new Error(`text ${id} is not on this screen`);
  return found;
}

/** Wait until this screen draws exactly `count` text objects, and hand them back. */
export async function expectTextCount(page: Page, count: number): Promise<TextView[]> {
  await expect
    .poll(async () => (await texts(page)).length, {
      message: `this screen never showed ${count} text object(s)`,
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
    })
    .toBe(count);
  return texts(page);
}

/**
 * How many lines the board laid the words out into, counted as the browser breaks
 * them: the distinct line rows the text node's rectangles fall on. Fragments are
 * not lines — a line that the browser broke after a space gives a rectangle for
 * the words and a second one for the space it left behind, and counting those
 * would make a wrapped annotation look taller than the box it asked for.
 *
 * This is the difference between a stored height and text a person can read
 * (`text.auto_width`).
 */
export function textLines(page: Page, id: string): Promise<number> {
  return page.evaluate(
    ([textId]) => {
      const layer = document.querySelector(`[data-text-id="${textId}"] [data-testid="text-content"]`);
      const node = layer?.firstChild;
      if (!node) return 0;
      const range = document.createRange();
      range.selectNodeContents(node);
      const rows = new Set([...range.getClientRects()].map((rect) => Math.round(rect.y)));
      return rows.size;
    },
    [id],
  );
}

/**
 * The text object this screen is typing into, or null. The object a heading is
 * made of is named by the field it holds, so a test can pick its own object out of
 * a room where several people are creating headings at the same time.
 */
export function editingTextId(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const field = document.querySelector('[data-testid="text-editor"]');
    const owner = field?.closest('[data-text-id]') as HTMLElement | null;
    return owner?.dataset.textId ?? null;
  });
}

/**
 * Wait for the field to have the caret: the field focuses itself when the object
 * opens it, and a keystroke sent before that lands on the board instead. On a
 * loaded machine, with several screens typing at once, this is the difference
 * between testing a heading and testing nothing.
 */
export async function waitForEditorFocus(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-testid')), {
      message: 'the text field never took the caret',
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
    })
    .toBe('text-editor');
}

/** Press T: the Text tool is held, and the toolbar says so. */
export async function holdTextTool(page: Page): Promise<void> {
  await page.keyboard.press('t');
  await expect(page.getByTestId('tool-text')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('tool-select')).toHaveAttribute('aria-pressed', 'false');
}

/** Press V: back to Select, with nothing written. */
export async function holdSelectTool(page: Page): Promise<void> {
  await page.keyboard.press('v');
  await expect(page.getByTestId('tool-select')).toHaveAttribute('aria-pressed', 'true');
}

/**
 * The way a heading is made: hold Text, click a spot, type, and leave. The tool
 * hands itself back to Select after the click (`text.tool_ui`), so this does not
 * press V, and the object is left selected by the Escape, ready to be sized,
 * moved or deleted.
 *
 * With no words it is the abandoned case — the object the board takes away again
 * (`text.empty`) — and the caller says so by asking for the count to be back down.
 */
export async function makeHeading(page: Page, at: Point, words = ''): Promise<string> {
  await holdTextTool(page);
  await page.mouse.click(at.x, at.y);
  await expect(textEditor(page)).toBeVisible();
  let created: string | null = null;
  await expect
    .poll(async () => (created = await editingTextId(page)), {
      message: 'a click with the Text tool held did not put a text object on the board',
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
    })
    .not.toBeNull();
  if (!created) throw new Error('the new text has no id to be found by');
  await waitForEditorFocus(page);
  // Words go in as one insertion, the way story 2's spec puts a long note's text in
  // (`sticky-notes.spec.ts`). Typing them one character at a time instead would
  // measure the race between a keystroke and the editor's own controlled value —
  // which exists for notes and headings alike, is not story 9's to fix, and would
  // make these tests flaky for a reason that has nothing to do with text objects.
  if (words !== '') await page.keyboard.insertText(words);
  await page.keyboard.press('Escape');
  await expect(textEditor(page)).toHaveCount(0);
  return created;
}

/** A short press on a text object selects it, and only it. */
export async function selectText(page: Page, id: string): Promise<void> {
  const box = await textBox(page, id);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator(`[data-text-id="${id}"]`)).toHaveAttribute('data-selected', 'true');
}

/** A double-click on a text object opens it for typing (`text.object`). */
export async function editText(page: Page, id: string): Promise<void> {
  const box = await textBox(page, id);
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await expect(textEditor(page)).toBeVisible();
  await waitForEditorFocus(page);
}

/** Where a text object is on this screen, which is where a mouse can reach it. */
export async function textBox(
  page: Page,
  id: string,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await page.locator(`[data-text-id="${id}"]`).boundingBox();
  if (!box) throw new Error(`no bounding box for text ${id}`);
  return box;
}

/** One text on the board gets its own toolbar: four sizes and delete. */
export async function expectTextToolbar(page: Page): Promise<void> {
  await expect(page.getByTestId('text-toolbar')).toBeVisible();
  await expect(page.getByTestId('selection-count')).toHaveCount(0);
}

/**
 * A lone text has handles on its two side edges and nowhere else: no top, no
 * bottom, no corner (`text.fixed_width`).
 */
export async function expectSideHandlesOnly(page: Page): Promise<void> {
  const handles = await page.getByTestId(/^handle-/).evaluateAll((elements) =>
    elements.map((element) => (element as HTMLElement).dataset.handle ?? ''),
  );
  expect([...handles].sort()).toEqual(['e', 'w']);
}

/** Pick a size from the toolbar above the selected text (`text.size`). */
export async function chooseTextSize(page: Page, size: TextSize): Promise<void> {
  await page.getByTestId(`text-size-${size}`).click();
  await expect(page.getByTestId(`text-size-${size}`)).toHaveAttribute('aria-pressed', 'true');
}
