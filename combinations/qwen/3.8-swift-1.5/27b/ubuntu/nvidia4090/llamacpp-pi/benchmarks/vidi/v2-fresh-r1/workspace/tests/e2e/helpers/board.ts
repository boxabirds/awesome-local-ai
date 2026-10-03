import type { Page } from '@playwright/test';

/** Centre (page coordinates) of the origin marker at world (0,0). */
export async function originMarkerCenter(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.locator('[data-testid="origin-marker"]').boundingBox();
  if (!box) throw new Error('origin marker is not visible');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** The zoom percentage label text (e.g. "100%"). */
export async function zoomLabelText(page: Page): Promise<string> {
  const text = await page.locator('.zoom-controls__label').textContent();
  return (text ?? '').trim();
}

/** Jump the camera via the test-only hook (test mode builds only). */
export async function setCamera(
  page: Page,
  cam: { x: number; y: number; zoom: number },
): Promise<void> {
  await page.evaluate((c) => window.__vidi6?.setCamera(c), cam);
}

/** Computed dot grid spacing of the board viewport (px). */
export async function gridSpacingPx(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="board-viewport"]') as HTMLElement;
    return parseFloat(getComputedStyle(el).backgroundSize);
  });
}

/** Computed dot grid background-position of the board viewport (px). */
export async function gridBackgroundPosition(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="board-viewport"]') as HTMLElement;
    const [x, y] = (getComputedStyle(el).backgroundPosition ?? '0px 0px')
      .split(' ')
      .map(parseFloat);
    return { x, y };
  });
}

/** Shift+drag a marquee from (x0,y0) to (x1,y1) (screen pixels). */
export async function marqueeSelect(
  page: import('@playwright/test').Page,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Promise<void> {
  await page.keyboard.down('Shift');
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x1, y1, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
}

/** The selection count text ("N selected"), or null when no count bar. */
export async function selectionCountText(
  page: import('@playwright/test').Page,
): Promise<string | null> {
  const el = page.locator('[data-testid="selection-count"]');
  if ((await el.count()) === 0) return null;
  return ((await el.textContent()) ?? '').trim();
}

/** Drag the board by (dx, dy) screen pixels starting at (x, y). */
export async function dragBoard(
  page: Page,
  x: number,
  y: number,
  dx: number,
  dy: number,
): Promise<void> {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 10 });
  await page.mouse.up();
}

/**
 * Dispatch a synthetic Ctrl+wheel over the element at (x, y). Real input
 * with Ctrl held triggers browser page zoom if not prevented; a synthetic
 * event exercises the same DOM handler path (and our preventDefault).
 */
export async function ctrlWheelAt(
  page: Page,
  x: number,
  y: number,
  deltaX: number,
  deltaY: number,
): Promise<void> {
  await page.evaluate(
    ({ x, y, deltaX, deltaY }) => {
      const el = document.elementFromPoint(x, y) as HTMLElement;
      el.dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          deltaX,
          deltaY,
          deltaMode: 0,
          clientX: x,
          clientY: y,
        }),
      );
    },
    { x, y, deltaX, deltaY },
  );
}

/** The board's page-zoom-related state, for no-page-zoom assertions. */
export async function pageZoomState(page: Page): Promise<{ scale: number; dpr: number }> {
  return page.evaluate(() => ({
    scale: window.visualViewport?.scale ?? 1,
    dpr: window.devicePixelRatio,
  }));
}
