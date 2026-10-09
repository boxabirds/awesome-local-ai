import { expect, type Page } from '@playwright/test';
import {
  UNBOUNDED_PAN_TESTED_EXTENT,
  ZOOM_MAX,
  ZOOM_STEP_FACTOR,
} from '../../../src/shared/config';

export interface Camera {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly centerX: number;
  readonly centerY: number;
}

/** Pixel tolerance for "within 1 pixel" acceptance criteria. */
export const PIXEL_TOLERANCE = 1;

export function expectClose(actual: number, expected: number, tolerance = PIXEL_TOLERANCE): void {
  expect(
    Math.abs(actual - expected),
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  ).toBeLessThanOrEqual(tolerance);
}

/**
 * Camera updates are coalesced to one per animation frame, so a read that races the
 * commit sees the previous view. Two frames is always enough for the commit to land.
 */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

export async function readCamera(page: Page): Promise<Camera> {
  await settle(page);
  return page.evaluate(() => {
    const viewport = document.querySelector<HTMLElement>('[data-testid="viewport"]');
    if (!viewport) throw new Error('viewport is not mounted');
    return {
      x: Number(viewport.dataset.cameraX),
      y: Number(viewport.dataset.cameraY),
      zoom: Number(viewport.dataset.cameraZoom),
    };
  });
}

/**
 * The origin marker's box, read from the DOM rather than Playwright's bounding box so
 * it is still available when the marker is scrolled far off screen.
 */
export async function markerRect(page: Page): Promise<Rect> {
  await settle(page);
  const rect = await page.evaluate(() => {
    const marker = document.querySelector<HTMLElement>('[data-testid="origin-marker"]');
    if (!marker) throw new Error('origin marker is not mounted');
    const box = marker.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  });
  return {
    ...rect,
    centerX: rect.x + rect.width / 2,
    centerY: rect.y + rect.height / 2,
  };
}

export async function zoomLabel(page: Page): Promise<string> {
  return (await page.locator('[data-testid="zoom-label"]')).innerText();
}

export async function hintCount(page: Page): Promise<number> {
  return page.locator('[data-testid="navigation-hint"]').count();
}

/** Grid dot spacing in screen pixels, as the browser computed it. */
export async function gridSpacingPx(page: Page): Promise<number> {
  await settle(page);
  return page.evaluate(() => {
    const viewport = document.querySelector<HTMLElement>('[data-testid="viewport"]');
    if (!viewport) throw new Error('viewport is not mounted');
    return Number.parseFloat(getComputedStyle(viewport).backgroundSize.split(' ')[0] ?? '0');
  });
}

export async function gridPositionPx(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const viewport = document.querySelector<HTMLElement>('[data-testid="viewport"]');
    if (!viewport) throw new Error('viewport is not mounted');
    const [x, y] = getComputedStyle(viewport).backgroundPosition.split(' ');
    return { x: Number.parseFloat(x ?? '0'), y: Number.parseFloat(y ?? '0') };
  });
}

/** Jump the camera anywhere on the board; only available in the test build. */
export async function setCamera(page: Page, camera: Camera): Promise<void> {
  await page.evaluate((next) => {
    if (!window.__vidi6) throw new Error('test hook window.__vidi6 is missing');
    window.__vidi6.setCamera(next);
  }, camera);
  await page.waitForFunction((expected) => {
    const viewport = document.querySelector<HTMLElement>('[data-testid="viewport"]');
    if (!viewport) return false;
    return (
      Number(viewport.dataset.cameraX) === expected.x &&
      Number(viewport.dataset.cameraY) === expected.y &&
      Number(viewport.dataset.cameraZoom) === expected.zoom
    );
  }, camera);
}

export async function setCameraFarAway(page: Page, zoom = 1): Promise<void> {
  await setCamera(page, {
    x: UNBOUNDED_PAN_TESTED_EXTENT,
    y: UNBOUNDED_PAN_TESTED_EXTENT,
    zoom,
  });
}

export async function setCameraToMaxZoom(page: Page): Promise<void> {
  await setCamera(page, {
    x: UNBOUNDED_PAN_TESTED_EXTENT,
    y: UNBOUNDED_PAN_TESTED_EXTENT,
    zoom: ZOOM_MAX,
  });
}

/** Mouse drag across the board, in steps, like a real pointer would. */
export async function dragBoard(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 5,
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(
      from.x + ((to.x - from.x) * i) / steps,
      from.y + ((to.y - from.y) * i) / steps,
    );
  }
  await page.mouse.up();
  await settle(page);
}

/** Wheel with Ctrl held (trackpad pinch is delivered the same way). */
export async function ctrlWheel(page: Page, deltaY: number, at: { x: number; y: number }) {
  await page.mouse.move(at.x, at.y);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, deltaY);
  await page.keyboard.up('Control');
  await settle(page);
}

export async function pressShortcut(page: Page, key: string): Promise<void> {
  await page.keyboard.down('Control');
  await page.keyboard.press(key);
  await page.keyboard.up('Control');
  await settle(page);
}

export const VIEWPORT_SIZE = { width: 1280, height: 800 };
export const VIEWPORT_CENTRE = { x: 640, y: 400 };

/**
 * Wait for the board to be open and centred on its starting point. Two separate waits
 * so a failure says which one broke: a missing viewport means the server is not serving
 * the client build; a wrong camera means it did not open centred.
 */
export async function waitForCentredBoard(page: Page, timeout = 15_000): Promise<void> {
  try {
    await page.locator('[data-testid="viewport"]').waitFor({ timeout });
    await page.waitForFunction(
      () => {
        const viewport = document.querySelector<HTMLElement>('[data-testid="viewport"]');
        if (!viewport) return false;
        return (
          Number(viewport.dataset.cameraX) === -window.innerWidth / 2 &&
          Number(viewport.dataset.cameraY) === -window.innerHeight / 2 &&
          Number(viewport.dataset.cameraZoom) === 1
        );
      },
      { timeout },
    );
  } catch (error) {
    // A stale or wrong-mode build under the e2e server is the usual reason for getting here.
    throw new Error(`could not reach a centred board at ${page.url()}: ${String(error)}`);
  }
}

/** Navigate to the board and wait until the starting point is centred. */
export async function gotoBoard(page: Page): Promise<void> {
  await page.goto('/');
  await waitForCentredBoard(page);
}

/**
 * The zoom values `+` produces, one per click, exactly as `zoomStep` computes them:
 * multiply by ZOOM_STEP_FACTOR, clamped to ZOOM_MAX.
 */
export function zoomLadder(startZoom = 1, targetZoom = ZOOM_MAX): number[] {
  const ladder: number[] = [];
  let zoom = startZoom;
  while (zoom < targetZoom) {
    zoom = Math.min(zoom * ZOOM_STEP_FACTOR, targetZoom);
    ladder.push(zoom);
  }
  return ladder;
}

/** Click `+` (or `-`) and wait for the camera to reach the expected zoom. */
export async function clickZoom(
  page: Page,
  direction: 'in' | 'out',
  expectedZoom: number,
): Promise<void> {
  const button = page.locator(
    direction === 'in' ? '[data-testid="zoom-in"]' : '[data-testid="zoom-out"]',
  );
  await expect(button).toBeEnabled();
  await button.click();
  await expect
    .poll(async () => Math.abs((await readCamera(page)).zoom - expectedZoom) < 1e-9, {
      timeout: 10_000,
    })
    .toBe(true);
}

/** Step with `+` until it is disabled; returns the zoom it stopped at. */
export async function stepToMaxZoom(page: Page): Promise<number> {
  for (const zoom of zoomLadder()) {
    await clickZoom(page, 'in', zoom);
  }
  const camera = await readCamera(page);
  return camera.zoom;
}

/* ---------------------------------------------------------------------------
 * Story 2: sticky notes.
 * ------------------------------------------------------------------------ */

/** One sticky as the document holds it. */
export interface NoteRecord {
  readonly id: string;
  readonly type: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly color: string;
  readonly text: string;
  readonly createdAt: number;
}

/**
 * The board document, read through the test-only `boardDoc()` hook and serialised the
 * way `snapshot()` would see it, sorted by (z, id).
 */
export async function boardNotes(page: Page): Promise<NoteRecord[]> {
  const notes = await page.evaluate(() => {
    const doc = window.__vidi6?.boardDoc?.();
    if (!doc) throw new Error('test hook window.__vidi6.boardDoc() is missing');
    const objects = doc.getMap('objects').toJSON() as Record<string, Record<string, unknown>>;
    return Object.entries(objects).map(([id, value]) => ({
      id,
      type: String(value.type),
      x: Number(value.x),
      y: Number(value.y),
      z: Number(value.z),
      color: String(value.color),
      text: String(value.text),
      createdAt: Number(value.createdAt),
    }));
  });
  return notes.sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : 1));
}

export async function waitForNoteCount(page: Page, count: number): Promise<NoteRecord[]> {
  let notes: NoteRecord[] = [];
  await expect
    .poll(async () => (await boardNotes(page)).length, { timeout: 10_000 })
    .toBe(count);
  notes = await boardNotes(page);
  return notes;
}

/** The note's box on screen, in CSS pixels. */
export async function noteRect(page: Page, id: string): Promise<Rect> {
  const box = await page.locator(`[data-note-id="${id}"]`).boundingBox();
  if (!box) throw new Error(`note ${id} has no bounding box (is it on screen?)`);
  return {
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    centerX: box.x + box.width / 2,
    centerY: box.y + box.height / 2,
  };
}

export async function noteCount(page: Page): Promise<number> {
  return (await boardNotes(page)).length;
}

/** Click the Sticky note button in the left toolbar. */
export async function clickStickyNoteButton(page: Page): Promise<void> {
  await page.locator('[data-testid="create-sticky"]').click();
}

/** Click a colour swatch in the note toolbar, by colour name. */
export async function clickSwatch(page: Page, colour: string): Promise<void> {
  const label = `${colour.slice(0, 1).toUpperCase()}${colour.slice(1)} colour`;
  await page.locator(`button[aria-label="${label}"]`).click();
}

/** The note's text layer: its computed font size and whether its text is clipped. */
export async function noteTextMetrics(page: Page, id: string): Promise<{
  fontPx: number;
  scrollHeight: number;
  clientHeight: number;
  overflowY: string;
  faded: boolean;
  fadeClass: boolean;
}> {
  return page.evaluate((noteId) => {
    const note = document.querySelector<HTMLElement>(`[data-note-id="${noteId}"]`);
    if (!note) throw new Error(`no note element for id ${noteId}`);
    const content = note.querySelector<HTMLElement>('[data-testid="sticky-text"]');
    if (!content) throw new Error(`no text layer in note ${noteId}`);
    const fade = note.querySelector<HTMLElement>('[data-testid="sticky-fade"]');
    const style = getComputedStyle(content);
    return {
      fontPx: Number.parseFloat(style.fontSize),
      scrollHeight: content.scrollHeight,
      clientHeight: content.clientHeight,
      overflowY: style.overflowY,
      faded: !!fade,
      fadeClass: !!fade && fade.className.split(' ').includes('vidi6-sticky-fade'),
    };
  }, id);
}

/** Which note (if any) is painted at a screen point: proves stacking order. */
export async function noteIdAtPoint(page: Page, x: number, y: number): Promise<string | null> {
  return page.evaluate(
    ([pointX, pointY]) => {
      const element = document.elementFromPoint(pointX, pointY);
      const note = element?.closest<HTMLElement>('[data-note-id]') ?? null;
      return note?.dataset.noteId ?? null;
    },
    [x, y],
  );
}

/** Press, move in steps and release, leaving the button down state settled. */
export async function dragPointer(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 8,
): Promise<void> {
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
