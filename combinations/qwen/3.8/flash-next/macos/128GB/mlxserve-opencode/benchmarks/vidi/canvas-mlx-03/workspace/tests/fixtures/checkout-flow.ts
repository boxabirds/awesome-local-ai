// Story 10 e2e fixture: a real checkout flow, drawn through the real UI.
//
// Nothing here writes Yjs bytes. Every shape and every arrow is made the way a person
// makes one — arm the Shape tool, drag the box, choose the kind, type the label; arm the
// Connector tool, drag from one shape to another — so the fixture exercises the same code
// path as a person does, and a fixture that builds is itself a piece of the proof.
//
// The board is laid out in board units inside the part of the board a 1280x800 screen
// shows at the identity camera (board (0, 0) in its top-left), and clear of the toolbar
// and the zoom controls, so every point in the layout is on screen when it is clicked.
// Screen points are always derived from the camera through `screenOf`, never hard-coded,
// because the same board point is a different pixel on a different screen.
import { expect, type Page } from '@playwright/test';
import { originCentre, setCamera } from '../e2e/helpers/board.ts';
import { SHAPE_DEFAULT_SIZE_WORLD, type ShapeKind } from '../../src/shared/config.ts';

export interface Point {
  x: number;
  y: number;
}

/** A shape as the board shows it: world box, kind, label, and its centre on screen. */
export interface ShapeBox {
  id: string;
  kind: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  selected: boolean;
  /** Screen centre, for clicking. */
  cx: number;
  cy: number;
}

/** An arrow as the board draws it: the two points its line is drawn between, in world units. */
export interface ArrowBox {
  id: string;
  from: Point;
  /** The tip of the arrowhead: where the arrow points. */
  to: Point;
  selected: boolean;
}

const DEFAULT_ZOOM = 1;

export const settle = (page: Page, ms = 90) => page.waitForTimeout(ms);

/** The board, at the identity camera: board (0, 0) in the top-left of the viewport. */
export async function openFlowBoard(page: Page): Promise<void> {
  await setCamera(page, { x: 0, y: 0, zoom: DEFAULT_ZOOM });
  await settle(page);
}

/** The board's current zoom, read back off the world layer's transform. */
export async function currentZoom(page: Page): Promise<number> {
  return page.evaluate(() => {
    const layer = document.querySelector('[data-testid="world-layer"]') as HTMLElement | null;
    const m = /scale\(([\d.]+)\)/.exec(layer?.style.transform ?? '');
    return m ? parseFloat(m[1]!) : 1;
  });
}

/** The screen point of a world point, at the camera the board is showing. */
export async function screenOf(page: Page, world: Point): Promise<Point> {
  const origin = await originCentre(page);
  const zoom = await currentZoom(page);
  return { x: origin.x + world.x * zoom, y: origin.y + world.y * zoom };
}

/** The world point under a screen point, at the camera the board is showing. */
export async function worldOfScreen(page: Page, screen: Point): Promise<Point> {
  const origin = await originCentre(page);
  const zoom = await currentZoom(page);
  return { x: (screen.x - origin.x) / zoom, y: (screen.y - origin.y) / zoom };
}

/** Every shape on the board, in stacking order. */
export async function shapesOn(page: Page): Promise<ShapeBox[]> {
  return page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('[data-shape-id]')) as HTMLElement[];
    return els.map((el) => {
      const r = el.getBoundingClientRect();
      return {
        id: el.dataset.shapeId ?? '',
        kind: el.dataset.kind ?? '',
        x: parseFloat(el.style.left),
        y: parseFloat(el.style.top),
        w: parseFloat(el.style.width),
        h: parseFloat(el.style.height),
        label: (el.querySelector('[data-testid="shape-label-text"]')?.textContent ?? '').trim(),
        selected: el.dataset.selected === 'true',
        cx: r.x + r.width / 2,
        cy: r.y + r.height / 2,
      };
    });
  });
}

export async function shapeCount(page: Page): Promise<number> {
  return (await shapesOn(page)).length;
}

/** The shape whose label starts with `text`, or undefined. */
export async function shapeByLabel(page: Page, text: string): Promise<ShapeBox | undefined> {
  return (await shapesOn(page)).find((s) => s.label.startsWith(text));
}

/** Every arrow on the board, with the world points it is drawn between. */
export async function arrowsOn(page: Page): Promise<ArrowBox[]> {
  return page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('[data-connector-id]')) as Element[];
    return els.map((el) => {
      const line = el.querySelector('[data-testid="connector-line"]');
      const head = el.querySelector('[data-testid="connector-head"]');
      const attr = (n: Element | null, a: string) => Number(n?.getAttribute(a) ?? '0');
      const tip = (head?.getAttribute('points') ?? '0,0').split(' ')[0]!.split(',');
      return {
        id: (el as HTMLElement).dataset.connectorId ?? '',
        from: { x: attr(line, 'x1'), y: attr(line, 'y1') },
        to: { x: Number(tip[0]), y: Number(tip[1]) },
        selected: (el as HTMLElement).dataset.selected === 'true',
      };
    });
  });
}

export async function arrowCount(page: Page): Promise<number> {
  return (await arrowsOn(page)).length;
}

/** The arrow with this id, or undefined. */
export async function arrowById(page: Page, id: string): Promise<ArrowBox | undefined> {
  return (await arrowsOn(page)).find((a) => a.id === id);
}

/** A left-button drag between two screen points, with real intermediate moves. */
export async function dragTo(page: Page, from: Point, to: Point): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 8 });
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  await settle(page);
}

/** Arm a tool by its letter and wait for the board to switch. */
export async function armTool(page: Page, letter: 'v' | 't' | 's' | 'l'): Promise<void> {
  await page.keyboard.press(letter);
  await settle(page);
}

/** Choose the kind the Shape tool will draw next, from the tool's own menu. */
export async function chooseShapeKind(page: Page, kind: ShapeKind): Promise<void> {
  await page.getByTestId(`shape-kind-${kind}`).click();
  await settle(page);
}

/**
 * Draw a shape by dragging its box (shape.create_drag), and return its id.
 * The box is given in world units; the drag is performed in screen pixels.
 */
export async function drawShape(
  page: Page,
  box: { x: number; y: number; width: number; height: number },
  kind: ShapeKind = 'rect',
): Promise<string> {
  const before = await shapesOn(page);
  await armTool(page, 's');
  if (kind !== 'rect') await chooseShapeKind(page, kind);
  await dragTo(page, await screenOf(page, { x: box.x, y: box.y }), await screenOf(page, { x: box.x + box.width, y: box.y + box.height }));
  const created = (await shapesOn(page)).find((s) => !before.some((b) => b.id === s.id));
  if (!created) throw new Error(`drawing a ${kind} at ${box.x},${box.y} created no shape`);
  return created.id;
}

/**
 * Create a shape with a single click (shape.create_click): the default size, centred on
 * the point that was clicked.
 */
export async function clickShape(page: Page, at: Point, kind: ShapeKind = 'rect'): Promise<string> {
  const before = await shapesOn(page);
  await armTool(page, 's');
  if (kind !== 'rect') await chooseShapeKind(page, kind);
  const screen = await screenOf(page, at);
  await page.mouse.click(screen.x, screen.y);
  await settle(page);
  const created = (await shapesOn(page)).find((s) => !before.some((b) => b.id === s.id));
  if (!created) throw new Error(`clicking with the Shape tool created no ${kind}`);
  return created.id;
}

/**
 * Type a shape's label: select it, press Enter to open the label editor, type, Escape.
 * (Enter is the board's own route into the text of the one selected object.)
 */
export async function labelShape(page: Page, id: string, text: string): Promise<void> {
  const shape = (await shapesOn(page)).find((s) => s.id === id);
  if (!shape) throw new Error(`no shape ${id} to label`);
  await armTool(page, 'v');
  await page.mouse.click(shape.cx, shape.cy);
  await settle(page);
  await page.keyboard.press('Enter');
  await settle(page);
  await page.keyboard.type(text);
  await settle(page);
  await page.keyboard.press('Escape');
  await settle(page);
}

/**
 * Connect two objects with the Connector tool (connector.create) and return the arrow's
 * id. With `to` given, the drag ends over empty board at that world point, which leaves a
 * free end (connector.free_end).
 */
export async function connect(
  page: Page,
  fromId: string,
  toId?: string,
  freeEnd?: Point,
): Promise<string> {
  const before = await arrowsOn(page);
  const shapes = await shapesOn(page);
  const from = shapes.find((s) => s.id === fromId);
  if (!from) throw new Error(`no shape ${fromId} to start from`);
  const start = { x: from.cx, y: from.cy };
  let end: Point;
  if (toId) {
    const to = shapes.find((s) => s.id === toId);
    if (!to) throw new Error(`no shape ${toId} to connect to`);
    end = { x: to.cx, y: to.cy };
  } else if (freeEnd) {
    end = await screenOf(page, freeEnd);
  } else {
    throw new Error('connect needs a target shape or a free end point');
  }
  await armTool(page, 'l');
  await dragTo(page, start, end);
  const created = (await arrowsOn(page)).find((a) => !before.some((b) => b.id === a.id));
  if (!created) throw new Error(`dragging from ${fromId} created no arrow`);
  return created.id;
}

/** Move a shape by dragging it with the Select tool (what story 7 does). */
export async function moveShape(page: Page, id: string, to: Point): Promise<void> {
  const shape = (await shapesOn(page)).find((s) => s.id === id);
  if (!shape) throw new Error(`no shape ${id} to move`);
  await armTool(page, 'v');
  await dragTo(page, { x: shape.cx, y: shape.cy }, await screenOf(page, to));
}

/** Select a shape with a plain click. */
export async function selectShape(page: Page, id: string): Promise<void> {
  const shape = (await shapesOn(page)).find((s) => s.id === id);
  if (!shape) throw new Error(`no shape ${id} to select`);
  await armTool(page, 'v');
  await page.mouse.click(shape.cx, shape.cy);
  await settle(page);
}

/** Select an arrow by clicking its line, half way along it. */
export async function selectArrow(page: Page, id: string): Promise<void> {
  const arrow = await arrowById(page, id);
  if (!arrow) throw new Error(`no arrow ${id} to select`);
  await armTool(page, 'v');
  const mid = await screenOf(page, { x: (arrow.from.x + arrow.to.x) / 2, y: (arrow.from.y + arrow.to.y) / 2 });
  await page.mouse.click(mid.x, mid.y);
  await settle(page);
}

/** The click tolerance of the board, in world units at the zoom it is showing. */
export async function worldClickTolerance(page: Page): Promise<number> {
  return 6 / (await currentZoom(page)); // CONNECTOR_HIT_TOLERANCE_PX screen pixels
}

/** How a rendered shape label looks: line count and how well it is centred. */
export interface LabelMetrics {
  text: string;
  lines: number;
  /** Screen pixels between the label's centre and the shape's centre. */
  offCentreX: number;
  offCentreY: number;
  labelWidth: number;
  labelHeight: number;
  /** The shape's own box on screen, to check the label fits inside it. */
  shapeWidth: number;
  shapeHeight: number;
  fontPx: number;
}

/** Which side of a shape a point sits on, or 'off' when it is not on its border. */
export function sideOfPoint(p: Point, s: ShapeBox, tolerance = 2): string {
  if (Math.abs(p.x - s.x) <= tolerance && Math.abs(p.y - (s.y + s.h / 2)) <= tolerance) return 'left';
  if (Math.abs(p.x - (s.x + s.w)) <= tolerance && Math.abs(p.y - (s.y + s.h / 2)) <= tolerance) return 'right';
  if (Math.abs(p.y - s.y) <= tolerance && Math.abs(p.x - (s.x + s.w / 2)) <= tolerance) return 'top';
  if (Math.abs(p.y - (s.y + s.h)) <= tolerance && Math.abs(p.x - (s.x + s.w / 2)) <= tolerance) return 'bottom';
  return 'off';
}

/** The size the board gives a shape that was clicked rather than dragged. */
export const DEFAULT_SHAPE_SIZE = SHAPE_DEFAULT_SIZE_WORLD;

// ---------------------------------------------------------------------------
// The checkout-flow fixture
// ---------------------------------------------------------------------------

/** Where the fixture's shapes sit, in board units, and where its free arrow end is pinned. */
export const FLOW_BOXES = {
  /** Row one: the happy path, left to right. */
  addToCart: { x: 100, y: 120, width: 200, height: 120 },
  inStock: { x: 400, y: 120, width: 180, height: 120 },
  /** Row two: what happens next, and the loose end. */
  payNow: { x: 400, y: 420, width: 180, height: 110 },
  backorder: { x: 700, y: 420, width: 200, height: 120 },
} as const;

/** The loose arrow's free end: empty board, so it stays where it was pinned. */
export const FLOW_FREE_END = { x: 150, y: 500 };

/**
 * The fixture board: a four-step checkout flow.
 *
 *   row 1:  [Add to cart] ──→ <In stock?> ──┐
 *                                 │         ↘
 *   row 2:   · ←── (Pay now)   [Backorder email]
 *
 * The arrow that ends on empty board starts at (Pay now) and is pinned to board to its
 * left; the other three are welded to shapes at both ends. Built with real drags on
 * `page`, so the other client sees exactly what a colleague's work looks like.
 */
export interface FlowBoard {
  addToCart: string;
  inStock: string;
  payNow: string;
  backorder: string;
  /** The three arrows attached at both ends, in the order they were drawn. */
  attached: string[];
  /** The arrow with one end on the board. */
  free: string;
}

export async function buildFlowBoard(page: Page): Promise<FlowBoard> {
  await openFlowBoard(page);
  // Every box sits in the part of the board a 1280x800 screen shows at the identity
  // camera, and clear of the toolbar and the zoom controls, so every click the fixture
  // makes lands on the board.
  const addToCart = await drawShape(page, FLOW_BOXES.addToCart, 'rect');
  const inStock = await drawShape(page, FLOW_BOXES.inStock, 'diamond');
  const payNow = await drawShape(page, FLOW_BOXES.payNow, 'ellipse');
  const backorder = await drawShape(page, FLOW_BOXES.backorder, 'rect');
  await labelShape(page, addToCart, 'Add to cart');
  await labelShape(page, inStock, 'In stock?');
  await labelShape(page, payNow, 'Pay now');
  await labelShape(page, backorder, 'Backorder email');
  const attached = [
    await connect(page, addToCart, inStock),
    await connect(page, inStock, payNow),
    await connect(page, inStock, backorder),
  ];
  const free = await connect(page, payNow, undefined, FLOW_FREE_END);
  await expect.poll(() => arrowCount(page), { timeout: 5000 }).toBe(attached.length + 1);
  return { addToCart, inStock, payNow, backorder, attached, free };
}
