// Shapes and arrows, read out of a real browser's screen.
//
// Everything in here converts between the two coordinate systems a board has: its own
// units, and the pixels the browser painted. A test that compared a screen distance with a
// board distance would be testing whatever zoom it happened to run at, so the conversions
// happen once, here, against the camera the board itself reports through the test hook.
//
// Where board units are wanted, boxes come from the elements' inline styles rather than
// from `getBoundingClientRect()`: the world layer is scaled by a CSS transform, so
// `style.left` and `style.width` *are* board units, exactly, with no rounding from a zoom
// in the way. Where pixels are wanted — moving a mouse, measuring what a zoom does to the
// picture — the screen's own numbers are used, and they say so in their names.
//
// Spec: spec/stories/010-draw-shapes-and-connect-them-with-arrows-that-foll/design.md
import { expect, type Page } from '@playwright/test';
import {
  E2E_EVENTUAL_TIMEOUT_MS,
  SHAPE_LABEL_FONT_SIZE_WORLD,
  TEXT_LINE_HEIGHT,
} from '../../../src/shared/config';
import type { ShapeKind } from '../../../src/shared/config';
import type { Camera } from '../../../src/client/canvas/camera';
import { settle, VIEWPORT } from './board';
import type { Participant } from './participants';

export interface Point {
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ShapeInfo {
  id: string;
  kind: ShapeKind;
  fill: string;
  stroke: string;
  selected: boolean;
  editing: boolean;
  /** Board units. */
  box: Box;
}

export interface ArrowInfo {
  id: string;
  selected: boolean;
  /** The two points the line is drawn between, in board units. */
  from: Point;
  to: Point;
}

// --- the two coordinate systems ---------------------------------------------

/** The camera the board is looking through, in board units. */
export async function cameraOf(who: Participant): Promise<Camera> {
  const value = await who.page.evaluate(() => window.__vidi6?.getCamera());
  if (!value) throw new Error('the board is not publishing its camera to the test hook');
  return value;
}

/** How long one board unit is on this screen. */
export async function zoomOf(who: Participant): Promise<number> {
  return (await cameraOf(who)).zoom;
}

/** How long a board distance is on this screen, in pixels. */
export async function pixelsWide(who: Participant, world: number): Promise<number> {
  return world * (await zoomOf(who));
}

/** A point on the board, where it is on this screen. */
export async function screenOf(who: Participant, at: Point): Promise<Point> {
  const view = await cameraOf(who);
  return { x: (at.x - view.x) * view.zoom, y: (at.y - view.y) * view.zoom };
}

/** A point on this screen, on the board. */
export async function boardOf(who: Participant, at: Point): Promise<Point> {
  const view = await cameraOf(who);
  return { x: at.x / view.zoom + view.x, y: at.y / view.zoom + view.y };
}

/** The width one thing is drawn at on this screen, in pixels. */
export async function onScreenWidth(who: Participant, id: string): Promise<number> {
  const width = await who.page.evaluate((selector) => {
    const element = document.querySelector(selector);
    return element === null ? null : element.getBoundingClientRect().width;
  }, shapeSelector(id));
  if (width === null) throw new Error(`"${id}" is not on the screen to be measured`);
  return width;
}

/**
 * A point the pointer may be put at. Firefox reports coordinates outside the window as
 * (0, 0), which a board reads as a jump to the far side of the anchor, so a pointer that
 * would leave the window is taken to its edge instead.
 */
const inside = (at: Point): Point => ({
  x: Math.min(Math.max(at.x, 4), VIEWPORT.width - 4),
  y: Math.min(Math.max(at.y, 4), VIEWPORT.height - 4),
});

// --- the pointer -------------------------------------------------------------

/** Drag from one board point to another, the way a hand does it. */
export async function drag(
  who: Participant,
  from: Point,
  to: Point,
  options: { shift?: boolean } = {},
): Promise<void> {
  const a = inside(await screenOf(who, from));
  const b = inside(await screenOf(who, to));
  if (options.shift === true) await who.page.keyboard.down('Shift');
  await who.page.mouse.move(a.x, a.y);
  await who.page.mouse.down();
  await who.page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 5 });
  await who.page.mouse.move(b.x, b.y, { steps: 5 });
  await who.page.mouse.up();
  if (options.shift === true) await who.page.keyboard.up('Shift');
  await settle(who.page);
}

/** Press and release in one place: a click, which drops a shape. */
export async function click(who: Participant, at: Point): Promise<void> {
  const spot = inside(await screenOf(who, at));
  await who.page.mouse.click(spot.x, spot.y);
  await settle(who.page);
}

/** Put the pointer down at a board point and leave it there. */
export async function holdAt(who: Participant, at: Point): Promise<void> {
  const spot = inside(await screenOf(who, at));
  await who.page.mouse.move(spot.x, spot.y);
  await who.page.mouse.down();
  await settle(who.page);
}

/** Move to a board point with nothing pressed: hovering. */
export async function moveTo(who: Participant, at: Point): Promise<void> {
  const spot = inside(await screenOf(who, at));
  await who.page.mouse.move(spot.x, spot.y);
  await settle(who.page);
}

/** Let go where the pointer is. */
export async function release(who: Participant): Promise<void> {
  await who.page.mouse.up();
  await settle(who.page);
}

/**
 * A key, given to the board and not to a toolbar button that happens to hold the focus: a
 * focused button is a control rather than the board, so the board's own keys are not read
 * while it holds it.
 */
export async function pressKey(who: Participant, key: string): Promise<void> {
  await who.page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });
  await who.page.keyboard.press(key);
  await settle(who.page);
}

// --- the tools ---------------------------------------------------------------

export const pressShapeTool = (who: Participant): Promise<void> => pressKey(who, 's');
export const pressConnectorTool = (who: Participant): Promise<void> => pressKey(who, 'l');
export const pressSelectTool = (who: Participant): Promise<void> => pressKey(who, 'v');

/** Which tool the rail says is up. */
export const toolIsOn = (who: Participant, id: string): Promise<boolean> =>
  who.page.evaluate((tool) => {
    const button = document.querySelector(`[data-testid="tool-${tool}"]`);
    return button?.getAttribute('aria-pressed') === 'true';
  }, id);

/** The sheet of a drawing tool is over the board, so that tool is the one drawing. */
export const toolSheetIsUp = (who: Participant, id: 'shape' | 'connector'): Promise<boolean> =>
  who.page.evaluate((tool) => document.querySelector(`[data-testid="${tool}-tool"]`) !== null, id);

/** Which shape the Shape tool draws next. */
export async function pickShapeKind(who: Participant, kind: ShapeKind): Promise<void> {
  const button = who.page.getByTestId(`shape-kind-${kind}`);
  await expect(button).toBeVisible();
  await button.click();
  await settle(who.page);
}

/**
 * Drag with the Shape tool and hand back the shape that came of it. The drag is done in
 * board points; the ids are the board's own business, so they are read back rather than
 * guessed at.
 */
export async function drawShape(
  who: Participant,
  from: Point,
  to: Point,
  options: { shift?: boolean } = {},
): Promise<string> {
  await pressShapeTool(who);
  await expect(who.page.getByTestId('shape-tool')).toBeVisible();
  const before = await shapeIds(who);
  await drag(who, from, to, options);
  return onlyNew(before, await shapeIds(who), 'shape');
}

/** Click with the Shape tool: a shape of the default size, centred where you clicked. */
export async function dropShape(who: Participant, at: Point): Promise<string> {
  await pressShapeTool(who);
  await expect(who.page.getByTestId('shape-tool')).toBeVisible();
  const before = await shapeIds(who);
  await click(who, at);
  return onlyNew(before, await shapeIds(who), 'shape');
}

/** Drag with the Connector tool: an arrow between whatever was under each end. */
export async function drawArrow(who: Participant, from: Point, to: Point): Promise<string | null> {
  await pressConnectorTool(who);
  await expect(who.page.getByTestId('connector-tool')).toBeVisible();
  const before = await arrowIds(who);
  await drag(who, from, to);
  const created = (await arrowIds(who)).filter((id) => !before.includes(id));
  return created[0] ?? null;
}

function onlyNew(before: string[], after: string[], what: string): string {
  const created = after.filter((id) => !before.includes(id));
  if (created.length !== 1) throw new Error(`the drag made ${String(created.length)} ${what}s`);
  return created[0] as string;
}

// --- shapes ------------------------------------------------------------------

function shapeSelector(id: string): string {
  return `[data-testid="shape-object"][data-id="${id}"]`;
}

/** Every shape on the screen, in the order the board drew them. */
export const shapeIds = (who: Participant): Promise<string[]> =>
  who.page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="shape-object"]')).map(
      (element) => (element as HTMLElement).dataset.id as string,
    ),
  );

export const shapeCount = (who: Participant): Promise<number> =>
  who.page.evaluate(() => document.querySelectorAll('[data-testid="shape-object"]').length);

/** The shapes the board says are chosen. */
export const selectedShapeIds = (who: Participant): Promise<string[]> =>
  who.page.evaluate(() =>
    Array.from(
      document.querySelectorAll('[data-testid="shape-object"][data-selected="true"]'),
    ).map((element) => (element as HTMLElement).dataset.id as string),
  );

/** One shape as this screen draws it, or null once it is not on the screen. */
export async function shape(who: Participant, id: string): Promise<ShapeInfo | null> {
  const read = await who.page.evaluate((selector) => {
    const element = document.querySelector(selector) as HTMLElement | null;
    if (element === null) return null;
    return {
      kind: element.dataset.kind as ShapeKind,
      fill: element.dataset.fill as string,
      stroke: element.dataset.stroke as string,
      selected: element.dataset.selected === 'true',
      editing: element.dataset.editing === 'true',
      // Board units: the world layer's transform does the scaling, not these numbers.
      box: {
        x: Number.parseFloat(element.style.left),
        y: Number.parseFloat(element.style.top),
        width: Number.parseFloat(element.style.width),
        height: Number.parseFloat(element.style.height),
      },
    };
  }, shapeSelector(id));
  return read === null ? null : { id, ...read };
}

/** The one shape on the board. */
export async function onlyShape(who: Participant): Promise<ShapeInfo> {
  const ids = await shapeIds(who);
  if (ids.length !== 1) throw new Error(`expected one shape, found ${String(ids.length)}`);
  const found = await shape(who, ids[0] as string);
  if (found === null) throw new Error('that shape is not on the screen');
  return found;
}

/** The centre of a shape, in board units. */
export async function shapeCentre(who: Participant, id: string): Promise<Point> {
  const found = await shape(who, id);
  if (found === null) throw new Error(`there is no shape "${id}" on the screen`);
  return { x: found.box.x + found.box.width / 2, y: found.box.y + found.box.height / 2 };
}

/** The middle of one of a shape's sides, in board units: where an arrow is tied. */
export async function sideMid(
  who: Participant,
  id: string,
  side: 'top' | 'right' | 'bottom' | 'left',
): Promise<Point> {
  const found = await shape(who, id);
  if (found === null) throw new Error(`there is no shape "${id}" on the screen`);
  const { x, y, width, height } = found.box;
  if (side === 'top') return { x: x + width / 2, y };
  if (side === 'right') return { x: x + width, y: y + height / 2 };
  if (side === 'bottom') return { x: x + width / 2, y: y + height };
  return { x, y: y + height / 2 };
}

/** The label as it is written on the shape. */
export async function shapeLabel(who: Participant, id: string): Promise<string> {
  const label = await who.page.evaluate((selector) => {
    const element = document.querySelector(`${selector} [data-testid="shape-object-label"]`);
    return element === null ? null : (element.textContent ?? '');
  }, shapeSelector(id));
  if (label === null) throw new Error(`the shape "${id}" has no label drawn`);
  return label;
}

/** How many lines a label is laid out in, and where the middle of it is on the screen. */
export async function labelLayout(
  who: Participant,
  id: string,
): Promise<{
  /** Lines of text, measured from the height the browser gave it. */
  lines: number;
  /** Pixels: the width the words took. */
  width: number;
  /** Pixels: the middle of the words, and of the shape they are on. */
  centre: Point;
  shapeCentre: Point;
  /** Pixels. */
  shapeWidth: number;
}> {
  const view = await cameraOf(who);
  const read = await who.page.evaluate((selector) => {
    const span = document.querySelector(`${selector} [data-testid="shape-object-label"] span`);
    const shape = document.querySelector(selector);
    if (span === null || shape === null) return null;
    const label = span.getBoundingClientRect();
    const box = shape.getBoundingClientRect();
    return {
      height: label.height,
      width: label.width,
      centre: { x: label.left + label.width / 2, y: label.top + label.height / 2 },
      shapeCentre: { x: box.left + box.width / 2, y: box.top + box.height / 2 },
      shapeWidth: box.width,
    };
  }, shapeSelector(id));
  if (read === null) throw new Error(`the shape "${id}" has no label laid out`);
  const oneLine = SHAPE_LABEL_FONT_SIZE_WORLD * TEXT_LINE_HEIGHT * view.zoom;
  return {
    // Rounded, because the height of a line of text is the font's business: what these
    // tests compare is one layout against another, never a number of pixels.
    lines: Math.max(1, Math.round(read.height / oneLine)),
    width: read.width,
    centre: read.centre,
    shapeCentre: read.shapeCentre,
    shapeWidth: read.shapeWidth,
  };
}

/**
 * Double-click a shape, type its label, and leave the editor.
 *
 * The characters go in at something like the speed of a person (`delay`), not as fast as a
 * driver can push them. That is not cosmetics: typing 150 characters with no delay at all
 * makes React report "Maximum update depth exceeded", because every character commits a
 * Yjs transaction and `useBoardDoc`'s snapshot is legitimately new each time, so the store
 * is told of a change while React is still rendering the last one. It is the store binding
 * and not the shape — typing the same string, as fast, into a story 1 sticky note does the
 * same thing, which is what NOTES.md records and what this delay is a workaround for.
 */
export async function typeLabel(who: Participant, id: string, text: string): Promise<void> {
  const centre = inside(await screenOf(who, await shapeCentre(who, id)));
  await who.page.mouse.dblclick(centre.x, centre.y);
  await expect(who.page.locator('[data-testid="shape-object-editor"]')).toBeVisible();
  await who.page.keyboard.type(text, { delay: 12 });
  await settle(who.page);
  // The way out of a text editor that is the same on every object on this board.
  await who.page.keyboard.press('Escape');
  await settle(who.page);
  await expect(who.page.locator('[data-testid="shape-object-editor"]')).toHaveCount(0);
}

// --- arrows ------------------------------------------------------------------

/** Every arrow on the screen. */
export const arrowIds = (who: Participant): Promise<string[]> =>
  who.page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="connector-object"]')).map(
      (element) => (element as HTMLElement).dataset.id as string,
    ),
  );

export const arrowCount = (who: Participant): Promise<number> =>
  who.page.evaluate(() => document.querySelectorAll('[data-testid="connector-object"]').length);

/**
 * An arrow as it is drawn: the two points its line runs between, in board units, read off
 * the invisible sleeve that is there to be clicked on. Null once the arrow is not on the
 * screen, which is how a test tells "gone" from "drawn somewhere else".
 */
export async function arrow(who: Participant, id: string): Promise<ArrowInfo | null> {
  const read = await who.page.evaluate((selector) => {
    const element = document.querySelector(selector) as HTMLElement | null;
    if (element === null) return null;
    const sleeve = element.querySelector('[data-testid="connector-hit"]');
    const points = (sleeve?.getAttribute('points') ?? '')
      .trim()
      .split(/\s+/)
      .filter((part) => part.length > 0)
      .map((part) => {
        const [x, y] = part.split(',').map((value) => Number.parseFloat(value));
        return x === undefined || y === undefined ? null : { x, y };
      });
    if (points.length !== 2 || points[0] === null || points[1] === null) return null;
    return {
      selected: element.dataset.selected === 'true',
      from: points[0] as Point,
      to: points[1] as Point,
    };
  }, `[data-testid="connector-object"][data-id="${id}"]`);
  return read === null ? null : { id, ...read };
}

/** The one arrow on the board. */
export async function onlyArrow(who: Participant): Promise<ArrowInfo> {
  const ids = await arrowIds(who);
  if (ids.length !== 1) throw new Error(`expected one arrow, found ${String(ids.length)}`);
  const found = await arrow(who, ids[0] as string);
  if (found === null) throw new Error('that arrow is not drawn between two points');
  return found;
}

/** The selected arrow's ends as one number pair, rounded: enough to tell a layout from another. */
export async function arrowEndKey(who: Participant, id: string): Promise<number[] | null> {
  const found = await arrow(who, id);
  if (found === null) return [];
  return [Math.round(found.from.x), Math.round(found.from.y), Math.round(found.to.x), Math.round(found.to.y)];
}

/** The connection points the Connector tool is offering, and the one that is lit. */
export async function connectorDots(who: Participant): Promise<{ sides: string[]; lit: string[] }> {
  return who.page.evaluate(() => {
    const dots = Array.from(document.querySelectorAll('[data-testid^="connector-dot-"]')) as HTMLElement[];
    return {
      sides: dots.map((dot) => dot.dataset.side as string),
      lit: dots
        .filter((dot) => dot.dataset.active === 'true')
        .map((dot) => dot.dataset.side as string),
    };
  });
}

/** The distance between two board points. */
export const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

/** The screen positions of everything a test needs to know about a screen's arrows. */
export async function arrowsOn(who: Participant): Promise<ArrowInfo[]> {
  const ids = await arrowIds(who);
  const read: ArrowInfo[] = [];
  for (const id of ids) {
    const found = await arrow(who, id);
    if (found !== null) read.push(found);
  }
  return read;
}

/** Wait until a screen is showing exactly the shapes a test expects, and say how long. */
/**
 * Wait for a screen to be showing exactly the shapes a test expects. Another person's
 * work has to arrive for this, so it is waited for with the suite's functional timeout.
 */
export async function waitForShapeIds(who: Participant, expected: string[]): Promise<void> {
  await expect
    .poll(async () => JSON.stringify((await shapeIds(who)).slice().sort()), {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
      intervals: [100],
      message: `the shapes on the screen are not ${String(expected)}`,
    })
    .toBe(JSON.stringify(expected.slice().sort()));
  await settle(who.page);
}

/** Wait until a shape has left a screen. */
export async function waitForShapeGone(who: Participant, id: string): Promise<void> {
  await expect
    .poll(async () => (await shape(who, id)) === null, {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
      intervals: [100],
      message: `"${id}" is still on the screen`,
    })
    .toBe(true);
  await settle(who.page);
}

/** Wait for a screen to be showing exactly the arrows a test expects. */
export async function waitForArrowIds(who: Participant, expected: string[]): Promise<void> {
  await expect
    .poll(async () => JSON.stringify((await arrowIds(who)).slice().sort()), {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
      intervals: [100],
      message: `the arrows on the screen are not ${String(expected)}`,
    })
    .toBe(JSON.stringify(expected.slice().sort()));
  await settle(who.page);
}

/** A resize handle of the chosen shape, dragged by a given board distance. */
export async function dragHandle(
  who: Participant,
  handle: string,
  dx: number,
  dy: number,
): Promise<void> {
  const locator = who.page.locator(`[data-testid="resize-handle"][data-handle="${handle}"]`);
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  if (!box) throw new Error(`the "${handle}" handle has no box`);
  const from = inside({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
  const to = inside({ x: from.x + dx * (await zoomOf(who)), y: from.y + dy * (await zoomOf(who)) });
  await who.page.mouse.move(from.x, from.y);
  await who.page.mouse.down();
  await who.page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 });
  await who.page.mouse.move(to.x, to.y, { steps: 5 });
  await who.page.mouse.up();
  await settle(who.page);
}

export type { Page };
