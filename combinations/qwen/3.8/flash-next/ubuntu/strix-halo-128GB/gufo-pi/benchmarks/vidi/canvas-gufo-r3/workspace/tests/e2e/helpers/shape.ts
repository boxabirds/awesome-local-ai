import { Page, Locator } from '@playwright/test';

export function getShapeToolButton(page: Page): Locator {
  return page.locator('[data-testid="tool-shape"]');
}
export function getConnectorToolButton(page: Page): Locator {
  return page.locator('[data-testid="tool-connector"]');
}
export function getSelectToolButton(page: Page): Locator {
  return page.locator('[data-testid="tool-select"]');
}
export function getShapeToolOverlay(page: Page): Locator {
  return page.locator('[data-testid="shape-tool-overlay"]');
}
export function getConnectorToolOverlay(page: Page): Locator {
  return page.locator('[data-testid="connector-tool-overlay"]');
}
export function getShapes(page: Page): Locator {
  return page.locator('[data-testid="shape-object"]');
}
export function getShapeWrapper(page: Page, id: string): Locator {
  return page.locator(`[data-testid="shape-wrapper"][data-shape-id="${id}"]`);
}
export function getShapeText(page: Page, id: string): Locator {
  return page.locator(`[data-testid="shape-object"][data-shape-id="${id}"] [data-testid="shape-label"]`);
}
export async function getShapeIds(page: Page): Promise<string[]> {
  return page.$$eval('[data-testid="shape-object"]', (els) =>
    els.map((e) => (e as HTMLElement).dataset.shapeId as string),
  );
}

/** Activate the shape tool and click an empty point → default-size shape. Returns new id. */
export async function createShapeByClick(page: Page, x: number, y: number): Promise<string> {
  const before = await getShapeIds(page);
  await getShapeToolButton(page).click();
  await page.mouse.click(x, y);
  await page.waitForFunction(
    (prev) => document.querySelectorAll('[data-testid="shape-object"]').length > prev,
    before.length,
  );
  const ids = await getShapeIds(page);
  return ids.find((id) => !before.includes(id))!;
}

/** Activate the shape tool, pick a kind, then drag a rect. Returns new id. */
export async function createShapeByDrag(
  page: Page,
  kind: 'rect' | 'ellipse' | 'diamond',
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Promise<string> {
  const before = await getShapeIds(page);
  await getShapeToolButton(page).click();
  await page.locator(`[data-testid="shape-kind-${kind}"]`).click();
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 5 });
  await page.mouse.move(x1, y1, { steps: 5 });
  await page.mouse.up();
  await page.waitForFunction(
    (prev) => document.querySelectorAll('[data-testid="shape-object"]').length > prev,
    before.length,
  );
  const ids = await getShapeIds(page);
  return ids.find((id) => !before.includes(id))!;
}

/** Click a shape to select it, press Enter to edit the label, type, then Escape. */
export async function labelShape(page: Page, id: string, text: string): Promise<void> {
  const box = await getShapeWrapper(page, id).boundingBox();
  if (!box) throw new Error(`shape ${id} not visible`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.press('Enter');
  await page.keyboard.type(text);
  await page.keyboard.press('Escape');
}

export async function getShapeScreenBox(page: Page, id: string) {
  const box = await getShapeWrapper(page, id).boundingBox();
  if (!box) throw new Error(`shape ${id} not visible`);
  return box;
}

export async function getShapeDocState(
  page: Page,
  id: string,
): Promise<{ kind: string; fill: string; stroke: string; x: number; y: number; width: number; height: number; label: string } | null> {
  return page.evaluate((objId) => {
    const doc = (window as any).__vidi6?.doc;
    if (!doc) return null;
    const m = doc.getMap('objects').get(objId) as any;
    if (!m || m.get('type') !== 'shape') return null;
    const label = m.get('label');
    return {
      kind: m.get('kind'),
      fill: m.get('fill'),
      stroke: m.get('stroke'),
      x: m.get('x'),
      y: m.get('y'),
      width: m.get('width'),
      height: m.get('height'),
      label: label ? label.toString() : '',
    };
  }, id);
}

export function getConnectorWrappers(page: Page): Locator {
  return page.locator('[data-testid="connector-wrapper"]');
}
export function getConnectorLine(page: Page, id: string): Locator {
  return page.locator(`[data-testid="connector-wrapper"][data-connector-id="${id}"] [data-testid="connector-line"]`);
}
export async function getConnectorIds(page: Page): Promise<string[]> {
  return page.$$eval('[data-testid="connector-wrapper"]', (els) =>
    els.map((e) => (e as HTMLElement).dataset.connectorId as string),
  );
}

export type SeedEndpoint =
  | { kind: 'attached'; objectId: string; fallback: { x: number; y: number } }
  | { kind: 'free'; x: number; y: number };

/** Seed a shape via the test hook. */
export async function seedShape(
  page: Page,
  kind: 'rect' | 'ellipse' | 'diamond',
  rect: { x: number; y: number; width: number; height: number },
): Promise<string> {
  const id = await page.evaluate(([k, r]) => (window as any).__vidi6!.testCreateShape!(k, r, 'tester'), [kind, rect] as const);
  await page.waitForFunction(
    (sid) => document.querySelector(`[data-testid="shape-wrapper"][data-shape-id="${sid}"]`) !== null,
    id,
  );
  return id;
}

/** Seed a connector via the test hook. */
export async function seedConnector(page: Page, from: SeedEndpoint, to: SeedEndpoint): Promise<string> {
  const id = await page.evaluate(
    ([f, t]) => (window as any).__vidi6!.testCreateConnector!(f, t, 'tester'),
    [from, to] as const,
  );
  await page.waitForFunction(
    (cid) => document.querySelector(`[data-testid="connector-wrapper"][data-connector-id="${cid}"]`) !== null,
    id,
  );
  return id;
}

/** Read the connector endpoint kinds from the doc (endpoints stored as Y.Maps). */
export async function getConnectorDocState(page: Page, id: string) {
  return page.evaluate((cid) => {
    const doc = (window as any).__vidi6?.doc;
    if (!doc) return null;
    const m = doc.getMap('objects').get(cid) as any;
    if (!m || m.get('type') !== 'connector') return null;
    const read = (ym: any): SeedEndpoint => {
      const kind = ym.get('kind');
      if (kind === 'free') return { kind: 'free', x: ym.get('x'), y: ym.get('y') };
      return { kind: 'attached', objectId: ym.get('objectId'), fallback: { x: ym.get('fallbackX'), y: ym.get('fallbackY') } };
    };
    return { from: read(m.get('from')), to: read(m.get('to')) };
  }, id);
}

/** Connect two shapes by dragging with the connector tool from the centre of A to the centre of B. */
export async function connectByDrag(page: Page, fromId: string, toId: string): Promise<string> {
  const before = await getConnectorIds(page);
  await getConnectorToolButton(page).click();
  const a = await getShapeScreenBox(page, fromId);
  const b = await getShapeScreenBox(page, toId);
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 5 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 5 });
  await page.mouse.up();
  await page.waitForFunction(
    (prev) => document.querySelectorAll('[data-testid="connector-wrapper"]').length > prev,
    before.length,
  );
  const ids = await getConnectorIds(page);
  return ids.find((id) => !before.includes(id))!;
}

/** Drag a shape (by pointer on its body) by world-space delta using current camera. */
export async function dragShapeBy(page: Page, id: string, worldDx: number, worldDy: number): Promise<void> {
  const cam = await page.evaluate(() => (window as any).__vidi6!.getCamera!());
  const box = await getShapeScreenBox(page, id);
  const sx = box.x + box.width / 2;
  const sy = box.y + box.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + worldDx * cam.zoom, sy + worldDy * cam.zoom, { steps: 8 });
  await page.mouse.up();
}
