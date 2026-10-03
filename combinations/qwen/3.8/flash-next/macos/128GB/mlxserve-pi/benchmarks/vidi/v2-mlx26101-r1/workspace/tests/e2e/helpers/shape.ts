// Shape and arrow helpers for the browser tests (story 10).
//
// Everything here reads the board the way the board itself does: the test handle exposes the
// same model functions the UI calls, and the camera comes from the live board, so a screen
// point in a test is a point a person could actually have clicked. Two rules run through it:
//
//  * Objects are seeded at *screen* points and asserted in world units by converting through
//    that camera — a test that hardcoded world 0,0 into a corner would be a test of the
//    viewport, and the board puts world 0,0 in the middle of the window.
//  * Gestures are real mouse moves on the layer the tool puts up while it is held. The tool
//    layer is what a person's pointer is on: pressing through to the object underneath would
//    be a press the tool never receives in real life.

import { expect, type Page } from '@playwright/test';
import type { Camera } from '../../../src/client/canvas/camera';
import type { Point, Side } from '../../../src/shared/geometry';
import type { ShapeKind, ShapeSnap } from '../../../src/shared/objects/shape';
import type { ConnectorSnap } from '../../../src/shared/objects/connector';
import { sideAnchors } from '../../../src/shared/geometry';

/** The live camera of a page. */
export async function cameraOf(page: Page): Promise<Camera> {
  return page.evaluate(() => {
    const hooks = window.__vidi6;
    if (!hooks) throw new Error('board test hooks missing');
    return hooks.getCamera();
  });
}

/** The screen point a world point is drawn at on this page. */
export async function screenOf(page: Page, p: Point): Promise<Point> {
  const cam = await cameraOf(page);
  return { x: (p.x - cam.x) * cam.zoom, y: (p.y - cam.y) * cam.zoom };
}

/** The world point a screen point falls on. */
export async function worldOf(page: Page, p: Point): Promise<Point> {
  const cam = await cameraOf(page);
  return { x: p.x / cam.zoom + cam.x, y: p.y / cam.zoom + cam.y };
}

/** The board's shapes, as this client's model sees them. */
export function shapesOn(page: Page): Promise<readonly ShapeSnap[]> {
  return page.evaluate(() => {
    const api = window.__vidi6TestBoard;
    if (!api) throw new Error('board test handle missing');
    return api.shapes().map((s) => ({ ...s }));
  });
}

/** The board's arrows, ends resolved to where they draw. */
export function connectorsOn(page: Page): Promise<readonly ConnectorSnap[]> {
  return page.evaluate(() => {
    const api = window.__vidi6TestBoard;
    if (!api) throw new Error('board test handle missing');
    return api.connectors().map((c) => ({ ...c, endpoints: { ...c.endpoints } }));
  });
}

async function missing<T>(what: string, got: T | undefined): Promise<T> {
  if (!got) throw new Error(`${what} is not on this board`);
  return got;
}

export async function shapeOf(page: Page, id: string): Promise<ShapeSnap> {
  const all = await shapesOn(page);
  return missing(`shape ${id}`, all.find((s) => s.id === id));
}

export async function connectorOf(page: Page, id: string): Promise<ConnectorSnap> {
  const all = await connectorsOn(page);
  return missing(`connector ${id}`, all.find((c) => c.id === id));
}

export async function shapeIdsOn(page: Page): Promise<string[]> {
  return (await shapesOn(page)).map((s) => s.id);
}

export async function connectorIdsOn(page: Page): Promise<string[]> {
  return (await connectorsOn(page)).map((c) => c.id);
}

/**
 * Draw shapes centred on given screen points, so they are certain to be on screen and land
 * exactly where asked. `kind` defaults to the kind the toolbar menu starts on.
 */
export async function seedShapesAtScreen(
  page: Page,
  places: readonly ({ x: number; y: number } & { kind?: ShapeKind })[],
): Promise<string[]> {
  const world = await Promise.all(places.map((p) => worldOf(page, p)));
  const ids = await page.evaluate((pts) => {
    const api = window.__vidi6TestBoard;
    if (!api) throw new Error('board test handle missing');
    return pts.map((p) => api.createShape({ x: p.x, y: p.y }, p.kind));
  }, world.map((w, i) => ({ ...w, kind: places[i]?.kind })));
  const clean = ids.map((id) => {
    if (id === null) throw new Error('the model refused a shape it was asked to draw');
    return id;
  });
  for (const id of clean) await expectShapeVisible(page, id);
  return clean;
}

/** The model joins two objects with an arrow; returns its id. */
export async function connectByModel(
  page: Page,
  fromId: string,
  toId: string,
): Promise<string> {
  const id = await page.evaluate(
    ([a, b]) => {
      const api = window.__vidi6TestBoard;
      if (!api) throw new Error('board test handle missing');
      return api.connect(a, b);
    },
    [fromId, toId],
  );
  if (id === null) throw new Error('the model refused the arrow it was asked to join');
  await expect(page.locator(`[data-testid="connector-${id}"]`)).toBeVisible();
  return id;
}

/** The painted box of a shape, in client pixels. */
async function shapeScreenBox(
  page: Page,
  id: string,
): Promise<{ x: number; y: number; w: number; h: number }> {
  const box = await page.locator(`[data-testid="shape-${id}"]`).boundingBox();
  if (!box) throw new Error(`shape ${id} is not drawn`);
  return { x: box.x, y: box.y, w: box.width, h: box.height };
}

/** The painted centre of a shape, in client pixels. */
export async function shapeCenter(page: Page, id: string): Promise<Point> {
  const box = await shapeScreenBox(page, id);
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

/**
 * The screen point of one side of an object: the dot the Connector tool shows there. Computed
 * from the stored box and the live camera, so an assertion about a dot is an assertion about
 * the model and not about a pixel of CSS.
 */
export async function sideScreenPoint(
  page: Page,
  id: string,
  side: Side,
): Promise<Point> {
  const shape = await shapeOf(page, id);
  const anchors = sideAnchors({
    x: shape.x,
    y: shape.y,
    width: shape.width,
    height: shape.height,
  });
  return screenOf(page, anchors[side]);
}






/**
 * Hold a tool by its keyboard letter. The board listens on the window, so a key needs no
 * click first — which matters for a tool: a click would be a press on the board, and with a
 * drawing tool held a press draws something.
 */
export async function pressTool(page: Page, letter: 'V' | 'T' | 'S' | 'L'): Promise<void> {
  await page.keyboard.press(letter);
  await page.waitForTimeout(20);
}

/** The layer a drawing tool puts over the board while it is held. */
export function toolLayer(page: Page, name: 'shape-tool-layer' | 'connector-tool-layer') {
  return page.getByTestId(name);
}

export function toolPressedState(page: Page, name: string): Promise<boolean> {
  return page
    .getByRole('button', { name })
    .evaluate((el) => el.getAttribute('aria-pressed') === 'true');
}

/**
 * A real drag between two screen points: down, four moves, up. Four rather than one so the
 * preview is painted along the way, and the release carries its own position the way a real
 * release does.
 */
export async function dragScreenPoints(
  page: Page,
  from: Point,
  to: Point,
  steps = 4,
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
}

/** The same drag with the steps held apart, so something can happen mid-drag. */
export async function beginDragAt(page: Page, p: Point): Promise<void> {
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
}

export async function moveDragTo(page: Page, p: Point, steps = 3): Promise<void> {
  await page.mouse.move(p.x, p.y, { steps });
}

export async function endDrag(page: Page): Promise<void> {
  await page.mouse.up();
}

/** Wait until the shape the board has does not have a given id any more. */
export async function expectShapeVisible(page: Page, id: string): Promise<void> {
  await expect(page.locator(`[data-testid="shape-${id}"]`)).toBeVisible();
}


/** The kind menu the Shape tool offers, and the kind it says is chosen. */
export async function chosenShapeKind(page: Page): Promise<string | null> {
  const menu = page.getByTestId('shape-kind-menu');
  if ((await menu.count()) === 0) return null;
  const chosen = menu.locator('[aria-checked="true"]');
  return chosen.textContent();
}

/** Pick a shape kind from the Shape tool's menu. */
export async function chooseShapeKind(page: Page, kind: 'Rectangle' | 'Ellipse' | 'Diamond'): Promise<void> {
  await page.getByTestId('shape-kind-menu').getByRole('menuitemradio', { name: kind }).click();
}

/** Select an object by clicking it, whatever kind of object it is. */
export async function clickAtCenter(page: Page, testId: string): Promise<void> {
  await page.getByTestId(testId).click();
}

/** Delete the selection the way a person does: the keyboard, not a button. */
export async function deleteSelection(page: Page): Promise<void> {
  await page.keyboard.press('Delete');
}

/** The shape's painted label text, as it appears on screen. */
export function shapePaintedLabel(page: Page, id: string): Promise<string> {
  return page.evaluate((sid) => {
    const el = document.querySelector(`[data-testid="shape-label-${sid}"]`);
    return el?.textContent ?? '';
  }, id);
}

/** The painted label's centre, so centring can be asserted rather than argued. */
export async function shapePaintedLabelCenter(page: Page, id: string): Promise<Point> {
  const box = await page.locator(`[data-testid="shape-label-${id}"]`).boundingBox();
  if (!box) throw new Error(`shape ${id} draws no label`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}



/** Click a shape, whatever is drawn on top of it. */
export async function clickShape(page: Page, id: string): Promise<void> {
  await page.locator(`[data-testid="shape-${id}"]`).click();
}

/** How many lines the painted label is drawn in, measured, not assumed. */
export async function shapePaintedLabelLines(page: Page, id: string): Promise<number> {
  return page.evaluate((sid) => {
    const el = document.querySelector(
      `[data-testid="shape-label-${sid}"]`,
    ) as HTMLElement | null;
    if (!el) throw new Error(`shape ${sid} draws no label`);
    const style = getComputedStyle(el);
    const lineHeight =
      style.lineHeight === 'normal' ? parseFloat(style.fontSize) * 1.2 : parseFloat(style.lineHeight);
    return el.getBoundingClientRect().height / lineHeight;
  }, id);
}

/** Press a shape in the middle and drag its centre to a screen point. */
export async function dragShapeCenterTo(
  page: Page,
  id: string,
  to: Point,
  steps = 6,
): Promise<void> {
  const at = await shapeCenter(page, id);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
}

/**
 * Where the arrow is actually drawn, in client pixels, read off the painted line. The line
 * carries world coordinates inside a layer the board scales, so this is the picture another
 * person sees, converted through that person's own camera.
 */
export async function connectorPaintedEnds(
  page: Page,
  id: string,
): Promise<{ from: Point; to: Point }> {
  const world = await page.evaluate((cid) => {
    const line = document.querySelector(`[data-testid="connector-line-${cid}"]`);
    if (!line) throw new Error(`arrow ${cid} is not drawn`);
    const num = (name: string) => Number(line.getAttribute(name));
    return {
      from: { x: num('x1'), y: num('y1') },
      to: { x: num('x2'), y: num('y2') },
    };
  }, id);
  return { from: await screenOf(page, world.from), to: await screenOf(page, world.to) };
}


/** How far apart two screen points are. */
function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Both points are the same place on screen, to within a pixel and a half. */
export function samePlace(a: Point, b: Point, tolerance = 1.5): boolean {
  return distance(a, b) <= tolerance;
}

/**
 * Wait for a gesture to have written its shape, and hand back the shape that is new.
 *
 * A mouse event is dispatched and then handled: the page runs the pointerup handler some time
 * after Playwright's `mouse.up()` has returned, so a test that reads the document immediately
 * can read it before the gesture has been carried out. Everything that follows a drag waits
 * here first, which makes the assertion about what was written rather than about how fast the
 * browser is.
 */
export async function waitForNewShape(
  page: Page,
  before: readonly ShapeSnap[],
): Promise<ShapeSnap> {
  const ids = before.map((s) => s.id);
  await expect
    .poll(async () => (await shapesOn(page)).some((s) => !ids.includes(s.id)), {
      message: 'the gesture never wrote a shape',
    })
    .toBe(true);
  const after = await shapesOn(page);
  const fresh = after.filter((s) => !ids.includes(s.id));
  expect(fresh, 'one gesture writes one shape').toHaveLength(1);
  return fresh[0]!;
}

/** The same wait for an arrow: the drag is over when the document says so. */
export async function waitForNewConnector(
  page: Page,
  before: readonly string[],
): Promise<ConnectorSnap> {
  await expect
    .poll(async () => (await connectorIdsOn(page)).some((id) => !before.includes(id)), {
      message: 'the gesture never wrote an arrow',
    })
    .toBe(true);
  const after = await connectorsOn(page);
  const fresh = after.filter((c) => !before.includes(c.id));
  expect(fresh, 'one gesture writes one arrow').toHaveLength(1);
  return fresh[0]!;
}
