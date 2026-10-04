import { expect, type Locator, type Page } from '@playwright/test';
import { worldToScreen, type Point } from '../../../src/client/canvas/camera';
import { HANDLE_SIZE_PX } from '../../../src/shared/config';
import type { Handle } from '../../../src/shared/geometry';
import { readCamera, settle, type ScreenPoint } from './board';
import { editingNoteId } from './participants';
import { editor } from './sticky';

/**
 * A selection, seen from outside a real browser.
 *
 * Everything here is read the way a person reads it: the outlines drawn on the board, the number
 * in the bar, the squares at the corners. Nothing asks the app what it thinks its selection is,
 * because a selection that the app misreports to its tests is exactly as wrong as one it
 * misreports to the person - and a wrong number in a bar is the failure this story is most
 * likely to have.
 *
 * Positions are given and taken in world units wherever the test is thinking about the board
 * ("move these six notes three hundred units"), and in screen pixels only when it is thinking
 * about the pointer ("press where the handle is drawn"). At the zoom every test here starts at -
 * 1, which is what a board looks like when nothing has zoomed it - the two are the same number,
 * and saying which one is meant is still worth doing.
 */

/* ------------------------------------------------------------- what the selection is drawn as */

export const selectionBar = (page: Page): Locator => page.getByTestId('selection-bar');
export const selectionCount = (page: Page): Locator => page.getByTestId('selection-count');
export const deleteSelectionButton = (page: Page): Locator => page.getByTestId('selection-delete');
export const noteToolbarOf = (note: Locator): Locator => note.getByTestId('note-toolbar');

/** The outline drawn around one selected object, by id. */
export const outlineOf = (page: Page, id: string): Locator =>
  page.locator(`[data-testid="selection-outline"][data-object-id="${id}"]`);

export const outlines = (page: Page): Locator => page.locator('[data-testid="selection-outline"]');

/** The one box drawn around a selection of more than one object. */
export const selectionBoundsBox = (page: Page): Locator => page.getByTestId('selection-bounds');

export const resizeHandles = (page: Page): Locator => page.locator('[data-testid="resize-handle"]');

/** One of the eight handles, by the side or corner it sits on. */
export const resizeHandle = (page: Page, handle: Handle): Locator =>
  page.locator(`[data-testid="resize-handle"][data-handle="${handle}"]`);

export const marquee = (page: Page): Locator => page.getByTestId('marquee');

/** The ids the board is drawing an outline around, in the order they are drawn. */
export function outlineIds(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="selection-outline"]')]
      .map((element) => element.getAttribute('data-object-id'))
      .filter((id): id is string => id !== null),
  );
}

/** What the bar says, or null while there is no bar at all. */
export async function barText(page: Page): Promise<string | null> {
  const count = selectionCount(page);
  return (await count.count()) === 0 ? null : (await count.innerText()).trim();
}

/** Wait for the bar to say this, which is also the way to wait for a selection to settle. */
export async function waitForBar(page: Page, text: string): Promise<void> {
  await expect(selectionCount(page), `the selection bar should say "${text}"`).toHaveText(text, {
    timeout: 5_000,
  });
}

/** Wait for exactly these objects to be outlined, whatever order they are drawn in. */
export async function waitForOutlines(page: Page, ids: readonly string[]): Promise<void> {
  await expect
    .poll(() => outlineIds(page).then((seen) => seen.slice().sort()), { timeout: 5_000 })
    .toEqual(ids.slice().sort());
}

/** The selection's box in world units, as it is drawn. */
export async function boundsOfSelection(page: Page): Promise<{ width: number; height: number }> {
  const read = await selectionBoundsBox(page).evaluate((element) => ({
    width: Number(element.getAttribute('data-width')),
    height: Number(element.getAttribute('data-height')),
  }));
  expect(Number.isFinite(read.width) && Number.isFinite(read.height)).toBe(true);
  return read;
}

/* ------------------------------------------------------------------------- where things are */

/** Where a world point is drawn on this page's screen, at the camera the page is on now. */
export async function screenOf(page: Page, world: Point): Promise<ScreenPoint> {
  return worldToScreen(await readCamera(page), world);
}

export interface Place {
  /** Top-left corner and size, in world units. */
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  selected: boolean;
}

/**
 * Where an object is drawn, in world units, read off the element it is drawn in.
 *
 * The world numbers are what the board holds; the browser's own box is where that lands on this
 * particular screen at this particular zoom, and a test that compares the two has found a
 * different bug than the one it was looking for.
 */
export async function placeOf(page: Page, id: string): Promise<Place> {
  const read = await page.evaluate((objectId) => {
    const element = document.querySelector(`[data-object-id="${objectId}"]:not(.selection-outline)`);
    if (element === null) {
      return null;
    }
    const box = element.getBoundingClientRect();
    return {
      x: Number.parseFloat((element as HTMLElement).style.left),
      y: Number.parseFloat((element as HTMLElement).style.top),
      width: Number.parseFloat((element as HTMLElement).style.width),
      height: Number.parseFloat((element as HTMLElement).style.height),
      z: Number.parseFloat(element.getAttribute('data-z') ?? 'NaN'),
      selected: element.getAttribute('data-selected') === 'true',
      onScreen: box.width > 0 && box.height > 0,
    };
  }, id);
  if (read === null || !read.onScreen || !Number.isFinite(read.x) || !Number.isFinite(read.width)) {
    throw new Error(`object ${id} is not drawn in world units: ${JSON.stringify(read)}`);
  }
  const { onScreen: _onScreen, ...place } = read;
  return place;
}

/** Every object on the board, by id, in the order they are drawn (bottom of the stack first). */
export async function places(page: Page): Promise<Map<string, Place>> {
  const ids = await page.evaluate(() =>
    [...document.querySelectorAll('[data-object-id]:not(.selection-outline)')].map((element) =>
      element.getAttribute('data-object-id'),
    ),
  );
  const entries = await Promise.all(
    ids.filter((id): id is string => id !== null && id !== '').map(async (id) => [id, await placeOf(page, id)] as const),
  );
  return new Map(entries);
}

/** The centre of an object, in screen pixels: where a press on it has to land. */
export async function centreOnScreen(page: Page, id: string): Promise<ScreenPoint> {
  const box = await page
    .locator(`[data-object-id="${id}"]:not(.selection-outline)`)
    .boundingBox();
  if (box === null) {
    throw new Error(`object ${id} is not on screen`);
  }
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** The centre of a handle as it is drawn, in screen pixels. */
export async function handleOnScreen(page: Page, handle: Handle): Promise<ScreenPoint> {
  const box = await resizeHandle(page, handle).boundingBox();
  if (box === null) {
    throw new Error(`the ${handle} handle is not on screen`);
  }
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * How big a handle is on the screen, in pixels - measured, not taken from the style. This is the
 * number that decides whether a mouse can hit it, and it is the reason handles are placed in
 * screen space rather than in world units.
 */
export async function handleSizeOnScreen(page: Page, handle: Handle): Promise<number> {
  const box = await resizeHandle(page, handle).boundingBox();
  if (box === null) {
    throw new Error(`the ${handle} handle is not on screen`);
  }
  return Math.round(Math.max(box.width, box.height));
}

export { HANDLE_SIZE_PX };

/**
 * Which object is drawn on top at a world point - what a person would see if they looked there.
 *
 * Stacking is the one claim in this story that only a real browser can check. The document holds a
 * number per object, and a number can be right while the thing it describes is painted underneath
 * something else; the question a person asks is "when I drag my six notes across the board, do they
 * still cover the note that was already there", and the only way to answer it is to ask the browser
 * what it drew at that pixel.
 */
export async function paintTopId(page: Page, world: Point): Promise<string | null> {
  const at = await screenOf(page, world);
  return page.evaluate(({ x, y }) => {
    let element = document.elementFromPoint(x, y);
    while (element !== null) {
      if (element.hasAttribute('data-object-id') && !element.classList.contains('selection-outline')) {
        return element.getAttribute('data-object-id');
      }
      element = element.parentElement;
    }
    return null;
  }, at);
}

/* ------------------------------------------------------------------------------ making notes */

/**
 * Put the pen down: nothing selected, so nothing is holding a toolbar over the board.
 *
 * A note that was just made is a selected note, and a selected note carries a toolbar a short way
 * above it. That is the app's doing and nobody's mistake - but a test that means to double-click the
 * board an inch above that note would be double-clicking a colour swatch, and would report the
 * strangest possible nonsense. Escape, with the board holding the keyboard, is the gesture a person
 * uses for exactly this.
 */
export async function putThePenDown(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await settle(page);
  await expect
    .poll(() => outlineIds(page).then((seen) => seen.length), { timeout: 5_000 })
    .toBe(0);
}

/**
 * Make a note with a double-click at a world point, and leave it alone.
 *
 * Notes are made the only way they are made: somebody double-clicks a place on the board and a note
 * appears there, open to be typed into. The id comes from the note that is open - which is the only
 * way to know which note this page made: on a board other people are working on at the same time,
 * "the note that was not here a moment ago" belongs to whoever's mouse was busiest, not to anybody.
 */
export async function createNoteAt(page: Page, world: Point, text = ''): Promise<string> {
  await putThePenDown(page);
  const at = await screenOf(page, world);
  await page.mouse.move(at.x, at.y);
  await page.mouse.dblclick(at.x, at.y);
  await expect(
    editor(page),
    'a double-click on empty board space should open a note to type into',
  ).toBeVisible();
  if (text !== '') {
    await page.keyboard.type(text);
  }
  const id = await editingNoteId(page);
  await page.keyboard.press('Escape');
  await settle(page);
  return id;
}

/** Make `count` notes, one at each world point, and give their ids back in that order. */
export async function createNotesAt(
  page: Page,
  worlds: readonly Point[],
  texts: readonly string[] = [],
): Promise<string[]> {
  const ids: string[] = [];
  for (const [index, world] of worlds.entries()) {
    ids.push(await createNoteAt(page, world, texts[index] ?? ''));
  }
  return ids;
}

/* -------------------------------------------------------------------------- choosing things */

/** Press an object: it becomes the whole selection. */
export async function selectObject(page: Page, id: string): Promise<void> {
  const at = await centreOnScreen(page, id);
  await page.mouse.click(at.x, at.y);
  await settle(page);
}

/** Shift + press: it joins the selection, or leaves it if it was already in. */
export async function shiftClickObject(page: Page, id: string): Promise<void> {
  const at = await centreOnScreen(page, id);
  await page.keyboard.down('Shift');
  await page.mouse.click(at.x, at.y);
  await page.keyboard.up('Shift');
  await settle(page);
}

/** Select everything on the board with the keyboard. */
export async function selectAllWithKeyboard(page: Page): Promise<void> {
  await page.keyboard.press('Control+a');
  await settle(page);
}

/**
 * Draw a box around things with Shift held, and let go: the marquee.
 *
 * Shift is what tells the board that this drag is a choosing gesture and not a pan - so the
 * camera is expected not to move, which is what {@link marqueeDrag} also waits for the caller to
 * be able to assert.
 */
export async function marqueeDrag(page: Page, from: Point, to: Point): Promise<void> {
  const a = await screenOf(page, from);
  const b = await screenOf(page, to);
  await page.keyboard.down('Shift');
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await settle(page);
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await settle(page);
}

/** The marquee as it is drawn mid-drag, in world units: what the person sees while dragging. */
export async function marqueeBox(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  return marquee(page).evaluate((element) => {
    const style = (element as HTMLElement).style;
    return {
      x: Number.parseFloat(style.left),
      y: Number.parseFloat(style.top),
      width: Number.parseFloat(style.width),
      height: Number.parseFloat(style.height),
    };
  });
}

/* -------------------------------------------------------------------- moving and resizing */

/** Drag an object by a world delta: press its middle, travel, let go there. */
export async function dragObjectBy(page: Page, id: string, delta: Point): Promise<void> {
  const camera = await readCamera(page);
  const from = await centreOnScreen(page, id);
  const to = travel(from, delta, camera.zoom);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 6 });
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
  await settle(page);
}

/** Drag one of the eight handles by a world delta. */
export async function dragHandleBy(page: Page, handle: Handle, delta: Point): Promise<void> {
  const camera = await readCamera(page);
  // The handle is pressed where it is drawn, and let go one delta on from there - so the world
  // point under the pointer at the end is exactly one delta away from the world point it started
  // on, whatever zoom the board happens to be at.
  const from = await handleOnScreen(page, handle);
  const to = travel(from, delta, camera.zoom);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 6 });
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
  await settle(page);
}

/**
 * One world delta from a screen point, in screen pixels.
 *
 * The tests say what they mean in world units, because that is what the board holds and what a
 * person means by "move these three hundred units"; the mouse only speaks pixels, and how many
 * pixels a world unit is depends on how far the board is zoomed in.
 */
function travel(from: ScreenPoint, delta: Point, zoom: number): ScreenPoint {
  return { x: from.x + delta.x * zoom, y: from.y + delta.y * zoom };
}

/** Press a key the way a person does, with the board rather than a field holding the focus. */
export async function pressBoardKey(page: Page, key: string, shift = false): Promise<void> {
  if (shift) {
    await page.keyboard.down('Shift');
  }
  await page.keyboard.press(key);
  if (shift) {
    await page.keyboard.up('Shift');
  }
  await settle(page);
}

/** How far the page has been scrolled, which no board gesture should have any part in. */
export async function pageScroll(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
}

/** A tolerance the design gives: the board is expected to be right to within one pixel. */
export const PX = 1;

/** `actual` within `PX` of `expected`, in a message that says which number is which. */
export function near(actual: number, expected: number, tolerance = PX): void {
  expect(
    Math.abs(actual - expected),
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  ).toBeLessThanOrEqual(tolerance);
}
