// E2E tests for story 10 shapes (shape.create_drag, shape.label, shape.style,
// board.click_arrow, conn.delete_detach): TC-24 to TC-26. Runs against the
// `dev:test` server (Vite --mode test), which exposes the window.__vidi6
// hooks. setCamera(0,0,1) makes screen and world coordinates identical.

import { expect, test } from '@playwright/test';
import { openBoard, setCamera } from './helpers/board';
import { seedCheckoutFlow } from '../fixtures/checkout-flow';

type ShapeInfo = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  kind: string;
  fill: string;
  stroke: string;
  label: string;
  z: number;
};

type ConnectorInfo = {
  id: string;
  z: number;
  from: { kind: 'attached'; objectId: string } | { kind: 'free'; x: number; y: number };
  to: { kind: 'attached'; objectId: string } | { kind: 'free'; x: number; y: number };
  fromPoint: { x: number; y: number };
  toPoint: { x: number; y: number };
};

async function getShapes(page: import('@playwright/test').Page): Promise<ShapeInfo[]> {
  return page.evaluate(() => window.__vidi6?.getShapes() ?? []);
}

async function getConnectors(page: import('@playwright/test').Page): Promise<ConnectorInfo[]> {
  return page.evaluate(() => window.__vidi6?.getConnectors() ?? []);
}

test('TC-24: Shape tool drag → shape with label and colour; the toolbar changes fill/stroke', async ({ page }) => {
  await openBoard(page);
  await setCamera(page, 0, 0, 1);

  // S → Shape tool; drag (100,100) → (300,220).
  await page.keyboard.press('s');
  await page.mouse.move(100, 100);
  await page.mouse.down();
  await page.mouse.move(300, 220, { steps: 5 });
  await page.mouse.up();

  const shapes = await getShapes(page);
  expect(shapes).toHaveLength(1);
  const s = shapes[0];
  expect(s.x).toBe(100);
  expect(s.y).toBe(100);
  expect(s.width).toBe(200);
  expect(s.height).toBe(120);
  expect(s.kind).toBe('rect');
  // Defaults: white fill, dark outline, empty label.
  expect(s.fill).toBe('white');
  expect(s.stroke).toBe('dark');
  expect(s.label).toBe('');

  // The created shape is selected: the shape toolbar is shown.
  const toolbar = page.getByTestId('shape-toolbar');
  await expect(toolbar).toBeVisible();

  // Colour: blue fill + red outline.
  await page.getByRole('button', { name: 'Blue fill' }).click();
  await page.getByRole('button', { name: 'Red outline' }).click();

  // Label: double-click the shape and type.
  const shapeEl = page.locator(`[data-testid="shape-object"][data-id="${s.id}"]`);
  await shapeEl.dblclick();
  const input = page.getByTestId('text-editor-input');
  await expect(input).toBeFocused();
  await page.keyboard.type('Checkout');
  await page.keyboard.press('Escape');

  const after = (await getShapes(page))[0];
  expect(after.fill).toBe('blue');
  expect(after.stroke).toBe('red');
  expect(after.label).toBe('Checkout');
  // The rendered label is visible.
  await expect(page.getByTestId('shape-label')).toContainText('Checkout');
});

test('TC-25: arrows follow their shapes when a shape moves', async ({ page }) => {
  await openBoard(page);
  await setCamera(page, 0, 0, 1);
  const flow = await seedCheckoutFlow(page);
  expect(flow).not.toBeNull();
  const [cart, paid] = flow!.shapes;
  const [c1] = flow!.connectors;

  // Before: c1 runs Cart's right anchor (160,80) → Paid's left anchor (300,80).
  let conns = await getConnectors(page);
  const c = conns.find((x) => x.id === c1)!;
  expect(c.fromPoint).toEqual({ x: 160, y: 80 });
  expect(c.toPoint).toEqual({ x: 300, y: 80 });

  // Drag Cart (centre 80,80) to (280,200): the rect moves to (200,120)–(360,280).
  await page.mouse.move(80, 80);
  await page.mouse.down();
  await page.mouse.move(280, 200, { steps: 8 });
  await page.mouse.up();

  const moved = (await getShapes(page)).find((x) => x.id === cart)!;
  expect(moved.x).toBe(200);
  expect(moved.y).toBe(120);

  // The arrow FOLLOWS: the endpoints re-resolve against the new positions.
  // Cart' centre (280,200), Paid centre (380,80): Cart's nearest side to
  // Paid is TOP (|dx|·h = 16000 < |dy|·w = 19200, dy<0) → (280,120);
  // Paid's nearest side to Cart' is BOTTOM → (380,160).
  conns = await getConnectors(page);
  const c2 = conns.find((x) => x.id === c1)!;
  expect(c2.from).toEqual({ kind: 'attached', objectId: cart });
  expect(c2.to).toEqual({ kind: 'attached', objectId: paid });
  expect(c2.fromPoint).toEqual({ x: 280, y: 120 });
  expect(c2.toPoint).toEqual({ x: 380, y: 160 });
});

test('TC-26: deleting a shape detaches its connectors to free endpoints; the free end of a mixed connector survives', async ({
  page,
}) => {
  await openBoard(page);
  await setCamera(page, 0, 0, 1);
  const flow = await seedCheckoutFlow(page);
  expect(flow).not.toBeNull();
  const [cart, , , shipped] = flow!.shapes;
  const [c1, , , c4] = flow!.connectors;

  // c4 is Shipped → FREE(1200,80). Delete Shipped (select + Delete key).
  const shippedEl = page.locator(`[data-testid="shape-object"][data-id="${shipped}"]`);
  await shippedEl.click();
  await page.keyboard.press('Delete');

  // Shipped is gone.
  const shapes = await getShapes(page);
  expect(shapes.find((x) => x.id === shipped)).toBeUndefined();

  const conns = await getConnectors(page);
  expect(conns).toHaveLength(4); // no connector vanished

  // c1 (Cart → Paid) is untouched.
  const c1After = conns.find((x) => x.id === c1)!;
  expect(c1After.from).toEqual({ kind: 'attached', objectId: cart });
  expect(c1After.fromPoint).toEqual({ x: 160, y: 80 });

  // c4: the Shipped end is now FREE at the stored anchor (1060,80); the
  // other end (the original free endpoint) SURVIVES unchanged at (1200,80).
  const c4After = conns.find((x) => x.id === c4)!;
  const ends = [c4After.from, c4After.to];
  expect(ends).toContainEqual({ kind: 'free', x: 1060, y: 80 });
  expect(ends).toContainEqual({ kind: 'free', x: 1200, y: 80 });
});
