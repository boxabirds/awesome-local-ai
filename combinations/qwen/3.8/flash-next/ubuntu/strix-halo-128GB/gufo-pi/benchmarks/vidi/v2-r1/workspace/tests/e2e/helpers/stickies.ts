import { expect, type Locator, type Page } from '@playwright/test';

import { screenToWorld, worldToScreen, type Camera } from '../../../src/client/canvas/camera';
import { getCamera, setCamera } from './board';
import { STICKY_COLORS, stickyColorLabel, type StickyColor } from '../../../src/shared/config';

/**
 * Helpers for driving stickies in a real browser. Everything here measures what
 * the user sees - element rectangles and the world coordinates the board draws
 * with - because the acceptance points are about the pointer staying on the
 * note and the note landing where the pointer was.
 */

export interface NoteRect {
  id: string;
  /** Screen rectangle of the note, in CSS pixels. */
  left: number;
  top: number;
  width: number;
  height: number;
  centreX: number;
  centreY: number;
  /** Position in the document, in world units. */
  worldX: number;
  worldY: number;
  color: string;
  zIndex: number;
}

export interface Point {
  x: number;
  y: number;
}

export const readCamera = getCamera;
export { setCamera };

/** The notes in paint order (bottom first), by `z-index` as painted. */
export async function noteRects(page: Page): Promise<NoteRect[]> {
  const rects = await page.$$eval(
    '.sticky-note',
    (elements) =>
      elements.map((element, position) => {
        const rect = element.getBoundingClientRect();
        const html = element as HTMLElement;
        return {
          id: html.dataset.noteId ?? '',
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          centreX: rect.left + rect.width / 2,
          centreY: rect.top + rect.height / 2,
          worldX: Number(html.dataset.noteX),
          worldY: Number(html.dataset.noteY),
          color: html.dataset.noteColor ?? '',
          zIndex: Number(html.style.zIndex || 0),
          position,
        };
      }),
  );
  return rects
    .sort((a, b) => (a.zIndex !== b.zIndex ? a.zIndex - b.zIndex : a.position - b.position))
    .map(({ position: _position, ...rect }) => rect);
}

export async function noteCount(page: Page): Promise<number> {
  return page.locator('.sticky-note').count();
}

export function stickyButton(page: Page): Locator {
  return page.getByRole('button', { name: 'Sticky note (N)' });
}

export function deleteButton(page: Page): Locator {
  return page.getByRole('button', { name: 'Delete note' });
}

export function colourSwatch(page: Page, color: StickyColor): Locator {
  return page.getByRole('button', { name: `${stickyColorLabel(color)} colour` });
}

export function editor(page: Page): Locator {
  return page.getByTestId('sticky-editor');
}

/** Double-click an empty part of the board to create a note centred there. */
export async function dblclickCreate(page: Page, at: Point): Promise<void> {
  await page.mouse.dblclick(at.x, at.y);
  await expect(editor(page)).toBeVisible();
}

/** Create a note with the toolbar button; it opens centred on the middle of the view. */
export async function createWithButton(page: Page): Promise<void> {
  await stickyButton(page).click();
  await expect(editor(page)).toBeVisible();
}

export async function typeText(page: Page, text: string): Promise<void> {
  await page.keyboard.type(text);
}

/** Bulk-insert text the way a paste does (one change, no keystrokes). */
export async function pasteText(page: Page, text: string): Promise<void> {
  await editor(page).evaluate((element, value) => {
    const textarea = element as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(textarea, value);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }, text);
}

export async function selectNoteAt(page: Page, at: Point): Promise<void> {
  await page.mouse.click(at.x, at.y);
}

/** Press, move and release in one go; returns the pointer's end point. */
export async function dragPointer(page: Page, from: Point, delta: Point): Promise<Point> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button: 'left' });
  await page.mouse.move(from.x + delta.x, from.y + delta.y, { steps: 10 });
  await page.mouse.up({ button: 'left' });
  return { x: from.x + delta.x, y: from.y + delta.y };
}

/** Wait until the note has stopped moving (positions are committed on release). */
export async function settle(page: Page): Promise<void> {
  await page.waitForTimeout(80);
}

/** Expected screen position of a world point, given a camera. */
export function screenOf(camera: Camera, world: Point): Point {
  return worldToScreen(camera, world);
}

/** Expected world position of a screen point, given a camera. */
export function worldOf(camera: Camera, screen: Point): Point {
  return screenToWorld(camera, screen);
}

/** The colour a note is painted with, as the browser sees it. */
export async function paintedColour(page: Page, index = 0): Promise<string> {
  const rects = await page.$$eval(
    '.sticky-note',
    (elements) => elements.map((element) => getComputedStyle(element).backgroundColor),
  );
  return rects[index] ?? '';
}

export function rgb(color: string): string {
  const hex = color.replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgb(${r}, ${g}, ${b})`;
}

export const PAINTED = Object.fromEntries(
  (Object.keys(STICKY_COLORS) as StickyColor[]).map((color) => [color, rgb(STICKY_COLORS[color])]),
) as Record<StickyColor, string>;

/** Id of the topmost note under a screen point. */
export async function topNoteAt(page: Page, at: Point): Promise<string | null> {
  return page.evaluate(({ x, y }) => {
    for (const element of document.elementsFromPoint(x, y)) {
      if (element instanceof HTMLElement && element.classList.contains('sticky-note')) {
        return element.dataset.noteId ?? null;
      }
    }
    return null;
  }, at);
}
