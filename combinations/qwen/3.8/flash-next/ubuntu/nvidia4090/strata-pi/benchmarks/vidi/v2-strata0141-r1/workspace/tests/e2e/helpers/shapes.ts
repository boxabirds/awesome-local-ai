import { expect, type Locator, type Page } from '@playwright/test';
import type { ShapeSnapshot } from '../../../src/shared/objects/shape';
import {
  E2E_EVENTUAL_TIMEOUT_MS,
  SHAPE_DEFAULT_SIZE_WORLD,
  type ShapeFillColor,
  type ShapeKind,
  type ShapeStrokeColor,
} from '../../../src/shared/config';
import { getCamera, type ScreenPoint } from './board';

/**
 * Story 10 shape helpers (`shape.tool`, `shape.kind`, `shape.size`, `shape.style`).
 *
 * Two views of the same shape are used on purpose: the model snapshot, which is
 * camera independent and says what the board agreed on, and the drawn card's own
 * bounding box, which says what a person sees at their zoom. A test that only read
 * the model could pass a shape that was never painted.
 */

/** A box in screen pixels. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ShapeHooks {
  shapes(): ShapeSnapshot[];
  createShape(params: {
    at: ScreenPoint;
    size?: { width: number; height: number };
    square?: boolean;
    kind?: ShapeKind;
    fill?: ShapeFillColor;
    stroke?: ShapeStrokeColor;
    label?: string;
  }): string;
}

/** The shapes this page's model holds, topmost last. */
export async function getShapes(page: Page): Promise<ShapeSnapshot[]> {
  return page.evaluate(() => {
    const api = (window as unknown as { __vidi6?: ShapeHooks }).__vidi6;
    if (!api) {
      throw new Error('test hooks are not installed');
    }
    return api.shapes();
  });
}

export async function shapeOf(page: Page, id: string): Promise<ShapeSnapshot> {
  const shapes = await getShapes(page);
  const found = shapes.find((shape) => shape.id === id);
  if (!found) {
    throw new Error(`shape ${id} is not on the board`);
  }
  return found;
}

/** Put a shape on the board through the model (test setup only). */
export async function createShapeOnBoard(
  page: Page,
  at: ScreenPoint,
  options: {
    size?: { width: number; height: number };
    square?: boolean;
    kind?: ShapeKind;
    fill?: ShapeFillColor;
    stroke?: ShapeStrokeColor;
    label?: string;
  } = {},
): Promise<string> {
  const id = await page.evaluate(
    (args) => {
      const api = (window as unknown as { __vidi6?: ShapeHooks }).__vidi6;
      if (!api) {
        throw new Error('test hooks are not installed');
      }
      return api.createShape({ at: { x: args.x, y: args.y }, ...args.options });
    },
    { x: at.x, y: at.y, options },
  );
  if (id === '') {
    throw new Error('the shape was not created');
  }
  await expect
    .poll(async () => (await getShapes(page)).some((shape) => shape.id === id), {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
    })
    .toBe(true);
  return id;
}

/** Wait until the board holds exactly `count` shapes. */
export async function waitForShapeCount(page: Page, count: number): Promise<ShapeSnapshot[]> {
  await expect
    .poll(async () => (await getShapes(page)).length, {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
      message: `the board never showed ${count} shapes`,
    })
    .toBe(count);
  return getShapes(page);
}

/** Wait until this shape is gone. */
export async function waitForShapeGone(page: Page, id: string): Promise<void> {
  await expect
    .poll(async () => (await getShapes(page)).some((shape) => shape.id === id), {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
      message: `shape ${id} never went away`,
    })
    .toBe(false);
}

/** Compare shapes as one canonical list, so two pages can be called the same board. */
const shapeData = (shapes: readonly ShapeSnapshot[]): string =>
  JSON.stringify(
    shapes.map((shape) => ({
      id: shape.id,
      kind: shape.kind,
      x: Math.round(shape.x),
      y: Math.round(shape.y),
      width: Math.round(shape.width),
      height: Math.round(shape.height),
      fill: shape.fill,
      stroke: shape.stroke,
      label: shape.label,
      z: shape.z,
    })),
  );

/** Wait until every page agrees on the shapes, and return them. */
export async function waitForSameShapes(
  pages: readonly Page[],
): Promise<readonly ShapeSnapshot[]> {
  let first = '[]';
  await expect
    .poll(
      async () => {
        const all = await Promise.all(pages.map(async (page) => shapeData(await getShapes(page))));
        first = all[0] ?? '[]';
        return all.every((entry) => entry === first);
      },
      { timeout: E2E_EVENTUAL_TIMEOUT_MS, message: 'the boards never agreed on the shapes' },
    )
    .toBe(true);
  return getShapes(pages[0] as Page);
}

export function shapeCard(page: Page, id: string): Locator {
  return page.locator(`[data-testid="shape-object-${id}"]`);
}

/** The shape's drawn box, in screen pixels at this page's zoom. */
export async function shapeBox(page: Page, id: string): Promise<Rect> {
  const box = await shapeCard(page, id).boundingBox();
  if (!box) {
    throw new Error(`shape ${id} has no bounding box (is it on screen?)`);
  }
  return { x: box.x, y: box.y, width: box.width, height: box.height };
}

export async function shapeCentre(page: Page, id: string): Promise<ScreenPoint> {
  const box = await shapeBox(page, id);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export async function shapeAttribute(page: Page, id: string, name: string): Promise<string | null> {
  return shapeCard(page, id).getAttribute(name);
}

/** Which geometry the shape's own SVG drew: the kind, as painted. */
export async function drawnShapeGeometry(page: Page, id: string): Promise<'rect' | 'ellipse' | 'polygon'> {
  const card = shapeCard(page, id);
  for (const geometry of ['rect', 'ellipse', 'polygon'] as const) {
    if ((await card.locator(geometry).count()) > 0) {
      return geometry;
    }
  }
  throw new Error(`shape ${id} drew no geometry`);
}

/** Wait until this page marks the shape as selected. */
export async function waitForShapeSelected(page: Page, id: string): Promise<void> {
  await expect
    .poll(async () => (await shapeAttribute(page, id, 'data-selected')) === 'true', {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
      message: `shape ${id} was never selected`,
    })
    .toBe(true);
}

/** Hold the Shape tool (`shape.tool`). */
export async function pressShapeTool(page: Page, key: 's' | 'toolbar' = 's'): Promise<void> {
  if (key === 's') {
    await page.keyboard.press('s');
  } else {
    await page.getByRole('button', { name: 'Shape (S)' }).click();
  }
  await page.waitForTimeout(40);
  await expect(page.locator('[data-testid="board"]')).toHaveAttribute('data-tool', 'shape');
}

/** Choose a kind from the Shape tool's menu (`shape.kind`). */
export async function clickShapeKind(page: Page, kind: ShapeKind): Promise<void> {
  await page.getByTestId(`shape-kind-${kind}`).click();
  await page.waitForTimeout(40);
}

/** World point -> screen point, using the camera this page is really on. */
export async function shapeScreenOf(page: Page, world: ScreenPoint): Promise<ScreenPoint> {
  const camera = await getCamera(page);
  return { x: (world.x - camera.x) * camera.zoom, y: (world.y - camera.y) * camera.zoom };
}

/** The board's way of drawing a shape: press, drag, release (`shape.size`). */
export async function dragShapeCreate(
  page: Page,
  from: ScreenPoint,
  dx: number,
  dy: number,
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(80);
}

/** A click, which is also a shape: the default box, centred on the click. */
export async function clickShapeCreate(page: Page, at: ScreenPoint): Promise<void> {
  await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(80);
}

/** Drag a shape from its drawn centre by (dx, dy) screen pixels. */
export async function dragShapeBy(
  page: Page,
  id: string,
  dx: number,
  dy: number,
): Promise<void> {
  const grab = await shapeCentre(page, id);
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x + dx / 2, grab.y + dy / 2, { steps: 8 });
  await page.mouse.move(grab.x + dx, grab.y + dy, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(120);
}

/**
 * The label as the browser actually painted it: one box per drawn line.
 *
 * A Range over the label's text nodes answers the question the story asks - not
 * "is the text centred in the markup" but "where did the lines land". Word wrap,
 * `text-align: center` and vertical centring all show up here, and a label that
 * overflowed its shape shows up here too.
 */
export interface DrawnLabel {
  /** One box per word, as the browser put it on the page. */
  words: Rect[];
  /** One box per wrapped line, built from the words that share its baseline row. */
  lines: Rect[];
  /** The box every word together covers. */
  bounds: Rect;
  lineHeight: number;
  text: string;
}

/**
 * The label as the browser actually painted it.
 *
 * A Range is put around each word rather than around the whole label, because a
 * Range over the whole label also returns the spaces the browser left at each wrap
 * point, and a centred line with a trailing space on it is not a centred line of
 * text. Words are what a person reads, so words are what is measured; the line
 * boxes are then built from the words that landed on the same row.
 */
export async function drawnLabel(page: Page, id: string): Promise<DrawnLabel> {
  const label = page.locator(`[data-testid="shape-label-${id}"]`);
  const drawn = await label.evaluate((el) => {
    const words: Rect[] = [];
    const walker = document.createTreeWalker(el as HTMLElement, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const text = node.nodeValue ?? '';
      const pattern = /\S+/g;
      let match = pattern.exec(text);
      while (match) {
        const range = document.createRange();
        range.setStart(node, match.index);
        range.setEnd(node, match.index + match[0].length);
        for (const rect of Array.from(range.getClientRects())) {
          if (rect.width > 1 && rect.height > 1) {
            words.push({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
          }
        }
        match = pattern.exec(text);
      }
      node = walker.nextNode();
    }
    const style = getComputedStyle(el as HTMLElement);
    const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.3 || 1;
    return { words, lineHeight, text: (el as HTMLElement).textContent ?? '' };
  });

  // Words that share a row: within one line height of the first word seen at that row.
  const rows: { y: number; words: Rect[] }[] = [];
  for (const word of drawn.words) {
    const row = rows.find((entry) => Math.abs(entry.y - word.y) < drawn.lineHeight / 2);
    if (row) {
      row.words.push(word);
      row.y = (row.y * (row.words.length - 1) + word.y) / row.words.length;
    } else {
      rows.push({ y: word.y, words: [word] });
    }
  }
  rows.sort((a, b) => a.y - b.y);

  const line = (boxes: readonly Rect[]): Rect => {
    const x = Math.min(...boxes.map((box) => box.x));
    const y = Math.min(...boxes.map((box) => box.y));
    const right = Math.max(...boxes.map((box) => box.x + box.width));
    const bottom = Math.max(...boxes.map((box) => box.y + box.height));
    return { x, y, width: right - x, height: bottom - y };
  };

  const lines = rows.map((row) => line(row.words));
  return {
    words: drawn.words,
    lines,
    bounds: drawn.words.length > 0 ? line(drawn.words) : { x: 0, y: 0, width: 0, height: 0 },
    lineHeight: drawn.lineHeight,
    text: drawn.text,
  };
}

/** How many lines the browser broke the label into. */
export async function drawnLabelLineCount(page: Page, id: string): Promise<number> {
  return (await drawnLabel(page, id)).lines.length;
}

/** The label editor, which double-clicking the shape opens. */
export function shapeEditor(page: Page, id: string): Locator {
  return page.locator(`[data-testid="shape-editor-${id}"]`);
}

export async function editShapeLabel(page: Page, id: string, text: string): Promise<void> {
  await shapeCard(page, id).dblclick();
  await page.waitForSelector(`[data-testid="shape-editor-${id}"]`);
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  await page.keyboard.type(text);
  await page.waitForTimeout(80);
  // Escape ends the edit and keeps the shape selected (`sticky.text`'s own rule,
  // which the shape label editor shares).
  await page.keyboard.press('Escape');
  await page.waitForSelector(`[data-testid="shape-editor-${id}"]`, { state: 'detached' });
  await page.waitForTimeout(80);
}

/** The shape toolbar's fill and outline swatches (`shape.style`). */
export async function clickShapeSwatch(
  page: Page,
  kind: 'fill' | 'outline',
  colour: string,
): Promise<void> {
  await page.getByRole('button', { name: `${colour} ${kind}` }).click();
  await page.waitForTimeout(80);
}

/** The size the default box takes at this page's zoom, in screen pixels. */
export async function defaultBoxScreen(page: Page): Promise<number> {
  const camera = await getCamera(page);
  return SHAPE_DEFAULT_SIZE_WORLD * camera.zoom;
}
