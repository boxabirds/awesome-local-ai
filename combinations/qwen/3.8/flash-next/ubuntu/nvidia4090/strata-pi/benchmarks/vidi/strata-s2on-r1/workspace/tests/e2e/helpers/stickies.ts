import { expect, type Page } from "@playwright/test";
import type { XY } from "./board";
import { boardCentre, readCamera, waitForRenderedBoard } from "./board";

/**
 * Sticky note helpers for e2e. Everything a test needs about a note is read from
 * the rendered DOM: the note element's inline `left`/`top` are its world position
 * and its bounding box is where it actually appears on screen.
 */

export function noteLocator(page: Page, id: string) {
  return page.locator(`.sticky-note[data-note-id="${id}"]`);
}

export async function noteIds(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>(".sticky-note")).map(
      (el) => el.dataset.noteId ?? "",
    ),
  );
}

export async function noteCount(page: Page): Promise<number> {
  return (await noteIds(page)).length;
}

/** World coordinates of a note's top-left, straight from the model-driven style. */
export async function noteWorldPosition(page: Page, id: string): Promise<XY> {
  const value = await noteLocator(page, id).evaluate((el) => ({
    x: Number.parseFloat(el.style.left),
    y: Number.parseFloat(el.style.top),
  }));
  return { x: value.x, y: value.y };
}

export async function noteCentreOnScreen(page: Page, id: string): Promise<XY> {
  const box = await noteLocator(page, id).boundingBox();
  if (!box) throw new Error(`note ${id} has no bounding box`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export async function noteScreenSize(page: Page, id: string): Promise<{ width: number; height: number }> {
  const box = await noteLocator(page, id).boundingBox();
  if (!box) throw new Error(`note ${id} has no bounding box`);
  return { width: box.width, height: box.height };
}

/** The note's background as painted, i.e. after the colour has been applied. */
export async function noteBackground(page: Page, id: string): Promise<string> {
  return noteLocator(page, id).evaluate((el) => window.getComputedStyle(el).backgroundColor);
}

/** The note's painted colour as [r, g, b], ignoring the alpha the CSS applies. */
export async function noteColor(page: Page, id: string): Promise<number[]> {
  const value = await noteLocator(page, id).evaluate((el) => window.getComputedStyle(el).backgroundColor);
  const nums = value.match(/-?\d+(?:\.\d+)?/g) ?? [];
  return nums.slice(0, 3).map(Number);
}

export async function noteDisplayText(page: Page, id: string): Promise<string> {
  const text = await noteLocator(page, id).locator(".sticky-note-text").textContent();
  return text ?? "";
}

/** The stacking order the note is painted with. */
export async function noteZIndex(page: Page, id: string): Promise<number> {
  const value = await noteLocator(page, id).evaluate((el) => Number.parseInt(el.style.zIndex || "0", 10));
  return value;
}

export async function noteFontSize(page: Page, id: string): Promise<number> {
  const value = await noteLocator(page, id)
    .locator(".sticky-note-text")
    .evaluate((el) => Number.parseFloat(window.getComputedStyle(el).fontSize));
  return value;
}

export async function textMetrics(page: Page, id: string): Promise<{ scrollHeight: number; clientHeight: number }> {
  return noteLocator(page, id)
    .locator(".sticky-note-text")
    .evaluate((el) => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }));
}

export async function isSelected(page: Page, id: string): Promise<boolean> {
  const value = await noteLocator(page, id).getAttribute("data-selected");
  return value === "true";
}

export async function isEditing(page: Page, id: string): Promise<boolean> {
  const value = await noteLocator(page, id).getAttribute("data-editing");
  return value === "true";
}

export async function editorValue(page: Page): Promise<string> {
  return page.getByTestId("sticky-note-textarea").inputValue();
}

export async function hasEditor(page: Page): Promise<boolean> {
  return (await page.getByTestId("sticky-note-textarea").count()) > 0;
}

export async function waitForEditor(page: Page) {
  await expect(page.getByTestId("sticky-note-textarea")).toBeVisible();
}

/** Double-click empty board space: the note is created, selected and editing. */
export async function createNoteByDoubleClick(page: Page, x: number, y: number): Promise<string> {
  const before = await noteIds(page);
  await page.mouse.dblclick(x, y);
  await waitForEditor(page);
  const ids = await noteIds(page);
  const created = ids.find((id) => !before.includes(id));
  if (!created) throw new Error(`double-click at (${x}, ${y}) created no note`);
  return created;
}

/** Escape ends editing but keeps the note selected. */
export async function endEditingWithEscape(page: Page) {
  await page.getByTestId("sticky-note-textarea").press("Escape");
  await expect(page.getByTestId("sticky-note-textarea")).toHaveCount(0);
}

/**
 * Press a note, move by (dx, dy) screen pixels and release. Movement is spread
 * over several moves so the drag threshold is crossed and the per-frame writes
 * are exercised the way a real drag does.
 */
export async function dragNote(page: Page, id: string, dx: number, dy: number, steps = 8) {
  const start = await noteCentreOnScreen(page, id);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(start.x + (dx * i) / steps, start.y + (dy * i) / steps);
  }
  await page.mouse.up();
  await expect.poll(() => noteWorldPosition(page, id)).toBeDefined();
  await waitForRenderedBoard(page);
  return start;
}

export async function expectNear(actual: XY, expected: XY, tolerance = 1) {
  expect(Math.abs(actual.x - expected.x)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(actual.y - expected.y)).toBeLessThanOrEqual(tolerance);
}

export async function screenCentre(page: Page): Promise<XY> {
  return boardCentre(page);
}

export async function cameraOf(page: Page) {
  return readCamera(page);
}
