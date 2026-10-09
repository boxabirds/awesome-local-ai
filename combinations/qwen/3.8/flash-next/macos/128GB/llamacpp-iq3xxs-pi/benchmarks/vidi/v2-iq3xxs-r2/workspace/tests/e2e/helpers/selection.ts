import { expect, type Page } from '@playwright/test';
import { boardNotes, noteRect, settle } from './board';

/**
 * Reading and driving the multi-select UI (story 7) in a real browser: the marquee, the
 * outlines, the selection bar and the handles. Coordinates are CSS pixels of the 1280x800
 * board area the suite opens, which at 100% zoom are the board's own units.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

/**
 * A place on the board where nothing is painted and no control floats: the toolbar is at
 * the left edge, the share button top-right, the zoom controls bottom-right and the
 * navigation hint bottom-centre.
 */
export const EMPTY_SPOT: Point = { x: 1100, y: 620 };

/** Shift+drag across the board: the marquee, which a plain drag would have panned with. */
export async function shiftDrag(page: Page, from: Point, to: Point, steps = 12): Promise<void> {
  await page.keyboard.down('Shift');
  await page.mouse.move(Math.round(from.x), Math.round(from.y));
  await page.mouse.down();
  for (let step = 1; step <= steps; step += 1) {
    await page.mouse.move(
      Math.round(from.x + ((to.x - from.x) * step) / steps),
      Math.round(from.y + ((to.y - from.y) * step) / steps),
    );
  }
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await settle(page);
}

export async function clickSpot(page: Page, at: Point): Promise<void> {
  await page.mouse.click(Math.round(at.x), Math.round(at.y));
  await settle(page);
}

export async function shiftClickSpot(page: Page, at: Point): Promise<void> {
  await page.keyboard.down('Shift');
  await page.mouse.click(Math.round(at.x), Math.round(at.y));
  await page.keyboard.up('Shift');
  await settle(page);
}

export async function clickNote(page: Page, id: string): Promise<void> {
  await clickSpot(page, await markerOf(page, id));
}

export async function shiftClickNote(page: Page, id: string): Promise<void> {
  await shiftClickSpot(page, await markerOf(page, id));
}

/** Where a note's body is on the screen, so it can be pressed. */
export async function markerOf(page: Page, id: string): Promise<Point> {
  const rect = await noteRect(page, id);
  return { x: rect.centerX, y: rect.centerY };
}

/* ---------------------------------------------------------------- reading */

/** The ids this browser has selected, sorted. */
export async function selectedIds(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-note-id][data-selected="true"]')]
      .map((element) => element.dataset.noteId ?? '')
      .sort(),
  );
}

/** What the selection bar announces, or null when it is not shown at all. */
export async function selectionCountText(page: Page): Promise<string | null> {
  const count = page.locator('[data-testid="selection-count"]');
  if ((await count.count()) === 0) return null;
  return (await count.textContent())?.trim() ?? null;
}

export async function expectSelectionCount(page: Page, text: string): Promise<void> {
  await expect
    .poll(async () => selectionCountText(page), { timeout: 10_000 })
    .toBe(text);
}

/** Wait until this browser's selection is exactly these ids. */
export async function waitForSelection(page: Page, ids: readonly string[]): Promise<void> {
  const expected = [...ids].sort();
  await expect
    .poll(() => selectedIds(page), { timeout: 10_000, message: `selection of ${expected.join(',')}` })
    .toEqual(expected);
}

/*
 * `locator.boundingBox()` waits for the element to be there, so asking it about something
 * that is deliberately absent (a selection box with nothing selected, a marquee that has
 * already been released) would spend the whole action timeout and then throw. Look first,
 * in a way that does not wait.
 */
async function boxIfThere(page: Page, selector: string): Promise<Box | null> {
  const found = await page.locator(selector).count();
  if (found === 0) return null;
  const box = await page.locator(selector).first().boundingBox({ timeout: 2_000 });
  return box ? boxRect(box) : null;
}

/** The box drawn around the selection, or null when nothing is selected. */
export async function selectionBox(page: Page): Promise<Box | null> {
  return boxIfThere(page, '[data-testid="selection-box"]');
}

/** The marquee while it is being drawn, or null when there is none. */
export async function marqueeBox(page: Page): Promise<Box | null> {
  return boxIfThere(page, '[data-testid="marquee"]');
}

/** A handle's centre on the screen. */
export async function handleCentre(page: Page, handle: string): Promise<Point> {
  const box = await page.locator(`[data-handle="${handle}"]`).boundingBox();
  if (!box) throw new Error(`handle ${handle} has no bounding box (is anything selected?)`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Press a handle of the selection box and drag it. */
export async function dragHandle(page: Page, handle: string, by: Point): Promise<void> {
  const from = await handleCentre(page, handle);
  await dragSpot(page, from, { x: from.x + by.x, y: from.y + by.y });
}

/** Press somewhere, move in steps and release. */
export async function dragSpot(page: Page, from: Point, to: Point, steps = 10): Promise<void> {
  await page.mouse.move(Math.round(from.x), Math.round(from.y));
  await page.mouse.down();
  for (let step = 1; step <= steps; step += 1) {
    await page.mouse.move(
      Math.round(from.x + ((to.x - from.x) * step) / steps),
      Math.round(from.y + ((to.y - from.y) * step) / steps),
    );
  }
  await page.mouse.up();
  await settle(page);
}

/* -------------------------------------------------------------- creating */

/**
 * Double-click an empty spot to make a note, and click away to stop editing it, returning
 * the id the board gave it.
 */
export async function createNote(page: Page, at: Point): Promise<string> {
  const before = new Set((await boardNotes(page)).map((note) => note.id));
  await page.mouse.dblclick(Math.round(at.x), Math.round(at.y));
  await expect
    .poll(async () => (await boardNotes(page)).some((note) => !before.has(note.id)), {
      timeout: 10_000,
      message: `a new note at ${Math.round(at.x)},${Math.round(at.y)}`,
    })
    .toBe(true);
  const id = (await boardNotes(page)).find((note) => !before.has(note.id))?.id;
  if (!id) throw new Error('unreachable');
  await endEditing(page);
  return id;
}

export async function createNotes(page: Page, spots: readonly Point[]): Promise<string[]> {
  const ids: string[] = [];
  for (const spot of spots) ids.push(await createNote(page, spot));
  return ids;
}

/** A note that was just double-clicked into being is also being typed into. */
export async function endEditing(page: Page): Promise<void> {
  await clickSpot(page, EMPTY_SPOT);
  await expect(page.locator('[data-testid="sticky-editor"]')).toHaveCount(0);
}

/** Press Escape without typing anything, and wait for the editor to go. */
export async function escape(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await settle(page);
}

function boxRect(box: {
  x: number;
  y: number;
  width: number;
  height: number;
}): Box {
  return {
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    centerX: box.x + box.width / 2,
    centerY: box.y + box.height / 2,
  };
}
