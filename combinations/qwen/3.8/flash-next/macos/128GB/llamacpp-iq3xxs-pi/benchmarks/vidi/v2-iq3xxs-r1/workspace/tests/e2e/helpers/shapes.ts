import { expect, type Page } from '@playwright/test';
import { E2E_EVENTUAL_TIMEOUT_MS } from '../../../src/shared/config';
import type { ConnectorSnap, Endpoint } from '../../../src/shared/objects/connector';
import type { ShapeSnap } from '../../../src/shared/objects/shape';
import type { ShapeKind } from '../../../src/shared/config';
import { markerCenter, type Box } from './board';
import { CHECKOUT_FLOW_SHAPES, checkoutFlowConnectorSeeds } from '../../fixtures/checkout-flow';

/**
 * Story 10 browser helpers.
 *
 * Two views of the same arrow are needed constantly: the numbers in the shared
 * document (`getShapes` / `getConnectors`), and where the board actually painted it
 * (`[data-shape-id]` / `[data-connector-id]` boxes). The bridge between them is the
 * camera — the origin crosshair sits at world (0,0), so a world point is that
 * crosshair plus the point scaled by the zoom.
 */

export interface Camera {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

export function getCamera(page: Page): Promise<Camera> {
  return page.evaluate(() => window.__vidi6!.getCamera());
}

/** Screen position of a world point (CSS pixels from the viewport's top-left). */
export async function worldToScreen(page: Page, at: { x: number; y: number }): Promise<Box> {
  const origin = await markerCenter(page);
  const cam = await getCamera(page);
  return { x: origin.x + at.x * cam.zoom, y: origin.y + at.y * cam.zoom };
}

/** The world point under a screen position. */
export async function screenToWorld(page: Page, at: Box): Promise<{ x: number; y: number }> {
  const origin = await markerCenter(page);
  const cam = await getCamera(page);
  return { x: (at.x - origin.x) / cam.zoom, y: (at.y - origin.y) / cam.zoom };
}

// --- Snapshots through the test-only hook -----------------------------------

export function shapeSnapshots(page: Page): Promise<readonly ShapeSnap[]> {
  return page.evaluate(() => window.__vidi6!.getShapes());
}

export function connectorSnapshots(page: Page): Promise<readonly ConnectorSnap[]> {
  return page.evaluate(() => window.__vidi6!.getConnectors());
}

export async function shapeById(page: Page, id: string): Promise<ShapeSnap | undefined> {
  return (await shapeSnapshots(page)).find((shape) => shape.id === id);
}

export async function connectorById(page: Page, id: string): Promise<ConnectorSnap | undefined> {
  return (await connectorSnapshots(page)).find((connector) => connector.id === id);
}

/** Wait until this screen shows `count` shapes, and hand them back. */
export async function waitForShapes(page: Page, count: number): Promise<readonly ShapeSnap[]> {
  await expect
    .poll(async () => (await shapeSnapshots(page)).length, { timeout: E2E_EVENTUAL_TIMEOUT_MS })
    .toBe(count);
  return shapeSnapshots(page);
}

/** Wait until this screen shows `count` arrows, and hand them back. */
export async function waitForConnectors(page: Page, count: number): Promise<readonly ConnectorSnap[]> {
  await expect
    .poll(async () => (await connectorSnapshots(page)).length, { timeout: E2E_EVENTUAL_TIMEOUT_MS })
    .toBe(count);
  return connectorSnapshots(page);
}

/** Wait until the arrow is drawn on this screen at all. */
export async function expectConnectorOnScreen(page: Page, id: string): Promise<void> {
  await expect(page.locator(`[data-connector-id="${id}"]`)).toHaveCount(1);
}

export async function expectConnectorGone(page: Page, id: string): Promise<void> {
  await expect
    .poll(async () => (await connectorById(page, id)) === undefined, { timeout: E2E_EVENTUAL_TIMEOUT_MS })
    .toBe(true);
}

/**
 * Wait until this screen's copy of the arrow runs between the given world points, and
 * report how long that took (a caller logs it against the delivery budget).
 */
export async function waitForArrowEnds(
  page: Page,
  id: string,
  ends: { from: { x: number; y: number }; to: { x: number; y: number } },
  tolerance = 0.5,
): Promise<number> {
  const started = Date.now();
  await expect
    .poll(
      async () => {
        const connector = await connectorById(page, id);
        if (!connector) return 'missing';
        const { from, to } = connector.ends;
        if (!near(from, ends.from, tolerance) || !near(to, ends.to, tolerance)) {
          return `${Math.round(from.x)},${Math.round(from.y)} -> ${Math.round(to.x)},${Math.round(to.y)}`;
        }
        return 'ends';
      },
      { timeout: E2E_EVENTUAL_TIMEOUT_MS },
    )
    .toBe('ends');
  return Date.now() - started;
}

const near = (a: { x: number; y: number }, b: { x: number; y: number }, tol: number): boolean =>
  Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol;

/** An arrow end as it is stored: attached to an object, or a fixed point. */
export function endpointKind(endpoint: Endpoint): 'attached' | 'free' {
  return endpoint.kind;
}

// --- Fixtures through the test-only hook ------------------------------------

/** The story's checkout flow: four labelled shapes and four arrows. */
export async function seedCheckoutFlow(page: Page): Promise<{ shapes: string[]; connectors: string[] }> {
  const shapes = await page.evaluate(
    (specs) => window.__vidi6!.seedShapes(specs),
    CHECKOUT_FLOW_SHAPES.map((spec) => ({ ...spec })),
  );
  const connectors = await page.evaluate(
    (specs) => window.__vidi6!.seedConnectors(specs),
    checkoutFlowConnectorSeeds(shapes),
  );
  await waitForShapes(page, shapes.length);
  await waitForConnectors(page, connectors.length);
  return { shapes, connectors };
}

/** The two shapes a connector test needs, at known places, ids in order. */
export const PAIR = {
  /** Left-hand shape: world x -300..-100, centred at (-200, 10). */
  a: { x: -300, y: -50, width: 200, height: 120 },
  /** Right-hand shape: world x 100..300, centred at (200, 10). */
  b: { x: 100, y: -50, width: 200, height: 120 },
} as const;

export async function seedPair(page: Page): Promise<{ a: string; b: string }> {
  const ids = await page.evaluate((specs) => window.__vidi6!.seedShapes(specs), [
    { ...PAIR.a, kind: 'rect' as const, label: 'A' },
    { ...PAIR.b, kind: 'rect' as const, label: 'B' },
  ]);
  await waitForShapes(page, 2);
  return { a: ids[0]!, b: ids[1]! };
}

// --- Real pointer work -------------------------------------------------------

const centreOf = (rect: { x: number; y: number; width: number; height: number }): Box => ({
  x: rect.x + rect.width / 2,
  y: rect.y + rect.height / 2,
});

/** The box the board actually painted for a shape, in CSS pixels. */
export async function shapeBox(page: Page, id: string): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await page.locator(`[data-shape-id="${id}"]`).boundingBox();
  if (!box) throw new Error(`shape ${id} is not on screen`);
  return box;
}

/** A shape's own box on screen, from the document's world rectangle. */
export async function shapeBoxOfWorldRect(page: Page, rect: { x: number; y: number; width: number; height: number }) {
  const tl = await worldToScreen(page, { x: rect.x, y: rect.y });
  const cam = await getCamera(page);
  return { x: tl.x, y: tl.y, width: rect.width * cam.zoom, height: rect.height * cam.zoom };
}

/** Choose a tool with its shortcut (the board must have focus, not a text box). */
export async function pressTool(page: Page, key: 's' | 'l' | 'v' | 'n'): Promise<void> {
  await page.keyboard.press(key);
}

/** Pick the kind of shape the Shape tool will draw. */
export async function selectShapeKind(page: Page, kind: ShapeKind): Promise<void> {
  await page.getByTestId(`tool-shape-kind-${kind}`).click();
}

/** Drag with the Shape tool: press `from`, move to `to` (screen pixels), release. */
export async function drawShapeDrag(
  page: Page,
  from: Box,
  to: Box,
  options: { shift?: boolean; kind?: ShapeKind } = {},
): Promise<void> {
  await pressTool(page, 's');
  if (options.kind) await selectShapeKind(page, options.kind);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  if (options.shift) await page.keyboard.down('Shift');
  await page.mouse.move(to.x, to.y, { steps: 10 });
  if (options.shift) await page.keyboard.up('Shift');
  await page.mouse.up();
}

/** Click without dragging, with the Shape tool. */
export async function drawShapeClick(page: Page, at: Box, options: { kind?: ShapeKind } = {}): Promise<void> {
  await pressTool(page, 's');
  if (options.kind) await selectShapeKind(page, options.kind);
  await page.mouse.click(at.x, at.y);
}

/** Drag an arrow from one screen point to another with the Connector tool. */
export async function drawConnectorDrag(page: Page, from: Box, to: Box): Promise<void> {
  await pressTool(page, 'l');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
}

/** Click a shape to select it (or to make its handles appear). */
export async function clickShape(page: Page, id: string): Promise<void> {
  const box = await shapeBox(page, id);
  await page.mouse.click(centreOf(box).x, centreOf(box).y);
}

/** Drag a shape to a new place with the Select tool (a whole-object move). */
export async function dragShape(page: Page, id: string, to: { x: number; y: number }): Promise<void> {
  const box = await shapeBox(page, id);
  const start = centreOf(box);
  const target = await worldToScreen(page, to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 12 });
  await page.mouse.up();
}

/** Drag one resize handle of the current selection by a screen offset. */
export async function dragHandle(page: Page, handle: string, dx: number, dy: number): Promise<void> {
  const el = page.getByTestId(`handle-${handle}`);
  await expect(el).toHaveCount(1);
  const box = await el.boundingBox();
  if (!box) throw new Error(`no ${handle} handle on screen`);
  const from = centreOf(box);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 10 });
  await page.mouse.up();
}

/** Drag an arrow's own end handle to another screen point. */
export async function dragConnectorEnd(
  page: Page,
  id: string,
  end: 'from' | 'to',
  to: Box,
): Promise<void> {
  const handle = page.locator(`[data-connector-id="${id}"] >> [data-end="${end}"]`);
  await expect(handle).toHaveCount(1);
  const box = await handle.boundingBox();
  if (!box) throw new Error(`arrow ${id} has no draggable ${end} end on screen`);
  await page.mouse.move(centreOf(box).x, centreOf(box).y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
}

// --- Labels ------------------------------------------------------------------

/**
 * How the label was laid out: how many line boxes the browser drew (more than one
 * means it wrapped), and the box of the label itself, which is what centring is
 * measured against.
 */
export async function labelLines(page: Page, id: string): Promise<{
  count: number;
  box: { x: number; y: number; width: number; height: number };
}> {
  return page.evaluate((shapeId) => {
    const inner = document.querySelector(
      `[data-shape-id="${shapeId}"] [data-testid="shape-label-inner"]`,
    );
    if (!inner) throw new Error('shape label missing');
    const range = document.createRange();
    range.selectNodeContents(inner);
    const lines = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
    const box = (inner as HTMLElement).getBoundingClientRect();
    return {
      count: lines.length,
      box: { x: box.x, y: box.y, width: box.width, height: box.height },
    };
  }, id);
}

/** Type into the shape label that is open for editing. */
export async function typeShapeLabel(page: Page, text: string): Promise<void> {
  const editor = page.getByTestId('shape-label-input');
  await expect(editor).toHaveCount(1);
  await editor.type(text, { delay: 5 });
}

/** Double-click a shape to edit its label, type, and leave. */
export async function editLabel(page: Page, id: string, text: string): Promise<void> {
  const box = await shapeBox(page, id);
  const at = centreOf(box);
  await page.mouse.dblclick(at.x, at.y);
  await typeShapeLabel(page, text);
  await page.keyboard.press('Escape');
}

// --- Console errors ----------------------------------------------------------

/** Everything the page complained about, for a test that expects silence. */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  return errors;
}

/**
 * Click the part of a shape that this screen can actually see.
 *
 * The tool rail is an overlay over the left of the board, and a shape parked far left
 * can end up behind it (story 10 dragged one to world x -600, which lands under the rail
 * now that the rail carries an Image button too). A person in that situation picks at an
 * edge of the shape, or pans first; this does the picking, and proves the point it chose
 * was really the shape and not the overlay over it.
 */
export async function clickShapeVisible(page: Page, id: string): Promise<void> {
  const box = await shapeBox(page, id);
  const fractions = [0.5, 0.85, 0.15, 0.98, 0.02];
  const points: Box[] = [];
  for (const fy of fractions) {
    for (const fx of fractions) {
      const x = box.x + fx * box.width;
      const y = box.y + fy * box.height;
      if (x >= 0 && y >= 0 && x <= 1280 && y <= 800) points.push({ x, y });
    }
  }
  if (points.length === 0) throw new Error(`shape ${id} is not on this screen at all`);
  const visible = await page.evaluate(
    ({ shapeId, points }) =>
      points.map(
        (point) =>
          document.elementFromPoint(point.x, point.y)?.closest(`[data-shape-id="${shapeId}"]`) != null,
      ),
    { shapeId: id, points },
  );
  const index = visible.findIndex((hit) => hit);
  if (index < 0) throw new Error(`shape ${id} is fully covered on this screen`);
  await page.mouse.click(points[index]!.x, points[index]!.y);
}
