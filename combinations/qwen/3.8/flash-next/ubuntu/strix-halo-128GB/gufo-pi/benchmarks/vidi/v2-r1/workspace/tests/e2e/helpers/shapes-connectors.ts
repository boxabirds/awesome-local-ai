/**
 * Shared helpers for shapes-connectors e2e tests (story 10).
 */
import { type Page } from '@playwright/test';

export interface ShapeSnapshot {
  id: string;
  kind: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  stroke: string;
  label: string;
  z: number;
}

export interface ConnectorSnapshot {
  id: string;
  from: { kind: string; objectId?: string; x?: number; y?: number };
  to: { kind: string; objectId?: string; x?: number; y?: number };
}

/** Read shape objects from the document via the test hook. */
export async function getShapeObjectsFromDoc(page: Page): Promise<ShapeSnapshot[]> {
  return page.evaluate(() => {
    const doc = window.__vidi6?.getDoc?.();
    if (!doc) throw new Error('__vidi6.getDoc missing');
    const objects = doc.getMap('objects');
    const shapes: ShapeSnapshot[] = [];
    for (const [id, entry] of objects) {
      const type = (entry as any).get?.('type');
      if (type === 'shape') {
        const label = (entry as any).get?.('label');
        shapes.push({
          id,
          kind: (entry as any).get?.('kind') ?? 'rect',
          x: (entry as any).get?.('x'),
          y: (entry as any).get?.('y'),
          width: (entry as any).get?.('width'),
          height: (entry as any).get?.('height'),
          fill: (entry as any).get?.('fill') ?? 'white',
          stroke: (entry as any).get?.('stroke') ?? 'dark',
          label: label?.toString?.() ?? '',
          z: (entry as any).get?.('z') ?? 0,
        });
      }
    }
    return shapes.sort((a, b) => (a.id < b.id ? -1 : 1));
  });
}

/** Read connector objects from the document. */
export async function getConnectorObjectsFromDoc(page: Page): Promise<ConnectorSnapshot[]> {
  return page.evaluate(() => {
    const doc = window.__vidi6?.getDoc?.();
    if (!doc) throw new Error('__vidi6.getDoc missing');
    const objects = doc.getMap('objects');
    const connectors: ConnectorSnapshot[] = [];
    for (const [id, entry] of objects) {
      const type = (entry as any).get?.('type');
      if (type === 'connector') {
        connectors.push({
          id,
          from: (entry as any).get?.('from') ?? { kind: 'free', x: 0, y: 0 },
          to: (entry as any).get?.('to') ?? { kind: 'free', x: 0, y: 0 },
        });
      }
    }
    return connectors.sort((a, b) => (a.id < b.id ? -1 : 1));
  });
}

export function shapeCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const doc = window.__vidi6?.getDoc?.();
    if (!doc) throw new Error('__vidi6.getDoc missing');
    const objects = doc.getMap('objects');
    let n = 0;
    for (const [, entry] of objects) {
      if ((entry as any).get?.('type') === 'shape') n++;
    }
    return n;
  });
}

export function connectorCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const doc = window.__vidi6?.getDoc?.();
    if (!doc) throw new Error('__vidi6.getDoc missing');
    const objects = doc.getMap('objects');
    let n = 0;
    for (const [, entry] of objects) {
      if ((entry as any).get?.('type') === 'connector') n++;
    }
    return n;
  });
}

/** Activate the shape tool via the toolbar button. */
export async function activateShapeTool(page: Page): Promise<void> {
  await page.getByTestId('tool-shape').click();
  await page.waitForTimeout(100);
}

/** Activate the connector tool via the toolbar button. */
export async function activateConnectorTool(page: Page): Promise<void> {
  await page.getByTestId('tool-connector').click();
  await page.waitForTimeout(100);
}

/** Set the shape kind via the kind menu. */
export async function setShapeKind(page: Page, kind: string): Promise<void> {
  await page.getByTestId(`shape-kind-${kind}`).click();
  await page.waitForTimeout(100);
}

/** Drag on the viewport to create a shape. */
export async function createShapeByDrag(
  page: Page,
  start: { x: number; y: number },
  end: { x: number; y: number },
  opts?: { square?: boolean },
): Promise<void> {
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  const steps = 5;
  for (let i = 1; i <= steps; i++) {
    const x = start.x + ((end.x - start.x) * i) / steps;
    const y = start.y + ((end.y - start.y) * i) / steps;
    await page.mouse.move(x, y);
  }
  if (opts?.square) {
    await page.keyboard.down('Shift');
    await page.mouse.move(end.x, end.y);
    await page.keyboard.up('Shift');
  }
  await page.mouse.up();
}

/** Drag from one object to another using the connector tool. */
export async function connectObjectsByDrag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const steps = 5;
  for (let i = 1; i <= steps; i++) {
    const x = from.x + ((to.x - from.x) * i) / steps;
    const y = from.y + ((to.y - from.y) * i) / steps;
    await page.mouse.move(x, y);
  }
  await page.mouse.up();
}

/** Double-click a shape to edit its label. */
export async function dblClickShape(page: Page, shapeId: string): Promise<void> {
  await page.getByTestId(`shape-${shapeId}`).dblclick();
}

/** Type text into the shape label editor. */
export async function typeShapeLabel(page: Page, text: string): Promise<void> {
  await page.locator('[data-testid="shape-editor"]').fill(text);
  await page.locator('[data-testid="shape-editor"]').evaluate((el) => {
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** Press Escape to end shape label editing. */
export async function pressEscape(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
}

/** Click a shape to select it. */
export async function selectShape(page: Page, shapeId: string): Promise<void> {
  await page.getByTestId(`shape-${shapeId}`).click();
}

/** Get the screen rect of a shape object element. */
export async function getShapeScreenRect(page: Page, shapeId: string) {
  return page.getByTestId(`shape-${shapeId}`).evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
}

/** Wait for shapes to stabilize. */
export async function waitForShapesStable(page: Page): Promise<void> {
  let prev = -1;
  for (let i = 0; i < 10; i++) {
    const current = await shapeCount(page);
    if (current === prev) return;
    prev = current;
    await page.waitForTimeout(200);
  }
}

/** Wait for connectors to stabilize. */
export async function waitForConnectorsStable(page: Page): Promise<void> {
  let prev = -1;
  for (let i = 0; i < 10; i++) {
    const current = await connectorCount(page);
    if (current === prev) return;
    prev = current;
    await page.waitForTimeout(200);
  }
}
