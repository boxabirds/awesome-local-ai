/// <reference path="../../../src/client/testHooks.ts" />
import { expect, type Locator, type Page } from '@playwright/test';
import {
  readCamera,
  settle,
  VIEWPORT,
  type ScreenPoint,
} from './board';
import { dragPointer } from './sticky';
import {
  centreOnScreen,
  outlineIds,
  placeOf,
  screenOf,
  type Place,
} from './selection';
import { CONNECTOR_MIN_LENGTH_WORLD, SHAPE_DEFAULT_SIZE_WORLD } from '../../../src/shared/config';

/**
 * Shapes and arrows, seen the way a person sees them: through the elements they are drawn in.
 *
 * Nothing here reads the document. The drawing is what a person is shown, and on a board two people
 * share the drawing on one screen is the thing that has to be right - which is also why the arrow's
 * ends are read off its element rather than computed from the fixture: an arrow that is stored as two
 * *things* shows a point, and the point it shows is the whole of the story.
 */

/** Which tool the board says is up, as the toolbar's pressed state and the board's own readout. */
export type ShapeToolName = 'select' | 'text' | 'shape' | 'connector';

export const toolButton = (page: Page, tool: ShapeToolName): Locator =>
  page.getByTestId(`tool-${tool}`);

export const shapeKindButton = (page: Page, kind: string): Locator =>
  page.getByTestId(`shape-kind-${kind}`);

export const shapePreview = (page: Page): Locator => page.getByTestId('shape-preview');
export const connectorPreview = (page: Page): Locator => page.getByTestId('connector-preview');
export const connectorDots = (page: Page): Locator => page.getByTestId('connector-dot');
export const connectorTargetDot = (page: Page): Locator =>
  page.getByTestId('connector-target-dot');

export const shapes = (page: Page): Locator => page.getByTestId('shape-object');
export const connectors = (page: Page): Locator => page.getByTestId('connector-object');

export const shapeById = (page: Page, id: string): Locator =>
  page.locator(`[data-testid="shape-object"][data-object-id="${id}"]`);

export const connectorById = (page: Page, id: string): Locator =>
  page.locator(`[data-testid="connector-object"][data-object-id="${id}"]`);

export const shapeLabel = (page: Page, id: string): Locator =>
  shapeById(page, id).getByTestId('shape-label');

export const shapeLabelEditor = (page: Page): Locator => page.getByTestId('shape-label-editor');

/** The wide invisible line an arrow is clicked on. */
export const arrowLine = (page: Page, id: string): Locator =>
  connectorById(page, id).getByTestId('connector-hit');

/** One of an arrow's two ends, shown when the arrow is selected. */
export const endHandle = (page: Page, id: string, end: 'from' | 'to'): Locator =>
  connectorById(page, id).getByTestId(`connector-handle-${end}`);

/** A colour swatch of the shape toolbar: `fill-blue`, `stroke-red`, `fill-no`. */
export const swatch = (page: Page, name: string): Locator =>
  page.getByTestId('shape-toolbar').getByRole('button', { name: new RegExp(`^${name}$`) });

/** What a shape on the screen says about itself. */
export interface ShapeState {
  id: string;
  kind: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  stroke: string;
  label: string;
  selected: boolean;
}

/** What an arrow on the screen says about itself, including where its two ends are drawn. */
export interface ArrowState {
  id: string;
  /** `attached` or `free`, which is the whole of what an end is. */
  fromEnd: string;
  toEnd: string;
  /** The shape an end is fastened to, or the empty string when it is fastened to nothing. */
  fromTarget: string;
  toTarget: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  x: number;
  y: number;
  width: number;
  height: number;
  selected: boolean;
}

/** The shape of the read: an element's own attributes, whatever kind of object it is drawn from. */
async function attributes(of: Locator): Promise<Record<string, string>> {
  return of.evaluate((element) => {
    const read: Record<string, string> = {};
    for (const name of [
      'data-object-id',
      'data-kind',
      'data-fill',
      'data-stroke',
      'data-x',
      'data-y',
      'data-width',
      'data-height',
      'data-z',
      'data-selected',
      'data-from-end',
      'data-to-end',
      'data-from-target',
      'data-to-target',
      'data-from-x',
      'data-from-y',
      'data-to-x',
      'data-to-y',
    ]) {
      read[name] = element.getAttribute(name) ?? '';
    }
    return read;
  });
}

/** Read a shape's own report of where it is and what it looks like. */
export async function shapeState(page: Page, id: string): Promise<ShapeState> {
  const element = shapeById(page, id);
  const read = await attributes(element);
  return {
    id,
    kind: read['data-kind'] ?? '',
    x: Number(read['data-x']),
    y: Number(read['data-y']),
    width: Number(read['data-width']),
    height: Number(read['data-height']),
    fill: read['data-fill'] ?? '',
    stroke: read['data-stroke'] ?? '',
    label: (await element.getByTestId('shape-label').innerText()).trim(),
    selected: read['data-selected'] === 'true',
  };
}

/** Read an arrow's own report: which ends are fastened to a shape, and the points it is drawn to. */
export async function arrowState(page: Page, id: string): Promise<ArrowState> {
  const read = await attributes(connectorById(page, id));
  return {
    id,
    fromEnd: read['data-from-end'] ?? '',
    toEnd: read['data-to-end'] ?? '',
    fromTarget: read['data-from-target'] ?? '',
    toTarget: read['data-to-target'] ?? '',
    fromX: Number(read['data-from-x']),
    fromY: Number(read['data-from-y']),
    toX: Number(read['data-to-x']),
    toY: Number(read['data-to-y']),
    x: Number(read['data-x']),
    y: Number(read['data-y']),
    width: Number(read['data-width']),
    height: Number(read['data-height']),
    selected: read['data-selected'] === 'true',
  };
}

/** Every shape on the screen, by id. */
export async function shapeIds(page: Page): Promise<string[]> {
  return page.locator('[data-testid="shape-object"]').evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-object-id') ?? ''),
  );
}

/** Every arrow on the screen, by id. */
export async function arrowIds(page: Page): Promise<string[]> {
  return page.locator('[data-testid="connector-object"]').evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-object-id') ?? ''),
  );
}

/** Wait for the board to be showing this many shapes. */
export async function waitForShapeCount(page: Page, count: number): Promise<void> {
  await expect
    .poll(() => shapeIds(page).then((ids) => ids.length), {
      timeout: E2E_WAIT_MS,
      intervals: [10, 25, 50],
      message: `the board should be showing ${String(count)} shape(s)`,
    })
    .toBe(count);
}

/** Wait for the board to be showing this many arrows. */
export async function waitForArrowCount(page: Page, count: number): Promise<void> {
  await expect
    .poll(() => arrowIds(page).then((ids) => ids.length), {
      timeout: E2E_WAIT_MS,
      intervals: [10, 25, 50],
      message: `the board should be showing ${String(count)} arrow(s)`,
    })
    .toBe(count);
}

/**
 * How long a page is given to show something.
 *
 * `E2E_EVENTUAL_TIMEOUT_MS` is the room's budget, for a change that has to cross between two
 * browsers; this is a page catching up with its own mouse, which is a frame or two. The longer
 * timeout is used anyway, because a page that is slow on a loaded machine is not a bug in story 10,
 * and no test here asserts anything about how long a wait took.
 */
const E2E_WAIT_MS = 15_000;

/** Wait until the board is drawing this shape. */
export async function waitForShape(page: Page, id: string): Promise<ShapeState> {
  await expect
    .poll(async () => (await shapeIds(page)).includes(id), {
      timeout: E2E_WAIT_MS,
      intervals: [10, 25, 50],
      message: `the board should be drawing shape ${id}`,
    })
    .toBe(true);
  return shapeState(page, id);
}

/** Wait until the board is drawing this arrow. */
export async function waitForArrow(page: Page, id: string): Promise<ArrowState> {
  await expect
    .poll(async () => (await arrowIds(page)).includes(id), {
      timeout: E2E_WAIT_MS,
      intervals: [10, 25, 50],
      message: `the board should be drawing arrow ${id}`,
    })
    .toBe(true);
  return arrowState(page, id);
}

/** Wait until the board has stopped drawing this arrow, which is what a delete looks like. */
export async function waitForArrowGone(page: Page, id: string): Promise<void> {
  await expect
    .poll(async () => (await arrowIds(page)).includes(id), {
      timeout: E2E_WAIT_MS,
      intervals: [10, 25, 50],
      message: `arrow ${id} should have left the board`,
    })
    .toBe(false);
}

/** Wait until the board has stopped drawing this shape, which is what a delete looks like. */
export async function waitForShapeGone(page: Page, id: string): Promise<void> {
  await expect
    .poll(async () => (await shapeIds(page)).includes(id), {
      timeout: E2E_WAIT_MS,
      intervals: [10, 25, 50],
      message: `shape ${id} should have left the board`,
    })
    .toBe(false);
}

/** The tool that is up, as the board says on its own surface. */
export async function activeTool(page: Page): Promise<string | null> {
  return page.getByTestId('board-viewport').getAttribute('data-tool');
}

/** Put a tool up, by its button, and wait for the board to say so. */
export async function armTool(page: Page, tool: ShapeToolName): Promise<void> {
  await toolButton(page, tool).click();
  await expect(activeTool(page)).resolves.toBe(tool);
  await settle(page);
}

/** Choose which shape the Shape tool will draw. */
export async function armShape(page: Page, kind: string): Promise<void> {
  await armTool(page, 'shape');
  await shapeKindButton(page, kind).click();
  await settle(page);
}

/**
 * Drag the Shape tool across the board, Shift held or not, and give back the shape it made.
 *
 * The id is not known until the drag is over, so it is found by asking which shape the board was not
 * showing before - the same way a person notices a new shape, and a surer way than counting, since the
 * board of a story 10 test usually has shapes on it already.
 */
export async function drawShape(
  page: Page,
  from: ScreenPoint,
  to: ScreenPoint,
  options: { shift?: boolean; steps?: number } = {},
): Promise<string> {
  const before = await shapeIds(page);
  await ontoTheBoard(page, from);
  await page.mouse.move(from.x, from.y);
  if (options.shift === true) {
    await page.keyboard.down('Shift');
  }
  await page.mouse.down();
  // A drag that teleports from one end to the other would be a drag nobody makes, and the preview has
  // to be seen while it happens rather than only after it.
  await page.mouse.move(to.x, to.y, { steps: options.steps ?? 8 });
  if (options.shift === true) {
    await page.keyboard.up('Shift');
  }
  await page.mouse.up();
  await settle(page);
  return await newShapeOf(page, before);
}

/** Press the Shape tool once, without dragging: the shape of the default size, centred on the point. */
export async function clickShape(page: Page, at: ScreenPoint): Promise<string> {
  const before = await shapeIds(page);
  await ontoTheBoard(page, at);
  await page.mouse.click(at.x, at.y);
  await settle(page);
  return await newShapeOf(page, before);
}

/** Pull an arrow from one point of the screen to another, and give back the arrow it made. */
export async function drawArrow(
  page: Page,
  from: ScreenPoint,
  to: ScreenPoint,
  steps = 8,
): Promise<string> {
  const before = await arrowIds(page);
  await ontoTheBoard(page, from);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
  await settle(page);
  return await newArrowOf(page, before);
}

/**
 * Pull an arrow and let go somewhere else, holding the pointer down the whole time.
 *
 * The two halves are separate because a test about two people cannot wait for a gesture that is
 * happening in somebody else's hands: this one presses, the other one acts, and this one lets go.
 */
export async function beginArrow(page: Page, from: ScreenPoint, towards: ScreenPoint): Promise<void> {
  await ontoTheBoard(page, from);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // Somewhere in the middle, so the arrow is out and on the screen while the other person acts.
  await page.mouse.move(from.x + (towards.x - from.x) / 3, from.y + (towards.y - from.y) / 3, {
    steps: 3,
  });
  await settle(page);
}

export async function finishArrow(page: Page, to: ScreenPoint): Promise<void> {
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
  await settle(page);
}

/** Drag one of an arrow's ends somewhere else: the way an arrow is moved from one shape to another. */
export async function dragEnd(
  page: Page,
  id: string,
  end: 'from' | 'to',
  to: ScreenPoint,
): Promise<void> {
  const handle = endHandle(page, id, end);
  const box = await handle.boundingBox();
  if (box === null) {
    throw new Error(`arrow ${id} has no ${end} handle on screen (is it selected?)`);
  }
  await dragPointer(
    page,
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    to,
  );
}

/** Press a shape or an arrow, and wait until the board says it is the whole selection. */
export async function selectById(page: Page, id: string): Promise<void> {
  const at = await centreOnScreen(page, id);
  await page.mouse.click(at.x, at.y);
  await expect
    .poll(() => outlineIds(page), { timeout: E2E_WAIT_MS })
    .toContain(id);
}

/** The object's own box as drawn on this screen, in pixels: what a ±1 px assertion is about. */
export async function drawnBox(page: Page, id: string): Promise<{
  x: number;
  y: number;
  width: number;
  height: number;
}> {
  const box = await shapeById(page, id).boundingBox();
  if (box === null) {
    throw new Error(`shape ${id} is not drawn on the screen`);
  }
  return { x: box.x, y: box.y, width: box.width, height: box.height };
}

/** Where an object is, in board units, read off the element it is drawn in. */
export function drawnPlace(page: Page, id: string): Promise<Place> {
  return placeOf(page, id);
}

/**
 * Where a point of the board is on the screen, at the camera this page is drawing with.
 *
 * Tests write board coordinates, because those are what the fixture is written in, and this turns them
 * into the pixels a mouse has to be put in - at 200% zoom, on the far side of the board, anywhere.
 */
export const screenPointOf = screenOf;

/** The camera that puts a board point in the middle of the screen at `zoom`. */
export function cameraAround(world: ScreenPoint, zoom: number): { x: number; y: number; zoom: number } {
  return {
    x: world.x - VIEWPORT.width / 2 / zoom,
    y: world.y - VIEWPORT.height / 2 / zoom,
    zoom,
  };
}

/**
 * Select an arrow by clicking its line.
 *
 * The click is placed by computing where the line is, in board units, and turning that into pixels at
 * the zoom this page is at. Playwright's own click on the line's element would be a click on the middle
 * of the element's box, which for a diagonal line is a point that is not on the line - and a test that
 * clicked next to an arrow and found it selected would have proved nothing.
 */
export async function selectArrow(page: Page, id: string): Promise<void> {
  const state = await arrowState(page, id);
  const at = await screenPointOf(page, {
    x: (state.fromX + state.toX) / 2,
    y: (state.fromY + state.toY) / 2,
  });
  await page.mouse.click(at.x, at.y);
  await expect
    .poll(() => outlineIds(page), { timeout: E2E_WAIT_MS })
    .toContain(id);
}

/**
 * Click a given number of screen pixels away from an arrow's line, and say whether it was taken.
 *
 * The distance is written in screen pixels, because that is what the tolerance is made of, and turned
 * into board units by dividing by the zoom - which is the arithmetic under test as much as the click is.
 * The offset is put across the line at right angles, from its middle, so the point is off the line by
 * exactly the offset and nothing else.
 *
 * `clearAt` is a patch of bare board the selection is put down on first, and the helper waits for the
 * board to have let go of the arrow before it clicks again. Without that the answer would be "was the
 * arrow selected after this click", which is not the question: a board that kept the previous choice
 * would say yes to a click that hit nothing.
 */
export async function clickNearArrow(
  page: Page,
  id: string,
  screenPixels: number,
  clearAt: ScreenPoint,
): Promise<boolean> {
  const state = await arrowState(page, id);
  const camera = await readCamera(page);
  // A unit vector across the line, in board units.
  const dx = state.toX - state.fromX;
  const dy = state.toY - state.fromY;
  const away = Math.hypot(dx, dy);
  if (away === 0) {
    throw new Error(`arrow ${id} is drawn with no length at all`);
  }
  const offset = screenPixels / camera.zoom;
  const world = {
    x: (state.fromX + state.toX) / 2 + (-dy / away) * offset,
    y: (state.fromY + state.toY) / 2 + (dx / away) * offset,
  };
  await putSelectionDown(page, id, clearAt);
  const at = await screenOf(page, world);
  await page.mouse.click(at.x, at.y);
  await settle(page);
  return (await outlineIds(page)).includes(id);
}

/** Put the board down with nothing chosen, and wait until it has let go of a particular object. */
export async function putSelectionDown(page: Page, id: string, clearAt: ScreenPoint): Promise<void> {
  const at = await screenOf(page, clearAt);
  await ontoTheBoard(page, at);
  await page.mouse.click(at.x, at.y);
  await expect
    .poll(() => outlineIds(page), {
      timeout: E2E_WAIT_MS,
      intervals: [10, 25, 50],
      message: 'a click on bare board should have let go of the arrow',
    })
    .not.toContain(id);
}

/** Is an arrow the selection, as the board draws it? */
export async function arrowIsSelected(page: Page, id: string): Promise<boolean> {
  return (await outlineIds(page)).includes(id);
}

/** Delete what is selected, with the key rather than the button. */
export async function pressDelete(page: Page): Promise<void> {
  await page.keyboard.press('Delete');
  await settle(page);
}

/** The distance between two drawn points, in board units. */
export function length(from: { x: number; y: number }, to: { x: number; y: number }): number {
  return Math.hypot(to.x - from.x, to.y - from.y);
}

/** The one shape that has appeared since `before`, which is the one the gesture just made. */
async function newShapeOf(page: Page, before: readonly string[]): Promise<string> {
  const added = (await shapeIds(page)).filter((id) => !before.includes(id));
  if (added.length !== 1) {
    throw new Error(
      `the drag was to have made one shape and the board shows ${String(added.length)} new one(s)` +
        ` (of ${String((await shapeIds(page)).length)} shapes)`,
    );
  }
  const id = added[0];
  if (id === undefined) {
    throw new Error('the board showed a shape with no id');
  }
  return id;
}

/** The one arrow that has appeared since `before`. */
async function newArrowOf(page: Page, before: readonly string[]): Promise<string> {
  const added = (await arrowIds(page)).filter((id) => !before.includes(id));
  if (added.length !== 1) {
    throw new Error(
      `the drag was to have made one arrow and the board shows ${String(added.length)} new one(s)`,
    );
  }
  const id = added[0];
  if (id === undefined) {
    throw new Error('the board showed an arrow with no id');
  }
  return id;
}

/**
 * The lines of a shape's label as the browser laid them out, one box per wrapped line.
 *
 * This is the only way to ask a real browser whether text wrapped: the string in the document is one
 * string whatever the width, and a line break exists only in the drawing.
 *
 * The boxes are gathered word by word rather than by taking one range over the whole label, because
 * Chromium gives a box for a space at the end of a wrapped line as well - the space is not drawn there,
 * but it still has a rect - and a measurement that counted it finds the line's ink a few pixels off
 * centre when it is exactly in the middle. Words are found in the text node by their offsets, a range
 * is put around each, and every box that comes back is a box of ink.
 */
export async function labelLines(
  page: Page,
  id: string,
): Promise<{ x: number; width: number; centre: number; y: number; height: number }[]> {
  const boxes = await shapeLabel(page, id).evaluate((element) => {
    const words: { x: number; y: number; width: number; height: number }[] = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const text = node.textContent ?? '';
      const found = text.match(/\S+/g) ?? [];
      let offset = 0;
      for (const word of found) {
        const start = text.indexOf(word, offset);
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, start + word.length);
        for (const rect of Array.from(range.getClientRects())) {
          if (rect.width > 0 && rect.height > 0) {
            words.push({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
          }
        }
        range.detach();
        offset = start + word.length;
      }
    }
    // Words that share a line of the drawing share a top, to within a pixel of rounding: that is what
    // a line of text is, from the browser's point of view.
    const lines: { x: number; right: number; y: number; height: number }[] = [];
    for (const word of words.sort((a, b) => a.y - b.y || a.x - b.x)) {
      const line = lines.find((candidate) => Math.abs(candidate.y - word.y) < 2);
      if (line === undefined) {
        lines.push({ x: word.x, right: word.x + word.width, y: word.y, height: word.height });
      } else {
        line.x = Math.min(line.x, word.x);
        line.right = Math.max(line.right, word.x + word.width);
        line.height = Math.max(line.height, word.height);
      }
    }
    return lines.map((line) => ({
      x: line.x,
      width: line.right - line.x,
      y: line.y,
      height: line.height,
    }));
  });
  return boxes.map((box) => ({
    x: box.x,
    width: box.width,
    y: box.y,
    height: box.height,
    centre: box.x + box.width / 2,
  }));
}

/** Double-click a shape's label and wait for the board to hand it out for editing. */
export async function openLabelEditor(page: Page, id: string): Promise<void> {
  const at = await centreOnScreen(page, id);
  await page.mouse.dblclick(at.x, at.y);
  await expect(shapeLabelEditor(page)).toBeVisible();
}

/** Stop editing a label, keeping what was typed, by pressing Escape in the field. */
export async function stopLabelEditing(page: Page): Promise<void> {
  await shapeLabelEditor(page).press('Escape');
  await settle(page);
}

/** The label's own box on the screen, which is what "centred" is measured against. */
export async function labelBox(page: Page, id: string): Promise<{ x: number; width: number }> {
  const box = await shapeLabel(page, id).boundingBox();
  if (box === null) {
    throw new Error(`shape ${id} has no label drawn`);
  }
  return { x: box.x, width: box.width };
}

/**
 * Insist that a point of the screen is board and not furniture.
 *
 * The tools ignore a press that lands on the toolbar, the selection bar or a colour swatch - which is
 * right for a person and misleading for a test, because the gesture then happens with no tool paying
 * attention and the test reports that nothing was drawn. This says so instead.
 */
export async function ontoTheBoard(page: Page, at: ScreenPoint): Promise<void> {
  const furniture = await page.evaluate((point) => {
    const element = document.elementFromPoint(point.x, point.y);
    const ui = element?.closest('[data-board-ui]') ?? null;
    if (ui === null) {
      return null;
    }
    return ui.getAttribute('data-testid') ?? ui.getAttribute('class') ?? 'board furniture';
  }, at);
  if (furniture !== null) {
    throw new Error(
      `the pointer was put at ${String(Math.round(at.x))}, ${String(
        Math.round(at.y),
      )}, which is on the ${furniture} rather than on the board: no tool will answer that press. ` +
        'Move the gesture to a clear patch of board, or move the camera.',
    );
  }
}

/** The default shape's side, in board units: what a click without a drag is expected to make. */
export const DEFAULT_SHAPE_SIDE = SHAPE_DEFAULT_SIZE_WORLD;
/** The shortest arrow the board will keep, in board units. */
export const SHORTEST_ARROW = CONNECTOR_MIN_LENGTH_WORLD;
