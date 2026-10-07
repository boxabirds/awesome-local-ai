import { expect, type Page } from "@playwright/test";
import { STICKY_SIZE_WORLD, type StickyColor } from "../../../src/shared/config";
import type { StickySnapshot } from "../../../src/shared/board-model";
import { boardBox, boardCentre, waitForRenderedBoard, type XY } from "./board";

/**
 * Sticky note helpers for end-to-end tests: gestures a user actually makes,
 * plus a read of the board model through the test-only `window.__vidi6Board`.
 */

export interface NoteBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  colour: string;
  zIndex: number;
  selected: boolean;
}

export async function openBoard(page: Page): Promise<void> {
  await expect
    .poll(async () =>
      page.evaluate(() => typeof window.__vidi6Board?.notes === "function"),
    )
    .toBe(true);
}

/** The notes exactly as the board model holds them, in paint order. */
export async function modelNotes(page: Page): Promise<readonly StickySnapshot[]> {
  return page.evaluate(() => window.__vidi6Board!.notes());
}

export function noteLocator(page: Page, indexOrId: number | string) {
  return typeof indexOrId === "number"
    ? page.getByTestId("sticky-note").nth(indexOrId)
    : page.locator(`[data-testid="sticky-note"][data-note-id="${indexOrId}"]`);
}

export async function noteBox(page: Page, indexOrId: number | string): Promise<NoteBox> {
  const locator = noteLocator(page, indexOrId);
  const box = await locator.boundingBox();
  if (!box) throw new Error("sticky note has no bounding box");
  const info = await locator.evaluate((el) => ({
    id: (el as HTMLElement).dataset.noteId ?? "",
    colour: window.getComputedStyle(el).backgroundColor,
    zIndex: Number(window.getComputedStyle(el).zIndex),
    selected: (el as HTMLElement).dataset.selected === "true",
  }));
  return {
    id: info.id,
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    colour: info.colour,
    zIndex: info.zIndex,
    selected: info.selected,
  };
}

export async function noteCount(page: Page): Promise<number> {
  return page.getByTestId("sticky-note").count();
}

export async function createNoteByDoubleClick(page: Page, at: XY): Promise<string> {
  const beforeIds = new Set((await modelNotes(page)).map((note) => note.id));
  await page.mouse.move(at.x, at.y);
  await page.mouse.dblclick(at.x, at.y);
  await expect(page.getByTestId("sticky-textarea")).toBeVisible();
  await expect(page.getByTestId("sticky-note")).toHaveCount(beforeIds.size + 1);
  const after = await modelNotes(page);
  const created = after.filter((note) => !beforeIds.has(note.id));
  if (created.length !== 1) throw new Error(`expected exactly one new note, saw ${created.length}`);
  return created[0]!.id;
}

export async function createNoteByButton(page: Page): Promise<string> {
  const beforeIds = new Set((await modelNotes(page)).map((note) => note.id));
  await page.getByRole("button", { name: "Sticky note" }).click();
  await expect(page.getByTestId("sticky-textarea")).toBeVisible();
  const after = await modelNotes(page);
  const created = after.filter((note) => !beforeIds.has(note.id));
  if (created.length !== 1) throw new Error(`expected exactly one new note, saw ${created.length}`);
  return created[0]!.id;
}

export async function closeEditor(page: Page, next: "escape" | "outside" = "escape"): Promise<void> {
  if (next === "escape") {
    await page.keyboard.press("Escape");
  } else {
    const centre = await boardCentre(page);
    await page.mouse.move(centre.x, centre.y + 260);
    await page.mouse.down();
    await page.mouse.up();
  }
  await expect(page.getByTestId("sticky-textarea")).toHaveCount(0);
}

/** Press, move and release on the middle of a note. */
export async function dragNote(
  page: Page,
  id: string,
  dx: number,
  dy: number,
  steps = 8,
): Promise<void> {
  const box = await noteBox(page, id);
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  for (let step = 1; step <= steps; step += 1) {
    await page.mouse.move(startX + (dx * step) / steps, startY + (dy * step) / steps);
  }
  await page.mouse.up();
  await expect
    .poll(async () => {
      const moved = await noteBox(page, id);
      return Math.abs(moved.x - (box.x + dx)) + Math.abs(moved.y - (box.y + dy));
    })
    .toBeLessThan(2);
}

export async function selectNote(page: Page, id: string): Promise<void> {
  const box = await noteBox(page, id);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  await expect(page.getByTestId("note-toolbar")).toBeVisible();
}

export async function clickEmptyBoard(page: Page, at?: XY): Promise<void> {
  const point = at ?? { x: 60, y: 700 };
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.up();
}

export async function expectSelected(page: Page, id: string, selected: boolean): Promise<void> {
  await expect(noteLocator(page, id)).toHaveAttribute("data-selected", selected ? "true" : "false");
}

export async function expectEditing(page: Page, id: string, editing: boolean): Promise<void> {
  await expect(noteLocator(page, id)).toHaveAttribute("data-editing", editing ? "true" : "false");
}

export async function noteText(page: Page, id: string): Promise<string> {
  const notes = await modelNotes(page);
  const note = notes.find((candidate) => candidate.id === id);
  if (!note) throw new Error(`note ${id} is not in the board model`);
  return note.text;
}

export async function noteColor(page: Page, id: string): Promise<StickyColor> {
  const notes = await modelNotes(page);
  const note = notes.find((candidate) => candidate.id === id);
  if (!note) throw new Error(`note ${id} is not in the board model`);
  return note.color;
}

/** Screen point where a note centred in world units should appear. */
export function expectedScreenSize(zoom: number): number {
  return STICKY_SIZE_WORLD * zoom;
}

/**
 * Zoom the board to an exact level, keeping the world origin at the centre of
 * the board area (so notes created by the toolbar button stay on screen), and
 * wait for the paint to catch up.
 */
export async function zoomTo(page: Page, zoom: number): Promise<void> {
  const box = await boardBox(page);
  const target = { x: -(box.width / 2) / zoom, y: -(box.height / 2) / zoom, zoom };
  await page.evaluate((value) => {
    window.__vidi6!.setCamera(value);
  }, target);
  await waitForRenderedBoard(page);
}
