import { expect, type Locator, type Page } from '@playwright/test';

export interface ViewportPoint {
  x: number;
  y: number;
}

export function originMarker(page: Page): Locator {
  return page.getByTestId('origin-marker');
}

export async function markerCenter(page: Page): Promise<ViewportPoint> {
  const box = await originMarker(page).boundingBox();
  if (box === null) throw new Error('origin marker has no bounding box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export function zoomLabel(page: Page): Locator {
  return page.getByTestId('zoom-label');
}

export function zoomInButton(page: Page): Locator {
  return page.getByRole('button', { name: 'Zoom in' });
}

export function zoomOutButton(page: Page): Locator {
  return page.getByRole('button', { name: 'Zoom out' });
}

export function resetViewButton(page: Page): Locator {
  return page.getByRole('button', { name: 'Reset view' });
}

export async function setCamera(
  page: Page,
  cam: { x: number; y: number; zoom: number }
): Promise<void> {
  await page.evaluate((camera) => {
    const hook = window.__vidi6;
    if (!hook) throw new Error('window.__vidi6 missing; run the test build (MODE=test)');
    hook.setCamera(camera);
  }, cam);
}

export async function gridBackgroundStyle(page: Page): Promise<{ size: string; position: string }> {
  return page.getByTestId('board-viewport').evaluate((el) => {
    const style = getComputedStyle(el);
    return { size: style.backgroundSize, position: style.backgroundPosition };
  });
}

export function parsePxPair(value: string): [number, number] {
  const parts = value.trim().split(/\s+/).map((part) => parseFloat(part));
  if (parts.length < 2 || parts.some((n) => Number.isNaN(n))) {
    throw new Error(`Cannot parse px pair: ${JSON.stringify(value)}`);
  }
  return [parts[0], parts[1]];
}

export async function dragBy(page: Page, from: ViewportPoint, dx: number, dy: number): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy);
  await page.mouse.up();
}

export async function pageScale(page: Page): Promise<number> {
  return page.evaluate(() => window.visualViewport?.scale ?? 1);
}

export async function waitForMarkerAt(
  page: Page,
  expected: ViewportPoint,
  tolerance: number
): Promise<void> {
  await expect
    .poll(async () => {
      const center = await markerCenter(page);
      return Math.abs(center.x - expected.x) <= tolerance && Math.abs(center.y - expected.y) <= tolerance;
    })
    .toBe(true);
}

export interface NoteState {
  id: string;
  x: number;
  y: number;
  color: string;
  text: string;
  z: number;
}

export async function getNotes(page: Page): Promise<NoteState[]> {
  return page.evaluate(() => {
    const hook = window.__vidi6;
    if (!hook) throw new Error('window.__vidi6 missing; run the test build (MODE=test)');
    return hook.getNotes().map((n) => ({
      id: n.id,
      x: n.x,
      y: n.y,
      color: n.color as string,
      text: n.text,
      z: n.z
    }));
  });
}

export function noteLocator(page: Page, id: string): Locator {
  return page.locator(`[data-testid="sticky-note"][data-id="${id}"]`);
}

// Applies the same mapping as worldToScreen for a camera the test controls.
export function worldToViewport(
  cam: { x: number; y: number; zoom: number },
  p: { x: number; y: number }
): ViewportPoint {
  return { x: (p.x - cam.x) * cam.zoom, y: (p.y - cam.y) * cam.zoom };
}

// Types into the sticky textarea via the native value setter so React's
// onInput handler commits the change (works with large pasted strings).
export async function typeIntoEditor(page: Page, text: string): Promise<void> {
  await page.locator('[data-testid="sticky-textarea"]').evaluate((el, value) => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value'
    )!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, text);
}
