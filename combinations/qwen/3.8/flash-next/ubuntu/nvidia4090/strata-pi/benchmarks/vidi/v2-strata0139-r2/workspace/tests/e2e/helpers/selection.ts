import { expect, type Page } from "@playwright/test";
import { boardBox, renderedCamera, setCamera, type XY } from "./board";
import { notes, settle, type NoteDom } from "./notes";
import type { Handle } from "../../../src/shared/geometry";

/**
 * Story 7 e2e helpers: the selection as a person sees it (the bar, the outlines,
 * the 8 handles), the Shift+drag that draws the selection rectangle, and drags
 * expressed in **board units** so an assertion says what the story says.
 */

export interface SelectionState {
  /** Text of the count, e.g. "4 selected", or null when no bar is on screen. */
  count: string | null;
  /** How many board objects carry `data-selected="true"`. */
  selected: number;
  /** How many selection outlines are drawn. */
  outlines: number;
  /** Whether the selection bar is on screen. */
  bar: boolean;
  /** Whether the marquee rectangle is being drawn. */
  marquee: boolean;
}

export async function selectionState(page: Page): Promise<SelectionState> {
  const raw = await page.evaluate(() => {
    const count = document.querySelector<HTMLElement>("[data-testid='selection-count']");
    const bar = document.querySelector("[data-testid='selection-bar']");
    const marquee = document.querySelector("[data-testid='marquee-rect']");
    return {
      count: count ? (count.textContent ?? "") : null,
      bar: !!bar,
      marquee: !!marquee,
      selected: document.querySelectorAll("[data-selected='true']").length,
      outlines: document.querySelectorAll("[data-testid='selection-outline']").length,
    };
  });
  return {
    count: raw.count,
    bar: raw.bar,
    marquee: raw.marquee,
    selected: raw.selected,
    outlines: raw.outlines,
  };
}

export async function selectedIds(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>("[data-selected='true']"))
      .map((el) => el.getAttribute("data-note-id") ?? "")
      .filter((id) => id !== ""),
  );
}

/** The screen point a board point appears at, from what is rendered. */
export async function screenOf(page: Page, world: XY): Promise<XY> {
  const area = await boardBox(page);
  const camera = await renderedCamera(page);
  return {
    x: area.x + (world.x - camera.x) * camera.zoom,
    y: area.y + (world.y - camera.y) * camera.zoom,
  };
}

/**
 * Puts the camera so that this board point sits in the middle of the screen.
 *
 * A camera position is the board point at the viewport's top-left corner, so
 * centring a point means backing off by half the viewport, in board units.
 */
export async function centreOn(page: Page, world: XY, zoom = 1): Promise<void> {
  const area = await boardBox(page);
  await setCamera(page, {
    x: world.x - area.width / 2 / zoom,
    y: world.y - area.height / 2 / zoom,
    zoom,
  });
}

/**
 * Shift+drag across empty board space: the selection rectangle. `from` and `to`
 * are board coordinates, so a test reads as "the rectangle around these notes".
 */
export async function marquee(
  page: Page,
  from: XY,
  to: XY,
  options: { steps?: number; additive?: boolean } = {},
): Promise<void> {
  const steps = options.steps ?? 10;
  // The board needs the modifier before it will draw a rectangle instead of
  // panning, and that is also the modifier that *adds* to the selection. So a
  // test asking for "the selection is these notes" gets the selection cleared
  // first, which is what a plain rectangle does.
  if (options.additive !== true) {
    await page.keyboard.press("Escape");
    await settle(page);
  }
  const start = await screenOf(page, from);
  const end = await screenOf(page, to);
  await page.keyboard.down("Shift");
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let step = 1; step <= steps; step += 1) {
    await page.mouse.move(start.x + ((end.x - start.x) * step) / steps, start.y + ((end.y - start.y) * step) / steps);
  }
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await settle(page);
}

/** Press a board object, move it by board units, release. */
export async function dragObjectBy(
  page: Page,
  id: string,
  delta: XY,
  options: { steps?: number; grab?: XY } = {},
): Promise<void> {
  const locator = page.locator(`[data-note-id='${id}']`);
  const box = await locator.boundingBox();
  if (!box) throw new Error(`object ${id} has no bounding box`);
  const camera = await renderedCamera(page);
  const grab = options.grab ?? { x: box.x + 20, y: box.y + 20 };
  const steps = options.steps ?? 10;
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  for (let step = 1; step <= steps; step += 1) {
    await page.mouse.move(
      grab.x + (delta.x * camera.zoom * step) / steps,
      grab.y + (delta.y * camera.zoom * step) / steps,
    );
  }
  await page.mouse.up();
  await settle(page);
}

/** Press a selection handle, move it by board units, release. */
export async function dragHandleBy(
  page: Page,
  handle: Handle,
  delta: XY,
  options: { steps?: number; shiftKey?: boolean } = {},
): Promise<void> {
  const locator = page.getByTestId(`resize-handle-${handle}`);
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  if (!box) throw new Error(`handle ${handle} has no bounding box`);
  const camera = await renderedCamera(page);
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const steps = options.steps ?? 10;
  if (options.shiftKey) await page.keyboard.down("Shift");
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let step = 1; step <= steps; step += 1) {
    await page.mouse.move(
      from.x + (delta.x * camera.zoom * step) / steps,
      from.y + (delta.y * camera.zoom * step) / steps,
    );
  }
  await page.mouse.up();
  if (options.shiftKey) await page.keyboard.up("Shift");
  await settle(page);
}

/** The world-space box of the object with this id, from what is rendered. */
export async function worldBox(page: Page, id: string): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await page.locator(`[data-note-id='${id}']`).boundingBox();
  if (!box) throw new Error(`object ${id} is not on screen`);
  const area = await boardBox(page);
  const camera = await renderedCamera(page);
  return {
    x: (box.x - area.x) / camera.zoom + camera.x,
    y: (box.y - area.y) / camera.zoom + camera.y,
    width: box.width / camera.zoom,
    height: box.height / camera.zoom,
  };
}

export async function worldBoxes(page: Page, ids: readonly string[]): Promise<Map<string, { x: number; y: number; width: number; height: number }>> {
  const out = new Map<string, { x: number; y: number; width: number; height: number }>();
  for (const id of ids) out.set(id, await worldBox(page, id));
  return out;
}

/**
 * Draws a selection rectangle around exactly these objects: the union of their
 * boxes, padded so nothing is merely clipped.
 */
export async function marqueeAround(page: Page, ids: readonly string[], pad = 25): Promise<void> {
  const boxes = await worldBoxes(page, ids);
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const box of boxes.values()) {
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  }
  await marquee(page, { x: minX - pad, y: minY - pad }, { x: maxX + pad, y: maxY + pad });
}

/**
 * Selects exactly these objects the way a person does: one click, then
 * Shift+click for the rest. Deterministic, unlike a rectangle that might also
 * enclose a neighbour.
 */
export async function selectIds(page: Page, ids: readonly string[]): Promise<void> {
  await page.keyboard.press("Escape");
  await settle(page);
  for (const [index, id] of ids.entries()) {
    const locator = page.locator(`[data-note-id='${id}']`);
    if (index > 0) await page.keyboard.down("Shift");
    await locator.click();
    if (index > 0) await page.keyboard.up("Shift");
  }
  await settle(page);
}

/** Clears the selection the way a person does: Escape. */
export async function clearSelection(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await settle(page);
  await expect.poll(async () => (await selectionState(page)).selected, { timeout: 5_000 }).toBe(0);
}

export async function pressKeys(page: Page, key: string, times = 1, shiftKey = false): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    if (shiftKey) await page.keyboard.down("Shift");
    await page.keyboard.press(key);
    if (shiftKey) await page.keyboard.up("Shift");
  }
  await settle(page);
}

export async function selectAll(page: Page): Promise<void> {
  await page.keyboard.press("Control+a");
  await settle(page);
}

/** Creates one note per board point, centred on it, and returns their ids in order. */
export async function createNotes(
  page: Page,
  centres: readonly XY[],
  labelFor: (index: number) => string = () => "",
): Promise<string[]> {
  const ids: string[] = [];
  for (const [index, centre] of centres.entries()) {
    const at = await screenOf(page, centre);
    const before = new Set((await notes(page)).map((note) => note.id));
    await page.mouse.dblclick(at.x, at.y);
    await expect(page.getByTestId("sticky-note-input")).toBeVisible();
    const text = labelFor(index);
    if (text !== "") await page.keyboard.type(text);
    await page.keyboard.press("Escape");
    await settle(page);
    const created = (await notes(page)).find((note) => !before.has(note.id));
    if (!created) throw new Error(`the note for ${JSON.stringify(centre)} is missing`);
    ids.push(created.id);
  }
  return ids;
}

export function notesOf(list: NoteDom[], ids: readonly string[]): NoteDom[] {
  return ids.map((id) => {
    const note = list.find((entry) => entry.id === id);
    if (!note) throw new Error(`note ${id} is not on screen`);
    return note;
  });
}
