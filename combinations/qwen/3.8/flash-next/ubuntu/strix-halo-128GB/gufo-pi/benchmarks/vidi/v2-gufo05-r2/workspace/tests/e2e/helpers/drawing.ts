/**
 * Helpers for story 10's end-to-end tests: shapes and the arrows that hang off them.
 *
 * Two things are read for every claim, because a story about derived geometry lives or
 * dies on their agreeing: what the shared document holds (the ends of an arrow, the box
 * of a shape) and what this browser drew (the rect on screen, the line's two ends). The
 * second is measured in screen pixels and converted back through the element's own box,
 * so it stays true at any zoom.
 */

import { expect, type Page } from '@playwright/test';

import type { ConnectorSnapshot } from '../../../src/shared/objects/connector';
import type { ShapeKind } from '../../../src/shared/config';
import type { ShapeSnapshot } from '../../../src/shared/objects/shape';
import { expectNoPendingCameraFrame, type Pixel } from './board';

export interface DrawnBox extends Pixel {
  readonly id: string;
  readonly width: number;
  readonly height: number;
}

/** Where an arrow's two ends are drawn, in this browser's screen pixels. */
export interface DrawnArrow {
  readonly id: string;
  readonly from: Pixel;
  readonly to: Pixel;
  /** Everything this browser was asked to draw, as text, for the finite check. */
  readonly raw: string[];
}

async function read<T>(page: Page, name: 'getShapes' | 'getConnectors'): Promise<T[]> {
  const list = await page.evaluate((which) => {
    const w = window as unknown as {
      __vidi6?: Record<string, (() => unknown[]) | undefined>;
    };
    const hook = w.__vidi6?.[which];
    if (!hook) throw new Error(`${which} missing: e2e needs a test build`);
    return hook();
  }, name);
  return list as T[];
}

export function getShapes(page: Page): Promise<ShapeSnapshot[]> {
  return read<ShapeSnapshot>(page, 'getShapes');
}

export function getConnectors(page: Page): Promise<ConnectorSnapshot[]> {
  return read<ConnectorSnapshot>(page, 'getConnectors');
}

/** Screen boxes of every rendered shape, keyed by id. */
export async function shapeBoxes(page: Page): Promise<Record<string, DrawnBox>> {
  const raw = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-object-type="shape"]')).map((el) => {
      const r = el.getBoundingClientRect();
      return {
        id: el.dataset.objectId as string,
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
      };
    }),
  );
  const boxes: Record<string, DrawnBox> = {};
  for (const r of raw) boxes[r.id] = r;
  return boxes;
}

/**
 * Where an arrow is drawn, in screen pixels, read off the line itself.
 *
 * The arrow's own SVG is scaled by the board's zoom, so its local coordinates are board
 * units; the scale factor comes from the element's box, which is why this works at 400%
 * as well as at 100%.
 */
export async function arrowLine(page: Page, id: string): Promise<DrawnArrow> {
  const line = await page.evaluate((arrowId) => {
    const svg = document.querySelector<SVGSVGElement>(`[data-testid="connector-${arrowId}"]`);
    if (!svg) return null;
    const mark = svg.querySelector<SVGLineElement>('.connector-object__line');
    // The head is what gives the arrow its point: the line stops short of it, so the tip
    // of the arrow is read off the triangle's first corner.
    const head = svg.querySelector<SVGPolygonElement>('.connector-object__head');
    if (!mark || !head) return null;
    const box = svg.getBoundingClientRect();
    const view = svg.viewBox.baseVal;
    const sx = view.width > 0 ? box.width / view.width : 1;
    const sy = view.height > 0 ? box.height / view.height : 1;
    const at = (x: number, y: number): Pixel => ({
      x: box.left + x * sx,
      y: box.top + y * sy,
    });
    const tip = (head.getAttribute('points') ?? '').trim().split(/\s+/)[0] ?? '';
    const [tipX = 'NaN', tipY = 'NaN'] = tip.split(',');
    return {
      raw: [
        mark.getAttribute('x1') ?? '',
        mark.getAttribute('y1') ?? '',
        mark.getAttribute('x2') ?? '',
        mark.getAttribute('y2') ?? '',
        head.getAttribute('points') ?? '',
      ],
      from: at(Number(mark.getAttribute('x1')), Number(mark.getAttribute('y1'))),
      to: at(Number(tipX), Number(tipY)),
    };
  }, id);
  if (!line) throw new Error(`arrow ${id} is not drawn on this screen`);
  if (line.raw.some((value) => value.includes('NaN'))) {
    throw new Error(`arrow ${id} is drawn with NaN coordinates: ${JSON.stringify(line.raw)}`);
  }
  return { id, from: line.from, to: line.to, raw: line.raw };
}

/** A shape placed through the app's own test hook, by its centre. */
export async function seedShapeAt(page: Page, kind: ShapeKind, centre: Pixel): Promise<string> {
  const id = await page.evaluate(
    (args) => {
      const w = window as unknown as {
        __vidi6?: { seedShape?(kind: ShapeKind, x: number, y: number): string };
      };
      if (!w.__vidi6?.seedShape) throw new Error('seedShape missing: e2e needs a test build');
      return w.__vidi6.seedShape(args.kind, args.x, args.y);
    },
    { kind, x: centre.x, y: centre.y },
  );
  await expect(page.locator(`[data-object-id="${id}"]`)).toBeVisible();
  return id;
}

/** An arrow between two shapes, through the hook that hangs each end on a facing side. */
export async function seedArrow(page: Page, fromId: string, toId: string): Promise<string> {
  const id = await page.evaluate(
    ([from, to]) => {
      const w = window as unknown as {
        __vidi6?: { seedConnector?(fromId: string, toId: string): string };
      };
      if (!w.__vidi6?.seedConnector) {
        throw new Error('seedConnector missing: e2e needs a test build');
      }
      return w.__vidi6.seedConnector(from, to);
    },
    [fromId, toId],
  );
  if (!id) throw new Error(`no arrow was made between ${fromId} and ${toId}`);
  await expect(page.locator(`[data-testid="connector-${id}"]`)).toBeVisible();
  return id;
}

export async function pickShapeTool(page: Page, kind?: ShapeKind): Promise<void> {
  if (kind && kind !== 'rect') {
    await page.getByTestId(`shape-kind-${kind}`).click();
  }
  await page.getByRole('button', { name: 'Shape (S)' }).click();
  await expect(page.getByTestId('shape-tool-layer')).toBeVisible();
}

export async function pickConnectorTool(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Connector (L)' }).click();
  await expect(page.getByTestId('connector-tool-layer')).toBeVisible();
}

export async function pickSelectTool(page: Page): Promise<void> {
  await page.keyboard.press('v');
  await expectNoPendingCameraFrame(page);
}

function centreOf(box: DrawnBox): Pixel {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * Draw a shape with a real drag, and return the id of the one that appeared.
 *
 * The diff, rather than "the last shape", is what makes this safe on a board where more
 * than one person is drawing.
 */
export async function createShapeByDrag(
  page: Page,
  from: Pixel,
  to: Pixel,
  options: { kind?: ShapeKind; shift?: boolean } = {},
): Promise<string> {
  const before = new Set((await getShapes(page)).map((shape) => shape.id));
  await pickShapeTool(page, options.kind);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  if (options.shift) await page.keyboard.down('Shift');
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await expectNoPendingCameraFrame(page);
  await page.mouse.up();
  if (options.shift) await page.keyboard.up('Shift');
  await expectNoPendingCameraFrame(page);
  return onlyNew(page, before, 'shape');
}

/** Draw a shape with a click: the standard size, centred under the pointer. */
export async function createShapeByClick(
  page: Page,
  at: Pixel,
  kind: ShapeKind = 'rect',
): Promise<string> {
  const before = new Set((await getShapes(page)).map((shape) => shape.id));
  await pickShapeTool(page, kind);
  await page.mouse.click(at.x, at.y);
  await expectNoPendingCameraFrame(page);
  return onlyNew(page, before, 'shape');
}

/** Draw an arrow between two screen points with a real drag. */
export async function createArrowByDrag(
  page: Page,
  from: Pixel,
  to: Pixel,
): Promise<string> {
  const before = new Set((await getConnectors(page)).map((arrow) => arrow.id));
  await pickConnectorTool(page);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await expectNoPendingCameraFrame(page);
  await page.mouse.up();
  await expectNoPendingCameraFrame(page);
  return onlyNew(page, before, 'connector');
}

async function onlyNew(
  page: Page,
  before: Set<string>,
  what: 'shape' | 'connector',
): Promise<string> {
  const created =
    what === 'shape'
      ? (await getShapes(page)).filter((shape) => !before.has(shape.id))
      : (await getConnectors(page)).filter((arrow) => !before.has(arrow.id));
  if (created.length !== 1) {
    throw new Error(`expected one new ${what}, saw ${created.length}`);
  }
  return created[0]!.id;
}

/** Select a shape by clicking its middle, which brings up its toolbar. */
export async function selectShape(page: Page, id: string): Promise<void> {
  const box = (await shapeBoxes(page))[id];
  if (!box) throw new Error(`shape ${id} is not on this screen`);
  await pickSelectTool(page);
  await page.mouse.click(centreOf(box).x, centreOf(box).y);
  await expect(page.getByTestId('shape-toolbar')).toBeVisible({ timeout: 5_000 });
}

/** Delete a shape with its own toolbar button. */
export async function deleteShape(page: Page, id: string): Promise<void> {
  await selectShape(page, id);
  await page.getByRole('button', { name: 'Delete shape' }).click();
  await expect(page.locator(`[data-object-id="${id}"]`)).toHaveCount(0);
}

/** Drag a shape from its middle to a screen point: story 7's move, unchanged by story 10. */
export async function dragShapeTo(page: Page, id: string, to: Pixel): Promise<void> {
  const box = (await shapeBoxes(page))[id];
  if (!box) throw new Error(`shape ${id} is not on this screen`);
  const from = centreOf(box);
  await pickSelectTool(page);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await expectNoPendingCameraFrame(page);
  await page.mouse.up();
  await expectNoPendingCameraFrame(page);
}

/** Press an arrow's end handle and move it, without releasing: the caller releases. */
export async function grabArrowEnd(page: Page, id: string, end: 'from' | 'to'): Promise<void> {
  const handle = page.getByTestId(`connector-handle-${end}`);
  await expect(handle).toBeVisible({ timeout: 5_000 });
  const box = await handle.boundingBox();
  if (!box) throw new Error(`the ${end} handle of arrow ${id} has no box`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expectNoPendingCameraFrame(page);
}

/** Move to a screen point and let go: the end is placed where the hand left it. */
export async function releaseAt(page: Page, at: Pixel): Promise<void> {
  await page.mouse.move(at.x, at.y, { steps: 6 });
  await expectNoPendingCameraFrame(page);
  await page.mouse.up();
  await expectNoPendingCameraFrame(page);
}

/** Drag an arrow's end to a screen point in one go. */
export async function dragArrowEndTo(
  page: Page,
  id: string,
  end: 'from' | 'to',
  to: Pixel,
): Promise<void> {
  await selectArrow(page, id);
  await grabArrowEnd(page, id, end);
  await releaseAt(page, to);
}

/** Click an arrow's line to select it, which brings its two ends out. */
export async function selectArrow(page: Page, id: string): Promise<void> {
  const line = await arrowLine(page, id);
  const at = { x: (line.from.x + line.to.x) / 2, y: (line.from.y + line.to.y) / 2 };
  await pickSelectTool(page);
  await page.mouse.click(at.x, at.y);
  await expect(page.getByTestId(`connector-handle-to`)).toBeVisible({ timeout: 5_000 });
}

/** The label as drawn: its centre and how many lines it took. */
export async function labelInfo(page: Page, id: string): Promise<{
  centre: Pixel;
  lines: number;
  height: number;
  text: string;
}> {
  const info = await page.evaluate((shapeId) => {
    const el = document.querySelector<HTMLElement>(`[data-testid="shape-label-${shapeId}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const lineHeight = Number.parseFloat(getComputedStyle(el).lineHeight) || 20;
    return {
      cx: r.x + r.width / 2,
      cy: r.y + r.height / 2,
      height: r.height,
      lines: Math.max(1, Math.round(r.height / lineHeight)),
      text: el.textContent ?? '',
    };
  }, id);
  if (!info) throw new Error(`shape ${id} has no drawn label`);
  return { centre: { x: info.cx, y: info.cy }, lines: info.lines, height: info.height, text: info.text };
}

export { centreOf };
