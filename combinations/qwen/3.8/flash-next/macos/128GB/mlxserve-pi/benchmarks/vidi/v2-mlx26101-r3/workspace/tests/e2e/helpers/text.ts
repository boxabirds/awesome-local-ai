/// <reference path="../../../src/client/testHooks.ts" />
import { expect, type Locator, type Page } from '@playwright/test';
import type { Point } from '../../../src/client/canvas/camera';
import { TEXT_LINE_HEIGHT, TEXT_SIZES, type TextSize } from '../../../src/shared/config';
import { board, settle, VIEWPORT } from './board';
import { screenOf, placeOf, centreOnScreen, resizeHandles, outlines } from './selection';
import type { Person } from './participants';

/**
 * Free text (story 9), seen from outside a real browser.
 *
 * A text object is the first thing on this board whose *size* is not a fact but a result: it is the
 * size of the words it holds, measured with real fonts on the machine doing the looking. That rules
 * out everything a jsdom test can check and is the reason this file exists - in jsdom there is no
 * canvas to measure with, so the widths a component test asserts are counts of characters dressed up
 * as millimetres. Here they are measurements, which is why almost every number in the tests that use
 * these helpers is compared within a tolerance rather than to the last digit.
 *
 * Two readings of the same object are available and they answer different questions. `placeOf` reads
 * the box as it is *drawn*; `measured` reads the numbers the object *stores* (`data-width`,
 * `data-height`, `data-text-size`), which is the document's own claim about the measurement and the
 * one that travels between screens. `linesOf` asks the browser how many lines it actually laid the
 * words out into, which is the only way to catch a box that is the right size for the wrong number of
 * lines.
 */

/* ------------------------------------------------------------------- what is on the screen */

export const textElements = (page: Page): Locator => page.locator('[data-text-object]');
export const textElement = (page: Page, id: string): Locator =>
  page.locator(`[data-text-object][data-object-id="${id}"]`);
/** The words as they are drawn, or the field they are being typed in when somebody is typing. */
export const drawnText = (page: Page, id: string): Locator =>
  textElement(page, id).getByTestId('text-object-text');

export const textEditor = (page: Page): Locator => page.getByTestId('text-editor');
export const textToolbar = (page: Page): Locator => page.getByTestId('text-toolbar');
export const textToolButton = (page: Page): Locator => page.getByTestId('tool-text');
export const selectToolButton = (page: Page): Locator => page.getByTestId('tool-select');
export const createStickyButton = (page: Page): Locator => page.getByTestId('create-sticky');

/** The four sizes as the bar labels them, which is how a person finds them. */
const LABELS: Record<TextSize, string> = {
  S: 'Small (S)',
  M: 'Medium (M)',
  L: 'Large (L)',
  XL: 'Extra large (XL)',
};

export const sizeButton = (page: Page, size: TextSize): Locator =>
  textToolbar(page).getByRole('button', { name: LABELS[size] });
export const deleteTextButton = (page: Page): Locator =>
  page.getByRole('button', { name: 'Delete text' });

/** The tool that is up, read off the board surface the pointer moves over. */
export async function toolUp(page: Page): Promise<string> {
  return (await board(page).getAttribute('data-tool')) ?? '';
}

/** Wait for the board to be in this tool - the shortcut worked, or the button did. */
export async function expectTool(page: Page, tool: 'select' | 'text'): Promise<void> {
  await expect(board(page), `the board should be in the ${tool} tool`).toHaveAttribute(
    'data-tool',
    tool,
    { timeout: 5_000 },
  );
}

/** T, or the button in the toolbar: whichever a person uses, the board ends up wanting to write. */
export async function chooseTextTool(page: Page): Promise<void> {
  await page.keyboard.press('KeyT');
  await expectTool(page, 'text');
}

/** And back to the ordinary way of using the board. */
export async function chooseSelectTool(page: Page): Promise<void> {
  await page.keyboard.press('KeyV');
  await expectTool(page, 'select');
}

/* ------------------------------------------------------------------- what the object holds */

export interface TextFace {
  /** World units, as the document holds them. */
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  size: TextSize;
  widthMode: string;
  selected: boolean;
  /** The words, whether they are being typed or lying there. */
  text: string;
}

/** One text object as it reports itself, in world units. */
export async function measured(page: Page, id: string): Promise<TextFace> {
  const read = await textElement(page, id).evaluate((element) => ({
    x: Number.parseFloat(element.getAttribute('data-x') ?? ''),
    y: Number.parseFloat(element.getAttribute('data-y') ?? ''),
    width: Number.parseFloat(element.getAttribute('data-width') ?? ''),
    height: Number.parseFloat(element.getAttribute('data-height') ?? ''),
    z: Number.parseFloat(element.getAttribute('data-z') ?? ''),
    size: element.getAttribute('data-text-size') ?? '',
    widthMode: element.getAttribute('data-width-mode') ?? '',
    selected: element.getAttribute('data-selected') === 'true',
    typing: element.querySelector('[data-testid="text-editor"]') !== null,
    field: element.querySelector<HTMLTextAreaElement>('[data-testid="text-editor"]')?.value ?? '',
    drawn: element.querySelector('[data-testid="text-object-text"]')?.textContent ?? '',
  }));
  if (Number.isNaN(read.width) || Number.isNaN(read.height)) {
    throw new Error(`text object ${id} does not report its own box: ${JSON.stringify(read)}`);
  }
  return {
    x: read.x,
    y: read.y,
    width: read.width,
    height: read.height,
    z: read.z,
    size: read.size as TextSize,
    widthMode: read.widthMode,
    selected: read.selected,
    text: read.typing ? read.field : read.drawn,
  };
}

/** Every text object on the page, in id order, as one comparable string. */
export async function textFacesJson(page: Page): Promise<string> {
  const ids = await textIds(page);
  const faces = await Promise.all(ids.map(async (id) => await measured(page, id)));
  return JSON.stringify(
    faces
      .map(({ x, y, width, height, size, widthMode, text }) => ({ x, y, width, height, size, widthMode, text }))
      .sort((a, b) => a.text.localeCompare(b.text)),
  );
}

/** The ids of the text objects on the page. */
export function textIds(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-text-object]')].map(
      (element) => element.getAttribute('data-object-id') ?? '',
    ),
  );
}

/** Wait for the page to be holding `count` text objects, and give their ids back. */
export async function waitForTextCount(page: Page, count: number): Promise<string[]> {
  await expect
    .poll(() => textIds(page).then((seen) => seen.length), { timeout: 5_000 })
    .toBe(count);
  return textIds(page);
}

/**
 * Wait until every page is drawing the same text objects, and hand back what they all show.
 *
 * The box is left out of the comparison at the tolerance level: two machines running the same words
 * through the same font can land a pixel apart, and a test that failed over one pixel of hinting
 * would be a test about hinting. `within` widens it deliberately for the tests where that is the
 * whole point (concurrent typing, where the boxes are being written by five different clients).
 */
export async function waitForSameText(
  people: readonly Person[],
  within = 0,
): Promise<string> {
  const rounded = async (person: Person): Promise<string> => {
    const raw = await person.page.evaluate(() =>
      [...document.querySelectorAll('[data-text-object]')].map((element) => ({
        id: element.getAttribute('data-object-id') ?? '',
        x: Number.parseFloat(element.getAttribute('data-x') ?? ''),
        y: Number.parseFloat(element.getAttribute('data-y') ?? ''),
        width: Number.parseFloat(element.getAttribute('data-width') ?? ''),
        height: Number.parseFloat(element.getAttribute('data-height') ?? ''),
        size: element.getAttribute('data-text-size') ?? '',
        mode: element.getAttribute('data-width-mode') ?? '',
        words:
          element.querySelector<HTMLTextAreaElement>('[data-testid="text-editor"]')?.value ??
          element.querySelector('[data-testid="text-object-text"]')?.textContent ??
          '',
      })),
    );
    return JSON.stringify(
      raw
        .map((face) => ({
          ...face,
          x: Math.round(face.x / within),
          y: Math.round(face.y / within),
          width: Math.round(face.width / within),
          height: Math.round(face.height / within),
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    );
  };
  await expect
    .poll(async () => new Set(await Promise.all(people.map(rounded))).size, {
      timeout: 10_000,
      intervals: [25, 50, 100],
      message: 'every screen should end up showing the same words in the same boxes',
    })
    .toBe(1);
  return rounded(people[0]!);
}

/** The words in a text object, as its own page shows them. */
export const wordsOf = (page: Page, id: string): Promise<string> =>
  measured(page, id).then((face) => face.text);

/* ------------------------------------------------------------------------- putting one down */

/**
 * The id of the text object this page is typing into.
 *
 * Taken from the field rather than from the click, because the click only says where the pointer was:
 * on a board other people are working on, the object that appeared there may be anybody's, while the
 * field is the one this page has the keyboard in.
 */
export async function editingTextId(page: Page): Promise<string> {
  const id = await page.evaluate(() => {
    const field = document.querySelector('[data-testid="text-editor"]');
    const object = field === null ? null : field.closest('[data-text-object]');
    return object === null ? null : object.getAttribute('data-object-id');
  });
  if (id === null || id === '') {
    throw new Error('this page is not typing into a text object');
  }
  return id;
}

/**
 * Put a text object on the board the way the Text tool does it: T, a click, words, Escape.
 *
 * Everything goes through the tool, including the id which comes out of the object the tool made:
 * a test that invented an id would be testing a document, not a board.
 */
export async function createTextAt(
  page: Page,
  world: Point,
  words = '',
  options: { paste?: boolean } = {},
): Promise<string> {
  const id = await placeTextAt(page, world, words, options);
  await stopTyping(page);
  return id;
}

/** T, click, and words - but leave the field open, which is where half the interesting cases are. */
export async function placeTextAt(
  page: Page,
  world: Point,
  words = '',
  options: { paste?: boolean } = {},
): Promise<string> {
  await chooseTextTool(page);
  const at = await screenOf(page, world);
  await page.mouse.click(at.x, at.y);
  await expect(
    textEditor(page),
    'a click with the Text tool up should open a text object to type into',
  ).toBeFocused();
  const id = await editingTextId(page);
  if (words !== '') {
    if (options.paste === true) {
      await textEditor(page).fill(words);
    } else {
      await page.keyboard.type(words);
    }
    await settle(page);
  }
  return id;
}

/** Escape, out of the field: the words stay, and so does the object holding them. */
export async function stopTyping(page: Page): Promise<void> {
  await textEditor(page).press('Escape');
  await settle(page);
}

/**
 * Open a text object that already exists, and wait for the field.
 *
 * A double-click, because that is what everybody knows: it is also the gesture that makes a note out
 * of empty board space, so a board that treated a text object as empty space would show up here as a
 * note appearing where a heading was opened.
 */
export async function openText(page: Page, id: string, shift = false): Promise<void> {
  const at = await centreOnScreen(page, id);
  if (shift) {
    await page.keyboard.down('Shift');
  }
  await page.mouse.dblclick(at.x, at.y);
  if (shift) {
    await page.keyboard.up('Shift');
  }
  await expect(textEditor(page), 'a double-click on a text object should open it').toBeFocused();
  await settle(page);
}

/** Press Enter with a text object selected: the keyboard's way into the words. */
export async function openTextWithKey(page: Page): Promise<void> {
  await page.keyboard.press('Enter');
  await expect(textEditor(page), 'Enter should open the selected text').toBeFocused();
  await settle(page);
}

/** Press a text object once: it is the selection, and the size bar comes up. */
export async function selectText(page: Page, id: string): Promise<void> {
  const at = await centreOnScreen(page, id);
  await page.mouse.click(at.x, at.y);
  await expect(textToolbar(page), 'a single selected text object has a size bar').toBeVisible();
  await settle(page);
}

/* ------------------------------------------------------------------------------ its sizes */

/** The size the bar says the words are, by which button is pressed. */
export async function pressedSize(page: Page): Promise<string> {
  const size = await textToolbar(page)
    .locator('[data-testid="text-size"][aria-pressed="true"]')
    .getAttribute('data-size');
  if (size === null) {
    throw new Error('the text bar offers no pressed size');
  }
  return size;
}

/** Choose a size from the bar, and wait for the object to be that size. */
export async function chooseTextSize(page: Page, id: string, size: TextSize): Promise<void> {
  await sizeButton(page, size).click();
  await expect
    .poll(() => measured(page, id).then((face) => face.size), { timeout: 5_000 })
    .toBe(size);
  await settle(page);
}

/** The size buttons the bar offers, in the order they are drawn. */
export function offeredSizes(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="text-toolbar"] [data-testid="text-size"]')].map(
      (element) => element.getAttribute('data-size') ?? '',
    ),
  );
}

/* ------------------------------------------------------------------------ what it looks like */

/**
 * How many lines the browser laid the words out into.
 *
 * A range over the drawn text hands back one rectangle per line box, which is the browser saying
 * what it did rather than the app saying what it meant to do. It also hands back one rectangle per
 * *inline box*, and `pre-wrap` makes an inline box of the space at the end of a line that wrapped -
 * so the raw count is the number of lines plus however many of those the words happen to contain,
 * which is a number about spaces rather than about lines. The rows of pixels the rectangles land on
 * is what a line is, so that is what gets counted.
 *
 * While somebody is typing there is no drawn text to put a range over - the field is standing in for
 * it - and a textarea reports the same thing as the height of its own content.
 */
export async function linesOf(page: Page, id: string): Promise<number> {
  const counted = await textElement(page, id).evaluate((element) => {
    const drawn = element.querySelector<HTMLElement>('[data-testid="text-object-text"]');
    if (drawn !== null) {
      const range = document.createRange();
      range.selectNodeContents(drawn);
      const rows = new Set<number>();
      for (const rect of Array.from(range.getClientRects())) {
        rows.add(Math.round(rect.top));
      }
      return { lines: rows.size, as: 'the words as they are drawn' };
    }
    const field = element.querySelector<HTMLElement>('[data-testid="text-editor"]');
    if (field === null) {
      throw new Error(
        `text object ${id} is neither being typed in nor lying there: nothing to count lines in`,
      );
    }
    const one = Number.parseFloat(getComputedStyle(field).lineHeight);
    return { lines: Math.round(field.scrollHeight / one), as: 'the field being typed in' };
  });
  expect(
    counted.lines,
    `the words should be laid out in at least one line (${counted.as})`,
  ).toBeGreaterThan(0);
  return counted.lines;
}

/** One line of words at this size, in world units: what the stored height is a multiple of. */
export function lineHeight(size: TextSize): number {
  return Math.round(TEXT_SIZES[size] * TEXT_LINE_HEIGHT);
}

/**
 * The height a text object of `lines` lines at `size` is stored as.
 *
 * Rounded once, over the whole height rather than once per line, because that is what the app does:
 * the height is one measurement of `lines × font-size × line-height`, and a helper that rounded every
 * line on its own would be a helper that disagreed with the app by a unit on sizes like L, where a
 * line is 41.6 units and nobody stores 0.6 of a pixel.
 */
export function heightFor(size: TextSize, lines: number): number {
  return Math.round(TEXT_SIZES[size] * TEXT_LINE_HEIGHT * lines);
}

/** The handles drawn around whatever is selected, by the side they are on. */
export function handleNames(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="resize-handle"]')].map(
      (element) => element.getAttribute('data-handle') ?? '',
    ),
  );
}

/** How many outlines are drawn, which is how a test says "nothing is selected". */
export const outlineCount = (page: Page): Promise<number> => outlines(page).count();

/** The height a text object of `lines` lines at `size` is stored as. */


export { resizeHandles, placeOf, VIEWPORT };
