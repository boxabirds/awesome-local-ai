// Story-10 browser helpers: shapes and arrows, read the way a person reads them
// — from what is on the screen — and drawn with real mouse gestures, because the
// two things this story is about (a shape drawn by a drag, an arrow that follows
// the shape it is attached to) only mean anything if a pointer did them.
//
// Positions are stated to the tests in board units and to the browser in screen
// pixels; `worldToScreen` from the app's own camera module is the one bridge
// between them, so a test never has to guess where the board is looking.
import { expect, type Page } from '@playwright/test';
import { worldToScreen, type Camera } from '../../../src/client/canvas/camera';
import type { Point } from '../../../src/shared/geometry';
import type { ConnectorSide, ShapeKind } from '../../../src/shared/config';

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface ScreenBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One end of an arrow, where it is drawn and what it is stuck to. */
export interface ArrowEnd {
  x: number;
  y: number;
  kind: string;
}

export interface ArrowState {
  from: ArrowEnd;
  to: ArrowEnd;
  detached: boolean;
}

export const shapeButton = (page: Page) => page.getByRole('button', { name: 'Shape (S)', exact: true });
export const connectorButton = (page: Page) => page.getByRole('button', { name: 'Connector (L)', exact: true });
export const selectButton = (page: Page) => page.getByRole('button', { name: 'Select (V)', exact: true });
export const shapeKindButton = (page: Page, kind: ShapeKind) => page.getByTestId(`shape-kind-${kind}`);
export const shapeToolbar = (page: Page) => page.getByRole('toolbar', { name: 'Shape toolbar' });

export const shapeLocator = (page: Page, id: string) => page.locator(`[data-shape-id="${id}"]`);
export const arrowLocator = (page: Page, id: string) => page.locator(`[data-connector-id="${id}"]`);
export const shapeLabel = (page: Page, id: string) => shapeLocator(page, id).getByTestId('shape-label');
export const shapeLabelEditor = (page: Page) => page.getByTestId('shape-label-editor');
export const endHandle = (page: Page, end: 'from' | 'to') => page.getByTestId(`connector-end-${end}`);
export const attachDots = (page: Page) => page.locator('[data-testid^="attach-dot-"]');

export function fillButton(page: Page, color: string) {
  return page.getByTestId(`shape-fill-${color}`);
}

export function strokeButton(page: Page, color: string) {
  return page.getByTestId(`shape-stroke-${color}`);
}

/** The camera the page is looking through, right now. */
export function cameraOf(page: Page): Promise<Camera> {
  return page.evaluate(() => {
    const hook = window.__vidi6;
    if (hook === undefined) throw new Error('window.__vidi6 missing: e2e runs against `vite build --mode test`');
    return hook.getCamera();
  });
}

/** A point in board units as the page draws it, in screen pixels. */
export async function screenOf(page: Page, world: Point): Promise<ScreenPoint> {
  const cam = await cameraOf(page);
  return worldToScreen(cam, world);
}

/** The middle of an arrow's line on the screen: where a click has to land to pick it up. */
export async function arrowMidpoint(page: Page, id: string): Promise<ScreenPoint> {
  const ends = await arrowState(page, id);
  const cam = await cameraOf(page);
  return worldToScreen(cam, { x: (ends.from.x + ends.to.x) / 2, y: (ends.from.y + ends.to.y) / 2 });
}

export async function shapeIds(page: Page): Promise<string[]> {
  return page.locator('[data-shape-id]').evaluateAll((els) => els.map((el) => el.getAttribute('data-shape-id') ?? ''));
}

export async function arrowIds(page: Page): Promise<string[]> {
  return page.locator('[data-connector-id]').evaluateAll((els) => els.map((el) => el.getAttribute('data-connector-id') ?? ''));
}

/** Wait until the page draws `count` shapes, and name them. */
export async function waitForShapeCount(page: Page, count: number): Promise<string[]> {
  await expect.poll(() => shapeIds(page), { timeout: 10_000 }).toHaveLength(count);
  return shapeIds(page);
}

/** Wait until the page draws `count` arrows, and name them. */
export async function waitForArrowCount(page: Page, count: number): Promise<string[]> {
  await expect.poll(() => arrowIds(page), { timeout: 10_000 }).toHaveLength(count);
  return arrowIds(page);
}

/** A shape's box as the page draws it, in screen pixels. */
export async function shapeScreenBox(page: Page, id: string): Promise<ScreenBox> {
  const box = await shapeLocator(page, id).boundingBox();
  if (box === undefined || box === null) throw new Error(`shape ${id} is not on the screen`);
  return box;
}

export async function shapeCentre(page: Page, id: string): Promise<ScreenPoint> {
  const box = await shapeScreenBox(page, id);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** A shape's box in board units: the screen box put back through the camera. */
export async function shapeWorldBox(page: Page, id: string): Promise<ScreenBox> {
  const box = await shapeScreenBox(page, id);
  const cam = await cameraOf(page);
  const topLeft = { x: box.x / cam.zoom + cam.x, y: box.y / cam.zoom + cam.y };
  return { x: topLeft.x, y: topLeft.y, width: box.width / cam.zoom, height: box.height / cam.zoom };
}

/** What an arrow's two ends are, in board units, as the page draws them. */
export async function arrowState(page: Page, id: string): Promise<ArrowState> {
  const read = await arrowLocator(page, id).evaluate((el) => ({
    from: {
      x: Number(el.getAttribute('data-from-x')),
      y: Number(el.getAttribute('data-from-y')),
      kind: el.getAttribute('data-from-kind') ?? '',
    },
    to: {
      x: Number(el.getAttribute('data-to-x')),
      y: Number(el.getAttribute('data-to-y')),
      kind: el.getAttribute('data-to-kind') ?? '',
    },
    detached: el.getAttribute('data-detached') === 'true',
  }));
  return read;
}

/** The point one end of an arrow is drawn at, in board units. */
export async function arrowEnd(page: Page, id: string, end: 'from' | 'to'): Promise<Point> {
  const state = await arrowState(page, id);
  return end === 'from' ? { x: state.from.x, y: state.from.y } : { x: state.to.x, y: state.to.y };
}

/** Wait until an end is drawn where it should be, within a pixel of board space. */
export async function expectArrowEndAt(
  page: Page,
  id: string,
  end: 'from' | 'to',
  world: Point,
  within = 1,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const at = await arrowEnd(page, id, end);
        return Math.max(Math.abs(at.x - world.x), Math.abs(at.y - world.y));
      },
      { timeout: 10_000 },
    )
    .toBeLessThanOrEqual(within);
}

/** Wait until the two ends of an arrow are where a shape's sides put them. */
export async function expectArrowAttachedBetween(
  page: Page,
  id: string,
  fromShape: string,
  toShape: string,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const state = await arrowState(page, id);
        const from = await shapeWorldBox(page, fromShape);
        const to = await shapeWorldBox(page, toShape);
        const inside = (p: ArrowEnd, b: ScreenBox) =>
          p.x >= b.x - 1 && p.x <= b.x + b.width + 1 && p.y >= b.y - 1 && p.y <= b.y + b.height + 1;
        return state.from.kind === 'attached' && state.to.kind === 'attached' && inside(state.from, from) && inside(state.to, to);
      },
      { timeout: 10_000 },
    )
    .toBe(true);
}

export async function shapeIsSelected(page: Page, id: string): Promise<boolean> {
  return (await shapeLocator(page, id).getAttribute('data-selected')) === 'true';
}

export async function shapeKind(page: Page, id: string): Promise<string | null> {
  return shapeLocator(page, id).getAttribute('data-kind');
}

export async function shapeLabelText(page: Page, id: string): Promise<string> {
  return shapeLabel(page, id).innerText();
}

export async function shapeLabelLength(page: Page, id: string): Promise<number> {
  const raw = await shapeLabel(page, id).getAttribute('data-label-length');
  return raw === null ? -1 : Number(raw);
}

/** Press a tool's button and wait for the board to say it is the tool in use. */
export async function armShapeTool(page: Page, kind?: ShapeKind): Promise<void> {
  if (kind !== undefined) await shapeKindButton(page, kind).click();
  if ((await shapeButton(page).getAttribute('aria-pressed')) !== 'true') await shapeButton(page).click();
  await expect(shapeButton(page)).toHaveAttribute('aria-pressed', 'true');
  if (kind !== undefined) await expect(shapeKindButton(page, kind)).toHaveAttribute('aria-pressed', 'true');
}

export async function armConnectorTool(page: Page): Promise<void> {
  if ((await connectorButton(page).getAttribute('aria-pressed')) !== 'true') await connectorButton(page).click();
  await expect(connectorButton(page)).toHaveAttribute('aria-pressed', 'true');
}

/** Draw a shape with one drag of the mouse, and return its id. */
export async function drawShape(
  page: Page,
  from: ScreenPoint,
  to: ScreenPoint,
  kind?: ShapeKind,
): Promise<string> {
  await armShapeTool(page, kind);
  const before = new Set(await shapeIds(page));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
  await expect
    .poll(async () => (await shapeIds(page)).filter((id) => !before.has(id)).length, { timeout: 10_000 })
    .toBe(1);
  return (await shapeIds(page)).find((id) => !before.has(id)) as string;
}

/** Draw a shape with a click, and return its id. */
export async function clickShape(page: Page, at: ScreenPoint, kind?: ShapeKind): Promise<string> {
  await armShapeTool(page, kind);
  const before = new Set(await shapeIds(page));
  await page.mouse.click(at.x, at.y);
  await expect
    .poll(async () => (await shapeIds(page)).filter((id) => !before.has(id)).length, { timeout: 10_000 })
    .toBe(1);
  return (await shapeIds(page)).find((id) => !before.has(id)) as string;
}

/** Draw an arrow from one screen point to another, and return its id. */
export async function drawArrow(page: Page, from: ScreenPoint, to: ScreenPoint): Promise<string> {
  await armConnectorTool(page);
  const before = new Set(await arrowIds(page));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
  await expect
    .poll(async () => (await arrowIds(page)).filter((id) => !before.has(id)).length, { timeout: 10_000 })
    .toBe(1);
  return (await arrowIds(page)).find((id) => !before.has(id)) as string;
}

/** Write a shape's label the way a person does: double-click, type, click away. */
export async function labelShape(page: Page, id: string, text: string): Promise<void> {
  const centre = await shapeCentre(page, id);
  await page.mouse.dblclick(centre.x, centre.y);
  await expect(shapeLabelEditor(page)).toBeVisible();
  await page.keyboard.type(text);
  await page.keyboard.press('Escape');
  await expect(shapeLabelEditor(page)).toHaveCount(0);
}

/** Drag a selected shape across the board. */
export async function dragShapeBy(page: Page, id: string, dx: number, dy: number): Promise<void> {
  const at = await shapeCentre(page, id);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + dx, at.y + dy, { steps: 8 });
  await page.mouse.up();
}

/** Click an arrow on its line, at the point a click has to be inside to be on it. */
export async function clickArrow(page: Page, id: string): Promise<void> {
  const at = await arrowMidpoint(page, id);
  await page.mouse.click(at.x, at.y);
  await expect(arrowLocator(page, id)).toHaveAttribute('data-selected', 'true', { timeout: 10_000 });
}

/** Drag one of a selected arrow's ends to a screen point; returns when it is let go. */
export async function dragArrowEnd(page: Page, end: 'from' | 'to', to: ScreenPoint): Promise<void> {
  const box = await endHandle(page, end).boundingBox();
  if (box === null || box === undefined) throw new Error(`the ${end} end of the arrow has no handle to drag`);
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
}

/** Where one of a shape's four side anchors is on the screen, in screen pixels. */
export async function sideAnchorScreen(page: Page, id: string, side: ConnectorSide): Promise<ScreenPoint> {
  const box = await shapeWorldBox(page, id);
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const world =
    side === 'top'
      ? { x: centre.x, y: box.y }
      : side === 'bottom'
        ? { x: centre.x, y: box.y + box.height }
        : side === 'left'
          ? { x: box.x, y: centre.y }
          : { x: box.x + box.width, y: centre.y };
  return screenOf(page, world);
}
