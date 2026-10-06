/**
 * E2E helpers for drawn strokes (story 11).
 *
 * Same shape as the story 10 helpers: what goes on the board goes through the client's test hooks or
 * through a real mouse, and what comes back is read either from the document (`window.__vidi6
 * .getObjects()`) or from the picture that was drawn, so a failure says whether the board or the
 * screen is wrong.
 *
 * The one thing here that has no equivalent in the arrow helpers is `previewPathAcrossFrames`: the
 * claim it measures - that the line being drawn is repainted as it is drawn - is a claim about
 * successive animation frames, so it has to be sampled from inside the page, one frame at a time.
 */
import { expect, type Page } from '@playwright/test';
import {
  isStrokeSnapshot,
  type ObjectSnapshot,
  type StrokeSnapshot,
} from '../../../src/shared/board-model';
import { E2E_EVENTUAL_TIMEOUT_MS } from '../../../src/shared/config';

async function objectsOn(page: Page): Promise<readonly ObjectSnapshot[]> {
  return page.evaluate(() => {
    if (!window.__vidi6) {
      throw new Error('window.__vidi6 is missing: build the client with `vite build --mode test`');
    }
    return window.__vidi6.getObjects();
  });
}

/** Every stroke on this page's board. */
export async function strokesOn(page: Page): Promise<readonly StrokeSnapshot[]> {
  return (await objectsOn(page)).filter(isStrokeSnapshot);
}

/** One stroke by id, or a message saying it was not there. */
export async function strokeById(page: Page, id: string): Promise<StrokeSnapshot> {
  const stroke = (await strokesOn(page)).find((item) => item.id === id);
  if (!stroke) throw new Error(`stroke ${id} is not on this board`);
  return stroke;
}

/** Waits until this page's document holds `count` strokes. */
export async function waitForStrokeCount(page: Page, count: number): Promise<void> {
  await expect
    .poll(() => strokesOn(page).then((strokes) => strokes.length), {
      message: `this board should hold ${count} strokes`,
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
    })
    .toBe(count);
}

/** The box the stroke is drawn in, in CSS pixels - the picture, not the document. */
export async function drawnStrokeBox(
  page: Page,
  id: string,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await page.locator(`[data-stroke-id="${id}"]`).boundingBox();
  if (!box) throw new Error(`stroke ${id} is not drawn on this screen`);
  return box;
}

/** The `d` of the visible line, which is the ink as the board currently draws it. */
export async function strokePathData(page: Page, id: string): Promise<string> {
  const d = await page
    .locator(`[data-stroke-id="${id}"] [data-testid="stroke-line"]`)
    .getAttribute('d');
  if (d === null) throw new Error(`stroke ${id} has no drawn line on this screen`);
  return d;
}

/** The width of the visible line: the nib the stroke was drawn with, in world units. */
export async function strokeDrawnWidth(page: Page, id: string): Promise<number> {
  const width = await page
    .locator(`[data-stroke-id="${id}"] [data-testid="stroke-line"]`)
    .getAttribute('stroke-width');
  const value = Number(width);
  if (!Number.isFinite(value)) throw new Error(`stroke ${id} has no usable stroke width (${width})`);
  return value;
}

/** The stroke being drawn on this screen right now, or null when the pen is not laying down ink. */
export async function previewPathData(page: Page): Promise<string | null> {
  return page.evaluate(() =>
    document.querySelector('[data-testid="pen-preview-path"]')?.getAttribute('d') ?? null,
  );
}

/**
 * The preview path's `d`, read on `frames` consecutive animation frames.
 *
 * This is the only honest way to test "updated every animation frame": the caller starts the sample,
 * moves the mouse while it is running, and gets back one string per frame. If the line were painted
 * once at the end, or once per React render rather than per frame, the strings would be identical.
 */
export async function previewPathAcrossFrames(
  page: Page,
  frames = 6,
): Promise<(string | null)[]> {
  return page.evaluate(
    (count) =>
      new Promise<(string | null)[]>((resolve) => {
        const seen: (string | null)[] = [];
        const grab = () => {
          const path = document.querySelector('[data-testid="pen-preview-path"]');
          seen.push(path?.getAttribute('d') ?? null);
          if (seen.length < count) requestAnimationFrame(grab);
          else resolve(seen);
        };
        requestAnimationFrame(grab);
      }),
    frames,
  );
}
