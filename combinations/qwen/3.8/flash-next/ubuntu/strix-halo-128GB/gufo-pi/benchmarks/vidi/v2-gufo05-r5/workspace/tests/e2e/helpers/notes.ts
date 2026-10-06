import { expect, type Locator, type Page } from '@playwright/test';
import { screenToWorld, worldToScreen, type Point } from '../../../src/client/canvas/camera';
import type { StickySnapshot } from '../../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../../src/shared/config';
import { getCamera } from './board';

/**
 * E2E helpers for sticky notes: reading the document through the test-only
 * `window.__vidi6` hook, locating notes on screen, and driving the mouse over them.
 */

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The notes in the document, bottom to top. */
export async function getNotes(page: Page): Promise<readonly StickySnapshot[]> {
  return page.evaluate(() => {
    if (!window.__vidi6) {
      throw new Error('window.__vidi6 is missing: build the client with `vite build --mode test`');
    }
    return window.__vidi6.getNotes();
  });
}

export function noteLocator(page: Page, index = 0): Locator {
  return page.locator('[data-note-id]').nth(index);
}

export function noteById(page: Page, id: string): Locator {
  return page.locator(`[data-note-id="${id}"]`);
}

export async function noteCount(page: Page): Promise<number> {
  return (await getNotes(page)).length;
}

/** A note's world position (its top-left corner). */
export async function noteWorld(page: Page, index = 0): Promise<Point> {
  const notes = await getNotes(page);
  const note = notes[index];
  if (!note) throw new Error(`there is no note at index ${index}`);
  return { x: note.x, y: note.y };
}

/** Where a world point is drawn right now, in CSS pixels. */
export async function screenOf(page: Page, world: Point): Promise<Point> {
  return worldToScreen(await getCamera(page), world);
}

/** The centre of a note as drawn on screen. */
export async function noteCentre(page: Page, index = 0): Promise<Point> {
  const world = await noteWorld(page, index);
  return screenOf(page, { x: world.x + STICKY_SIZE_WORLD / 2, y: world.y + STICKY_SIZE_WORLD / 2 });
}

/** The world point currently drawn at a screen point. */
export async function worldOfScreen(page: Page, screen: Point): Promise<Point> {
  return screenToWorld(await getCamera(page), screen);
}

/** Double-click empty board space: creates a note there and puts the user in its text. */
export async function doubleClickToCreate(page: Page, screen: Point): Promise<void> {
  await page.mouse.dblclick(screen.x, screen.y);
}

/** Press, move in steps, release. */
export async function dragToPoint(page: Page, from: Point, to: Point, steps = 8): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
}

/** The rendered font size of a note's text, in world pixels. */
export async function noteFontPx(page: Page, index = 0): Promise<number> {
  const size = await noteLocator(page, index)
    .locator('[data-testid="sticky-note-text"]')
    .evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
  if (!Number.isFinite(size)) throw new Error('note text has no font size');
  return size;
}

/** The font size of the note text area while it is being edited, in world pixels. */
export async function editorFontPx(page: Page): Promise<number> {
  const size = await editorOf(page).evaluate(
    (el) => Number.parseFloat(getComputedStyle(el).fontSize),
  );
  if (!Number.isFinite(size)) throw new Error('note editor has no font size');
  return size;
}

/** How much of its box the note's displayed text needs. */
export function noteTextMetrics(page: Page, index = 0): Promise<{ scrollHeight: number; clientHeight: number }> {
  return noteLocator(page, index)
    .locator('[data-testid="sticky-note-text"]')
    .evaluate((el) => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }));
}

/** The note's background colour as rendered. */
export async function noteBackgroundColor(page: Page, index = 0): Promise<string> {
  return noteLocator(page, index).evaluate((el) => getComputedStyle(el).backgroundColor);
}

/** `#FFF59D` -> `rgb(255, 245, 157)`, the form getComputedStyle reports. */
export function cssColor(hex: string): string {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
  const r = Number.parseInt(full.slice(0, 2), 16);
  const g = Number.parseInt(full.slice(2, 4), 16);
  const b = Number.parseInt(full.slice(4, 6), 16);
  return `rgb(${r}, ${g}, ${b})`;
}

/** The height of an element in CSS pixels. */
export async function elementHeight(locator: Locator): Promise<number> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('element has no bounding box');
  return box.height;
}

/** The note text area (an assertion on it waits for it to appear). */
export function editorOf(page: Page): Locator {
  return page.getByTestId('sticky-note-input');
}

/** Types text into the note that is being edited, as one input event like a paste. */
export async function typeIntoEditor(page: Page, text: string): Promise<void> {
  await expect(editorOf(page)).toBeVisible();
  await page.keyboard.insertText(text);
}

/** Leaves editing mode without deleting anything. */
export async function stopEditing(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('sticky-note-input')).toHaveCount(0);
}
