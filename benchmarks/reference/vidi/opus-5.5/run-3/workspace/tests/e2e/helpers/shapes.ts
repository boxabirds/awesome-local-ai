import type { Page } from '@playwright/test';
import type { Point } from '../../../src/client/canvas/camera';
import type { ShapeSnap } from '../../../src/shared/objects/shape';
import type { ConnectorSnap } from '../../../src/shared/objects/connector';

export async function shapes(page: Page): Promise<ShapeSnap[]> {
  return page.evaluate(
    () => (window.__vidi6!.objects?.() ?? []).filter((o) => o.type === 'shape') as unknown as ShapeSnap[],
  );
}

export async function connectors(page: Page): Promise<ConnectorSnap[]> {
  return page.evaluate(
    () => (window.__vidi6!.objects?.() ?? []).filter((o) => o.type === 'connector') as unknown as ConnectorSnap[],
  );
}

export function shapeById(page: Page, id: string) {
  return page.locator(`[data-shape-id="${id}"]`);
}

export function connectorById(page: Page, id: string) {
  return page.locator(`[data-connector-id="${id}"].connector-object`);
}

/** The arrow's drawn ends as the page renders them (world units). */
export async function drawnEnds(page: Page, id: string): Promise<{ from: Point; to: Point } | null> {
  const el = connectorById(page, id);
  if ((await el.count()) === 0) return null;
  const parse = (v: string | null) => {
    const [x, y] = (v ?? '').split(',').map(Number);
    return { x, y };
  };
  return { from: parse(await el.getAttribute('data-from')), to: parse(await el.getAttribute('data-to')) };
}

export async function centreOfShape(page: Page, id: string): Promise<Point> {
  const box = await shapeById(page, id).boundingBox();
  if (!box) throw new Error(`shape ${id} not rendered`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Real mouse drag in steps (a tool gesture). */
export async function mouseDrag(page: Page, from: Point, to: Point) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 });
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
}
