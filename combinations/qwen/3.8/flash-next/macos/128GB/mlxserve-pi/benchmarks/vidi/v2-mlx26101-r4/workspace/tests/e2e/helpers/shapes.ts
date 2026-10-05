/**
 * Helpers for story 10's end-to-end tests: shapes drawn with a mouse, arrows drawn between
 * them, and the two things an arrow is then asked to do — follow an object it was joined to,
 * and outlive an object that was deleted from under it.
 *
 * Three rules run through this file, and they are the rules of the tests that use it.
 *
 * **Board units and screen pixels are different things and are converted, never conflated.**
 * A shape is put on the board at board units (a person chooses a place, not a coordinate);
 * what is asserted about it is either read out of this page's document — which speaks board
 * units and needs no conversion — or measured off the painted page in screen pixels, after
 * converting the expected place with this page's own camera. The camera is set by the test
 * rather than guessed at, because a test that assumed where the camera was would be asserting
 * the size of the window.
 *
 * **The document and the painted page are the witnesses.** `window.__vidi6.getShapes()` and
 * `getConnectors()` are the model's own snapshots, read out of the page that made them: for a
 * two-person test, each person's page reports what *that page* holds, which is the only way to
 * assert that an arrow followed a shape on both screens and not merely on the one that dragged.
 * Painted geometry is measured with `boundingBox()`, which is what a person's eye gets.
 *
 * **An arrow that is drawn at an object is not stored with a pixel.** An attached end is stored
 * as *that object*, so when the object moves the arrow's ends do not change and the drawn line
 * is different. So the assertions for "the arrow followed" are that the stored ends say the same
 * two objects as before — and, when they don't, that the test's claim was wrong rather than the
 * product's.
 */
import { expect, type Locator, type Page } from '@playwright/test';

import type { ConnectorSnap } from '../../../src/shared/objects/connector';
import { CONNECTOR_ARROWHEAD_SIZE_WORLD } from '../../../src/shared/config';
import type { Endpoint } from '../../../src/shared/geometry/connector-geometry';
import type { ShapeSnap } from '../../../src/shared/objects/shape';
import type { Point } from './board';
import { board, getCamera, settled, TOLERANCE_PX, worldToScreen } from './board';
import type { CameraOnPage } from './board';

/** A box on the screen, as the browser painted it. */
export interface ScreenBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export { TOLERANCE_PX };

/** A camera that puts the board where a test wants it, away from the toolbar. */
export const PLAIN = { x: -400, y: -250, zoom: 1 };

/** Anywhere on the board, in board units, for a test that needs a place and not a position. */
export const OPEN_SPACE = { x: 520, y: 430 };

// ---------------------------------------------------------------------------
// The document this page holds
// ---------------------------------------------------------------------------

/** The shapes this page's document holds. The model's own snapshot, not a reading of the DOM. */
export async function shapesOnPage(page: Page): Promise<readonly ShapeSnap[]> {
  const shapes = await page.evaluate(() => window.__vidi6?.getShapes() ?? []);
  return shapes;
}

export async function shapeOnPage(page: Page, id: string): Promise<ShapeSnap> {
  const shape = (await shapesOnPage(page)).find((entry) => entry.id === id);
  if (shape === undefined) throw new Error(`this page's document has no shape ${id}`);
  return shape;
}

/** The arrows this page's document holds, with their ends as they are *stored*. */
export async function connectorsOnPage(page: Page): Promise<readonly ConnectorSnap[]> {
  return page.evaluate(() => window.__vidi6?.getConnectors() ?? []);
}

export async function connectorOnPage(page: Page, id: string): Promise<ConnectorSnap> {
  const arrow = (await connectorsOnPage(page)).find((entry) => entry.id === id);
  if (arrow === undefined) throw new Error(`this page's document has no connector ${id}`);
  return arrow;
}

/**
 * Which end of an arrow is joined to what.
 *
 * This is the whole of "the arrow is still attached" as the board stores it: an attached end
 * names an object and carries the place it was last drawn at, which is what an arrow is drawn
 * from when that object goes away.
 */
export async function storedEnds(page: Page, id: string): Promise<{ from: Endpoint; to: Endpoint }> {
  const arrow = await connectorOnPage(page, id);
  return { from: arrow.from, to: arrow.to };
}

/** The tool this page says it is in, as the board reports it on its own surface. */
export async function toolOf(page: Page): Promise<string | null> {
  return board(page).getAttribute('data-active-tool');
}

// ---------------------------------------------------------------------------
// Arming a tool
// ---------------------------------------------------------------------------

export function shapeToolButton(page: Page): Locator {
  return page.getByRole('button', { name: /Shape/ });
}

export function connectorToolButton(page: Page): Locator {
  return page.getByRole('button', { name: /Connector/ });
}

export function selectToolButton(page: Page): Locator {
  return page.getByRole('button', { name: /Select/ });
}

/** The shape-kind menu, which is only on screen while the Shape tool is armed. */
export function shapeKindMenu(page: Page): Locator {
  return page.getByTestId('shape-kind');
}

/** The sheet the Shape tool draws on: the whole board, over the objects. */
export function shapeSheet(page: Page): Locator {
  return page.getByTestId('shape-tool');
}

export function connectorSheet(page: Page): Locator {
  return page.getByTestId('connector-tool');
}

/** Arm the Shape tool by its button, and wait for its sheet: an armed tool is a tool you can press. */
export async function armShapeTool(page: Page, kind?: string): Promise<void> {
  await shapeToolButton(page).click();
  await expect(shapeSheet(page)).toBeVisible();
  if (kind !== undefined) await shapeKindMenu(page).selectOption(kind);
}

export async function armConnectorTool(page: Page): Promise<void> {
  await connectorToolButton(page).click();
  await expect(connectorSheet(page)).toBeVisible();
}

/** Give the tool back, the way a person does when they are done drawing. */
export async function putToolDown(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(shapeSheet(page)).toHaveCount(0);
  await expect(connectorSheet(page)).toHaveCount(0);
}

// ---------------------------------------------------------------------------
// Pointing at board places
// ---------------------------------------------------------------------------

/**
 * Where a board point is on this page's screen, in the pixels the mouse is dragged through.
 *
 * Written out through the page's own camera rather than assumed: the tests set the camera with
 * `setCamera`, and the camera is what turns a board unit into a screen pixel.
 */
export async function screenOf(page: Page, at: Point): Promise<Point> {
  return worldToScreen(await getCamera(page), at);
}

/** The middle of a shape, on this page's screen. */
export async function shapeCentre(page: Page, id: string): Promise<Point> {
  const shape = await shapeOnPage(page, id);
  return screenOf(page, { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 });
}

/** The middle of the side of a shape that faces a board point, on this page's screen. */
export async function shapeSideCentre(
  page: Page,
  id: string,
  side: 'top' | 'right' | 'bottom' | 'left',
): Promise<Point> {
  const shape = await shapeOnPage(page, id);
  const at =
    side === 'left'
      ? { x: shape.x, y: shape.y + shape.height / 2 }
      : side === 'right'
        ? { x: shape.x + shape.width, y: shape.y + shape.height / 2 }
        : side === 'top'
          ? { x: shape.x + shape.width / 2, y: shape.y }
          : { x: shape.x + shape.width / 2, y: shape.y + shape.height };
  return screenOf(page, at);
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

/** Draw a shape: press on the board with the Shape tool, travel, let go. */
export async function drawShape(page: Page, from: Point, to: Point): Promise<void> {
  const start = await screenOf(page, from);
  const end = await screenOf(page, to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move((start.x + end.x) / 2, (start.y + end.y) / 2, { steps: 5 });
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await page.mouse.up();
  await settled(page);
}

/** Draw a shape with a click: the board supplies the size, and the place is the middle. */
export async function clickShape(page: Page, at: Point): Promise<void> {
  const point = await screenOf(page, at);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.up();
  await settled(page);
}

/**
 * Draw an arrow from one board place to another, with the Connector tool.
 *
 * The press and the release are at board places; where the arrow actually joins is the tool's
 * decision and is asserted by the tests, not assumed here.
 */
export async function drawArrow(page: Page, from: Point, to: Point): Promise<void> {
  const start = await screenOf(page, from);
  const end = await screenOf(page, to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move((start.x + end.x) / 2, (start.y + end.y) / 2, { steps: 8 });
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
  await settled(page);
}

/** Press a shape and let go: select it. */
export async function pressShape(page: Page, id: string): Promise<void> {
  const at = await shapeCentre(page, id);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.up();
  await settled(page);
}

/** Drag a shape: press its middle, travel, let go. */
export async function dragShape(page: Page, id: string, delta: Point): Promise<void> {
  const at = await shapeCentre(page, id);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + delta.x / 2, at.y + delta.y / 2, { steps: 5 });
  await page.mouse.move(at.x + delta.x, at.y + delta.y, { steps: 5 });
  await page.mouse.up();
  await settled(page);
}

/**
 * Where an end of a selected arrow is on the screen, ready to be pulled.
 *
 * The handles are only drawn for a selected arrow, so this asks for the arrow to be selected
 * first and says so when it is not — which is also the assertion that a person gets handles for
 * the arrow they picked up and for no other.
 */
export async function arrowHandle(page: Page, id: string, end: 'from' | 'to'): Promise<Point> {
  const handle = page.locator(`[data-connector-id="${id}"] [data-testid="connector-handle-${end}"]`);
  const box = await handle.boundingBox();
  if (box === null) {
    throw new Error(`the arrow ${id} offers no handle at its ${end} (is it selected, and is the zoom deep enough?)`);
  }
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Pull one end of an arrow somewhere else on the board, and let go there. */
export async function dragArrowEnd(
  page: Page,
  id: string,
  end: 'from' | 'to',
  to: Point,
): Promise<void> {
  const start = await arrowHandle(page, id, end);
  const finish = await screenOf(page, to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move((start.x + finish.x) / 2, (start.y + finish.y) / 2, { steps: 6 });
  await page.mouse.move(finish.x, finish.y, { steps: 6 });
  await page.mouse.up();
  await settled(page);
}

/**
 * Take an arrow's end in the hand and hold it there, without letting go.
 *
 * This is how a test forces the overlap the design describes — a person pulling an arrow onto a
 * shape while somebody else deletes that shape. A held pointer is the real thing: the write that
 * a release makes has not happened yet, so anything that happens on another page lands between
 * the pointer going down and coming up.
 */
export async function holdArrowEnd(page: Page, id: string, end: 'from' | 'to', to: Point): Promise<void> {
  const start = await arrowHandle(page, id, end);
  const finish = await screenOf(page, to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move((start.x + finish.x) / 2, (start.y + finish.y) / 2, { steps: 6 });
  await page.mouse.move(finish.x, finish.y, { steps: 6 });
}

/** Let go of a held pointer, where it is. */
export async function releasePointer(page: Page): Promise<void> {
  await page.mouse.up();
  await settled(page);
}

// ---------------------------------------------------------------------------
// What the page paints
// ---------------------------------------------------------------------------

export function shapeElement(page: Page, id: string): Locator {
  return page.locator(`[data-shape-id="${id}"]`);
}

export function arrowElement(page: Page, id: string): Locator {
  return page.locator(`[data-connector-id="${id}"]`);
}

/** A shape as painted: where it is on the screen, in pixels. */
export async function shapePainted(page: Page, id: string): Promise<ScreenBox> {
  const box = await shapeElement(page, id).boundingBox();
  if (box === null) throw new Error(`the shape ${id} is not painted on this page`);
  return { x: box.x ?? 0, y: box.y ?? 0, width: box.width ?? 0, height: box.height ?? 0 };
}

/** The arrow's head, as painted. Its middle is where the point of the arrow is. */
export async function arrowHeadPainted(page: Page, id: string): Promise<{ point: Point; box: ScreenBox }> {
  const head = arrowElement(page, id).locator('svg polygon');
  const box = await head.boundingBox();
  if (box === null) throw new Error(`the arrow ${id} painted no head`);
  return {
    point: { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    box: { x: box.x, y: box.y, width: box.width, height: box.height },
  };
}

/**
 * Which side of its object the arrow's head is drawn at.
 *
 * The board does not store a side: the side is what the geometry makes of the two objects' places
 * at the moment it draws. So this is asked of the painted page — of which side of the shape the
 * arrowhead sits on the far side of — and not of a field that would only ever say what was
 * written down.
 */
export async function arrowHeadSide(page: Page, id: string, objectId: string): Promise<string> {
  const head = await arrowHeadPainted(page, id);
  const shape = await shapePainted(page, objectId);
  const dx = head.point.x - (shape.x + shape.width / 2);
  const dy = head.point.y - (shape.y + shape.height / 2);
  // The same proportions as the board's own rule, and said here on purpose: the test measures what
  // the person sees against the shape's own width and height, which is what decides whether a point
  // is "to the side of" a wide shape or "below" a tall one.
  return Math.abs(dy) * shape.width > Math.abs(dx) * shape.height ? (dy < 0 ? 'top' : 'bottom') : dx < 0 ? 'left' : 'right';
}

/** The words a shape shows, whether it is being typed into or not. */
export async function shapeWords(page: Page, id: string): Promise<string> {
  const label = shapeElement(page, id).getByTestId('shape-label');
  if ((await label.count()) === 0) return (await shapeOnPage(page, id)).label;
  return (await label.textContent()) ?? '';
}

/** How a shape's words are laid out on the screen. */
export interface WordsLayout {
  readonly text: string;
  /** How many lines the words are drawn on. One means they did not wrap. */
  readonly lines: number;
  /** The box the words themselves cover, which is smaller than the shape they sit in. */
  readonly box: ScreenBox;
  /**
   * How far the middle of the words is from the middle of the shape, in screen pixels.
   *
   * This is the middle of the *ink* — of the letters that are painted — which is never exactly the
   * middle of the box: words that wrap leave a ragged edge, and the space at the end of a line is
   * centred along with the letters in front of it. So a test asks how big the miss is against the
   * size of the letters, not whether it is zero; a label that was not centred misses by hundreds of
   * pixels, and a label that is misses by less than a space.
   */
  readonly offCentre: { x: number; y: number };
  /** Whether any of the words sticks out of the shape's sides. */
  readonly spills: boolean;
}

/**
 * The words of a shape, measured letter by letter.
 *
 * The label element cannot be measured as a whole, because it is the whole of the shape: the words are
 * centred *inside* it, so the element's own box says nothing about where the words are. And a `Range`
 * over the whole label is not enough either — it returns a rectangle for the spaces at the end of a
 * line as well as for the letters, which reads as letters that reach further than a person can see.
 * So this walks the label's text word by word, and each word's own rectangle is what was painted.
 *
 * "Spilling" is measured across the shape's sides only. Downwards, words that do not fit are clipped
 * on purpose — the box is the shape, and a label that grew the shape would be a label that moved an
 * object nobody touched.
 */
export async function wordsLayout(page: Page, id: string): Promise<WordsLayout> {
  const shape = await shapePainted(page, id);
  const measured = await shapeElement(page, id)
    .getByTestId('shape-label')
    .evaluate((element) => {
      const node = element.firstChild;
      const text = element.textContent ?? '';
      const rects: { x: number; y: number; width: number; height: number }[] = [];
      if (node instanceof Text) {
        // Word by word, because the spaces between words are what a line is ragged by.
        for (let index = 0; index < text.length; ) {
          if (/\s/.test(text[index])) {
            index += 1;
            continue;
          }
          const end = text.slice(index).search(/\s/) === -1 ? text.length : index + text.slice(index).search(/\s/);
          const range = document.createRange();
          range.setStart(node, index);
          range.setEnd(node, end);
          for (const rect of Array.from(range.getClientRects())) {
            if (rect.width > 0 && rect.height > 0) {
              rects.push({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
            }
          }
          index = end;
        }
      }
      // Lines are rows of letters at the same height; a word broken across two lines appears in both.
      const tops = [...new Set(rects.map((rect) => Math.round(rect.y)))].sort((a, b) => a - b);
      const left = Math.min(...rects.map((rect) => rect.x));
      const top = Math.min(...rects.map((rect) => rect.y));
      const right = Math.max(...rects.map((rect) => rect.x + rect.width));
      const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
      return { text, lines: tops.length, box: { x: left, y: top, width: right - left, height: bottom - top } };
    });
  const words = measured.box;
  const middle = { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 };
  return {
    text: measured.text,
    // A word that is broken in half by a line break is drawn in two places and counted once.
    lines: measured.lines,
    box: words,
    offCentre: {
      x: words.x + words.width / 2 - middle.x,
      y: words.y + words.height / 2 - middle.y,
    },
    spills: words.x < shape.x - 1 || words.x + words.width > shape.x + shape.width + 1,
  };
}

/** Open a shape's label and type into it, the way a person does: a double-click, then letters. */
export async function typeShapeLabel(page: Page, id: string, text: string): Promise<void> {
  const at = await shapeCentre(page, id);
  await page.mouse.dblclick(at.x, at.y);
  const field = page.getByTestId('shape-textarea');
  await expect(field).toBeVisible();
  await page.keyboard.type(text);
  await expect(field).toHaveValue(text);
  // Closing the field is what puts the words back into the shape's label, which is the thing a
  // person reads afterwards; the field itself is where they are while typing.
  await page.keyboard.press('Escape');
  await expect(field).toHaveCount(0);
}

/** Drag a resize handle of the selected shape: the handle is where the shape's own box says it is. */
export async function resizeSelected(page: Page, handle: 'nw' | 'ne' | 'se' | 'sw' | 'n' | 'e' | 's' | 'w', delta: Point): Promise<void> {
  const locator = page.getByTestId(`resize-handle-${handle}`);
  const box = await locator.boundingBox();
  if (box === null) throw new Error(`the selection offers no ${handle} handle`);
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + delta.x / 2, from.y + delta.y / 2, { steps: 5 });
  await page.mouse.move(from.x + delta.x, from.y + delta.y, { steps: 5 });
  await page.mouse.up();
  await settled(page);
}

/** What the camera and the shape together say a shape's painted box should be. */
export function expectedPainted(camera: CameraOnPage, shape: { x: number; y: number; width: number; height: number }): ScreenBox {
  const from = worldToScreen(camera, { x: shape.x, y: shape.y });
  return { x: from.x, y: from.y, width: shape.width * camera.zoom, height: shape.height * camera.zoom };
}

// ---------------------------------------------------------------------------
// Pointing at arrows, and measuring where they are drawn
// ---------------------------------------------------------------------------

/**
 * Press an arrow: click along the line, which is what a person aims at.
 *
 * The click is placed at the middle of the strip the arrow paints to be clicked on, not at the middle
 * of an imagined line: what a person hits is what the browser is told about, and the strip is the
 * thing in the page that answers to a pointer.
 */
export async function selectArrow(page: Page, id: string): Promise<void> {
  const strip = arrowElement(page, id).getByTestId('connector-hit');
  const box = await strip.boundingBox();
  if (box === null) throw new Error(`the arrow ${id} paints no strip to press`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await settled(page);
}

/** Whether this page says this arrow is the thing that is picked up. */
export async function arrowSelected(page: Page, id: string): Promise<boolean> {
  return (await arrowElement(page, id).getAttribute('data-selected')) === 'true';
}

/** Where this page draws the point of an arrow's head, in screen pixels. */
export async function arrowHeadOnScreen(page: Page, id: string): Promise<Point> {
  return (await arrowHeadPainted(page, id)).point;
}

/**
 * How far the arrow's drawn head is from a place on the board, in screen pixels.
 *
 * The place is the point an arrow is *aimed* at — the side of a shape, or a free end — and the
 * distance is measured to the middle of the painted head, which is not the same as the aim: an arrow
 * is drawn with its line stopping short, so that the point of the head lands on the aim and the
 * triangle's own middle sits half an arrowhead back along the line. That is the drawing, not a
 * mistake, so it is written into the measurement rather than allowed for by a slack.
 */
export async function arrowHeadMiss(page: Page, id: string, aim: Point, from: Point): Promise<number> {
  const camera = await settled(page);
  const tip = worldToScreen(camera, aim);
  const tail = worldToScreen(camera, from);
  const length = Math.hypot(tip.x - tail.x, tip.y - tail.y) || 1;
  const back = (CONNECTOR_ARROWHEAD_SIZE_WORLD / 2) * camera.zoom;
  const expected = {
    x: tip.x + ((tail.x - tip.x) / length) * back,
    y: tip.y + ((tail.y - tip.y) / length) * back,
  };
  const head = await arrowHeadOnScreen(page, id);
  return Math.hypot(head.x - expected.x, head.y - expected.y);
}
