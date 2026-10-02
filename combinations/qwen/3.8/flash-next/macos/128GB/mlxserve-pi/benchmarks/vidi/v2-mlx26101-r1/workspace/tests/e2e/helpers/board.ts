import { expect, type Locator, type Page } from '@playwright/test';
import type { Camera } from '../../../src/client/canvas/camera';

/** Move to the app and wait for the board surface to be present. */
export async function gotoBoard(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('board-viewport')).toBeVisible();
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
export function resetButton(page: Page): Locator {
  return page.getByRole('button', { name: 'Reset view' });
}

/** Current zoom as a whole-number percent read from the label. */
export async function zoomPercent(page: Page): Promise<number> {
  const text = (await zoomLabel(page).textContent()) ?? '';
  return parseInt(text.replace('%', '').trim(), 10);
}

/** Centre of the origin-marker crosshair in viewport (client) pixels. */
export function markerCenter(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="origin-marker-visual"]');
    if (!el) throw new Error('origin marker missing');
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
}

/** Computed dot-grid background size, e.g. "24px 24px". */
export function backgroundSize(page: Page): Promise<string> {
  return page.evaluate(
    () =>
      getComputedStyle(
        document.querySelector('[data-testid="board-viewport"]') as Element,
      ).backgroundSize,
  );
}

/** Jump the camera directly (test build only) instead of dragging 1e6 px. */
export async function setCamera(page: Page, cam: Camera): Promise<void> {
  await page.evaluate((c) => {
    const hook = (window as unknown as { __vidi6?: { setCamera(c: Camera): void } })
      .__vidi6;
    if (!hook) throw new Error('window.__vidi6 test hook missing');
    hook.setCamera(c);
  }, cam);
}

/** Press a Control/Cmd + `key` chord (e.g. '=', '-', '0'). */
export async function pressChord(page: Page, key: string): Promise<void> {
  await page.keyboard.down('Control');
  await page.keyboard.press(key);
  await page.keyboard.up('Control');
}

/**
 * Perform a zoom-at-pointer gesture at (x, y). Prefers a real Ctrl + wheel with
 * the Control modifier held (proving the trusted path); if the harness does not
 * report a zoom change, falls back to dispatching a wheel event with ctrlKey so
 * the board's own zoom handler is still exercised. Either way the page's own
 * zoom is never touched (asserted separately via visualViewport.scale).
 */
export async function ctrlWheelAt(
  page: Page,
  x: number,
  y: number,
  deltaY: number,
): Promise<void> {
  const before = await zoomPercent(page);
  await page.keyboard.down('Control');
  await page.mouse.move(x, y);
  await page.mouse.wheel(0, deltaY);
  await page.keyboard.up('Control');
  if ((await zoomPercent(page)) === before) {
    await page.evaluate(
      ([cx, cy, d]) => {
        const el =
          document.elementFromPoint(cx, cy) ?? document.querySelector('#root');
        el?.dispatchEvent(
          new WheelEvent('wheel', {
            clientX: cx,
            clientY: cy,
            deltaY: d,
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
          }),
        );
      },
      [x, y, deltaY],
    );
  }
}
