/**
 * Browser helpers for story 11: the Pen tool and its strokes.
 *
 * A stroke reports its world box, its colour and thickness and how many points it kept in the DOM
 * (`data-stroke-*`, `data-points`), and the smooth path it paints is a real `d` attribute — so a
 * test can watch the preview change mid-drag and read the committed ink afterwards. Gestures are
 * real pointer moves: a down, a run of moves, an up, the way a hand draws.
 */
import { expect, type Page } from '@playwright/test';

import type { PenColor, PenThickness } from '../../../src/shared/config';
import type { ScreenPoint } from './board';

export const STROKE_SELECTOR = '[data-testid="stroke-object"]';
export const STROKE_PATH = '[data-testid="stroke-path"]';
export const STROKE_PREVIEW = '[data-testid="pen-preview"]';
export const PEN_TOOL = '[data-testid="pen-tool"]';

export interface StrokeOnScreen {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  points: number;
  color: string;
  thickness: string;
  selected: boolean;
}

export async function readStrokes(page: Page): Promise<StrokeOnScreen[]> {
  return page.$$eval(STROKE_SELECTOR, (elements) =>
    elements.map((element) => {
      const node = element as HTMLElement;
      return {
        id: node.dataset.objectId ?? '',
        x: Number(node.dataset.strokeX),
        y: Number(node.dataset.strokeY),
        width: Number(node.dataset.strokeWidth),
        height: Number(node.dataset.strokeHeight),
        points: Number(node.dataset.points),
        color: node.dataset.color ?? '',
        thickness: node.dataset.thickness ?? '',
        selected: node.dataset.selected === 'true',
      };
    }),
  );
}

export async function readStroke(page: Page, id: string): Promise<StrokeOnScreen | null> {
  return (await readStrokes(page)).find((s) => s.id === id) ?? null;
}

export async function strokeCount(page: Page): Promise<number> {
  return (await page.$$(STROKE_SELECTOR)).length;
}

/** Arm the Pen tool by its keyboard shortcut. */
export async function armPenTool(page: Page): Promise<void> {
  await page.getByTestId('board-viewport').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('p');
  await expect(page.getByTestId('tool-pen')).toHaveAttribute('aria-pressed', 'true');
}

/** Choose a pen colour from the options panel. */
export async function choosePenColour(page: Page, colour: PenColor): Promise<void> {
  const label = colour.charAt(0).toUpperCase() + colour.slice(1);
  await page.getByRole('button', { name: `${label} pen` }).click();
}

/** Choose a pen thickness from the options panel. */
export async function choosePenThickness(page: Page, thickness: PenThickness): Promise<void> {
  const label = thickness.charAt(0).toUpperCase() + thickness.slice(1);
  await page.getByRole('button', { name: label }).click();
}

/**
 * Draw a stroke by running the mouse through `points`. Returns the id of the stroke that appeared.
 *
 * The move is broken into single steps so every point reaches the page as its own coalesced sample,
 * and the last point doubles as the release.
 */
export async function drawStroke(page: Page, points: ScreenPoint[]): Promise<string> {
  if (points.length < 2) throw new Error('a stroke needs at least two points');
  const before = new Set((await readStrokes(page)).map((s) => s.id));
  await page.mouse.move(points[0]!.x, points[0]!.y);
  await page.mouse.down();
  for (const point of points.slice(1)) await page.mouse.move(point.x, point.y);
  await page.mouse.up();
  let fresh: StrokeOnScreen[] = [];
  await expect
    .poll(
      async () => {
        fresh = (await readStrokes(page)).filter((s) => !before.has(s.id));
        return fresh.length;
      },
      { message: 'the pen drag drew no stroke', timeout: 10_000 },
    )
    .toBe(1);
  return fresh[0]!.id;
}

/** A dot: press and release in the same place. Returns the id of the stroke that appeared. */
export async function drawDot(page: Page, at: ScreenPoint): Promise<string> {
  const before = new Set((await readStrokes(page)).map((s) => s.id));
  await page.mouse.click(at.x, at.y);
  let fresh: StrokeOnScreen[] = [];
  await expect
    .poll(
      async () => {
        fresh = (await readStrokes(page)).filter((s) => !before.has(s.id));
        return fresh.length;
      },
      { message: 'the pen click drew no dot', timeout: 10_000 },
    )
    .toBe(1);
  return fresh[0]!.id;
}

/**
 * Start a stroke, run through `points`, but do not release; hand back a way to read the live
 * preview and to finish. This is how a test inspects the ink the pen is painting in the air.
 */
export async function beginStroke(page: Page, points: ScreenPoint[]): Promise<{
  previewPath(): Promise<string>;
  extend(next: ScreenPoint[]): Promise<void>;
  finish(): Promise<void>;
}> {
  await page.mouse.move(points[0]!.x, points[0]!.y);
  await page.mouse.down();
  for (const point of points.slice(1)) await page.mouse.move(point.x, point.y);
  const last = points[points.length - 1]!;
  return {
    previewPath: async () => (await page.locator(STROKE_PREVIEW).getAttribute('d')) ?? '',
    extend: async (next) => {
      for (const point of next) await page.mouse.move(point.x, point.y);
    },
    finish: async () => {
      await page.mouse.move(last.x, last.y);
      await page.mouse.up();
    },
  };
}

/** The `d` attribute of a committed stroke's visible path. */
export async function strokePathD(page: Page, id: string): Promise<string> {
  return (await page.locator(`${STROKE_SELECTOR}[data-object-id="${id}"] ${STROKE_PATH}`).getAttribute('d')) ?? '';
}

/** Select a stroke by clicking one of the screen points it was drawn through. */
export async function selectStroke(page: Page, id: string, at: ScreenPoint): Promise<void> {
  await page.getByTestId('tool-select').click();
  await page.mouse.click(at.x, at.y);
  await expect
    .poll(() => readStroke(page, id).then((s) => s?.selected ?? false), {
      message: `stroke ${id} did not become selected`,
      timeout: 5000,
    })
    .toBe(true);
}
