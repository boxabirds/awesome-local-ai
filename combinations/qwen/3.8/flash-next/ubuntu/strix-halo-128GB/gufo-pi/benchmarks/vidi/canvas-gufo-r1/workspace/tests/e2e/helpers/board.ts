import { expect, type Page } from '@playwright/test';

const ZOOM_LABEL = '[data-testid="zoom-percent"]';
const ORIGIN = '[data-testid="origin-marker"]';
const GRID = '[data-testid="board-grid"]';

export interface Center {
  x: number;
  y: number;
}

export async function gotoBoard(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('[data-testid="board-viewport"]')).toBeVisible();
}

export async function readZoomLabel(page: Page): Promise<string> {
  return (await page.locator(ZOOM_LABEL).textContent()) ?? '';
}

export async function readZoomPercent(page: Page): Promise<number> {
  const text = await readZoomLabel(page);
  return parseInt(text.replace('%', ''), 10);
}

export async function originCenter(page: Page): Promise<Center> {
  const box = await page.locator(ORIGIN).boundingBox();
  if (!box) throw new Error('origin marker not found');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export async function gridSpacingPx(page: Page): Promise<number> {
  return page.locator(GRID).evaluate((el) => {
    const size = (el as HTMLElement).style.backgroundSize; // e.g. "48px 48px"
    return parseFloat(size.split(' ')[0]!);
  });
}

/** Jump the camera with the test-only hook (installed only in the test build). */
export async function setCamera(
  page: Page,
  x: number,
  y: number,
  zoom?: number,
): Promise<void> {
  await page.evaluate(
    ([cx, cy, cz]) => {
      const hooks = (window as unknown as { __vidi6?: { setCamera: (x: number, y: number, z?: number) => void } }).__vidi6;
      if (!hooks) throw new Error('__vidi6 test hook missing (not a test build?)');
      hooks.setCamera(cx, cy, cz ?? undefined);
    },
    [x, y, zoom] as [number, number, number | undefined],
  );
}

export async function pageScale(page: Page): Promise<number> {
  return page.evaluate(() => window.visualViewport?.scale ?? 1);
}

export async function devicePixelRatio(page: Page): Promise<number> {
  return page.evaluate(() => window.devicePixelRatio);
}

/** Drag the board by (dx, dy) starting from a point on empty board space. */
export async function dragBoard(
  page: Page,
  from: Center,
  dx: number,
  dy: number,
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // Two-step move so pointermove events fire with a clear delta.
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 3 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 3 });
  await page.mouse.up();
}
