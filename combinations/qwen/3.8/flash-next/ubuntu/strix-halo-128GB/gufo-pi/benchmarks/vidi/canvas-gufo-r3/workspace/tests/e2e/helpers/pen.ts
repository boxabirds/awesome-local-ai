import { Page, Locator } from '@playwright/test';

export function getPenToolButton(page: Page): Locator {
  return page.locator('[data-testid="tool-pen"]');
}

export function getPenToolOverlay(page: Page): Locator {
  return page.locator('[data-testid="pen-tool-overlay"]');
}

export function getPenToolbar(page: Page): Locator {
  return page.locator('[data-testid="pen-toolbar"]');
}

export function getPenPreview(page: Page): Locator {
  return page.locator('[data-testid="pen-preview"]');
}

export function getStrokes(page: Page): Locator {
  return page.locator('[data-testid="stroke-object"]');
}

export function getStrokeWrapper(page: Page, id: string): Locator {
  return page.locator(`[data-testid="stroke-wrapper"][data-stroke-id="${id}"]`);
}

export async function getStrokeIds(page: Page): Promise<string[]> {
  return page.$$eval('[data-testid="stroke-object"]', (els) =>
    els.map((e) => (e as HTMLElement).dataset.strokeId as string),
  );
}

/** Activate pen tool and draw a path by mouse. Returns new stroke id. */
export async function drawWithPen(page: Page, points: { x: number; y: number }[]): Promise<string> {
  const before = await getStrokeIds(page);
  await getPenToolButton(page).click();
  await page.mouse.move(points[0].x, points[0].y);
  await page.mouse.down();
  for (let i = 1; i < points.length; i++) {
    await page.mouse.move(points[i].x, points[i].y);
  }
  await page.mouse.up();
  await page.waitForFunction(
    (prev) => document.querySelectorAll('[data-testid="stroke-object"]').length > prev,
    before.length,
    { timeout: 5000 },
  );
  const ids = await getStrokeIds(page);
  return ids.find((id) => !before.includes(id))!;
}

/** Activate pen tool, select color and thickness, draw. Returns new stroke id. */
export async function drawWithPenOptions(
  page: Page,
  points: { x: number; y: number }[],
  color?: string,
  thickness?: string,
): Promise<string> {
  await getPenToolButton(page).click();
  if (color) await page.locator(`[data-testid="pen-color-${color}"]`).click();
  if (thickness) await page.locator(`[data-testid="pen-thickness-${thickness}"]`).click();
  const before = await getStrokeIds(page);
  await page.mouse.move(points[0].x, points[0].y);
  await page.mouse.down();
  for (let i = 1; i < points.length; i++) {
    await page.mouse.move(points[i].x, points[i].y);
  }
  await page.mouse.up();
  await page.waitForFunction(
    (prev) => document.querySelectorAll('[data-testid="stroke-object"]').length > prev,
    before.length,
    { timeout: 5000 },
  );
  const ids = await getStrokeIds(page);
  return ids.find((id) => !before.includes(id))!;
}

/** Get stroke doc state from Y.Doc via test hook. */
export async function getStrokeDocState(page: Page, id: string) {
  return page.evaluate((strokeId) => {
    const doc = (window as any).__vidi6?.doc;
    if (!doc) return null;
    const objects = doc.getMap('objects');
    const m = objects.get(strokeId);
    if (!m) return null;
    return {
      type: m.get('type'),
      x: m.get('x'),
      y: m.get('y'),
      width: m.get('width'),
      height: m.get('height'),
      baseWidth: m.get('baseWidth'),
      baseHeight: m.get('baseHeight'),
      color: m.get('color'),
      thickness: m.get('thickness'),
      points: m.get('points'),
    };
  }, id);
}
