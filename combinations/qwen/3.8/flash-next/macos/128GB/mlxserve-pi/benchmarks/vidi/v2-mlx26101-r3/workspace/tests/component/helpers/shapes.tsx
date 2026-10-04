import { fireEvent } from '@testing-library/react';
import { flushFrames } from '../helpers';
import { press, pressCombo, release, type MountedSticky } from './sticky';
import {
  CONNECTOR_TYPE,
  SHAPE_TYPE,
  snapshot,
  type ObjectSnapshot,
} from '../../../src/shared/board-model';
import { asShapeSnapshot, type ShapeSnapshot } from '../../../src/shared/objects/shape';
import { asConnectorSnapshot, type ConnectorSnapshot } from '../../../src/shared/objects/connector';
import { worldToScreen, type Point } from '../../../src/client/canvas/camera';
import type { End } from '../../../src/shared/geometry/connector-geometry';

/**
 * Shapes and arrows, at the level of a screen: the tool keys, the elements a tool draws, the objects
 * a drag leaves behind.
 *
 * Everything here is measured in world units and converted by the camera the app is using, because
 * the camera is the app's business: a test that wrote down screen coordinates would be a test that
 * passed only while nobody zoomed.
 */

/** Which tool the board says is up. */
export function activeTool(board: MountedSticky): string | undefined {
  return board.board.dataset.tool;
}

/** The toolbar's button for a tool, whatever tool it is. */
export function toolButton(board: MountedSticky, tool: string): HTMLElement {
  const button = board.view.container.querySelector<HTMLElement>(`[data-testid="tool-${tool}"]`);
  if (button === null) {
    throw new Error(`the toolbar has no ${tool} button`);
  }
  return button;
}

/** Whether the toolbar says this tool is the one that is up. */
export function toolPressed(board: MountedSticky, tool: string): boolean {
  return toolButton(board, tool).getAttribute('aria-pressed') === 'true';
}

/**
 * Press a tool's letter, and say whether the board took the keystroke.
 *
 * The return value is the assertion a good half of these tests want: a board that cannot be written
 * to leaves the key to the browser, and `defaultPrevented` is the only place that answer is visible
 * from outside.
 */
export function pressToolKey(code: string): boolean {
  return pressCombo(code);
}

/** Put the Shape tool up, optionally having first chosen which shape it will draw. */
export async function armShape(board: MountedSticky, kind?: string): Promise<void> {
  pressCombo('KeyS');
  await flushFrames();
  if (kind !== undefined) {
    const button = board.view.container.querySelector<HTMLElement>(`[data-testid="shape-kind-${kind}"]`);
    if (button === null) {
      throw new Error(`the toolbar offers no ${kind} kind (is the Shape tool up?)`);
    }
    fireEvent.click(button);
    await flushFrames();
  }
}

/** Put the Connector tool up. */
export async function armConnector(board: MountedSticky): Promise<void> {
  pressCombo('KeyL');
  await flushFrames();
  // Said out loud rather than left to the next assertion: when the key does not arm the tool, every
  // test after this one fails over a dot that never appeared, which is a bad place to find out.
  if (activeTool(board) !== 'connector') {
    throw new Error('L did not put the Connector tool up');
  }
}

/** Point the pointer at a world point, without pressing anything. */
export async function hoverAt(board: MountedSticky, world: Point): Promise<void> {
  const at = board.screenOf(world);
  fireEvent.pointerMove(window, { pointerId: 1, pointerType: 'mouse', buttons: 0, clientX: at.x, clientY: at.y });
  await flushFrames();
}

/** Let go of the pointer wherever the last move left it. */
export async function pressEscape(): Promise<void> {
  fireEvent.keyDown(window, { key: 'Escape' });
  await flushFrames();
}

/** The objects of a type, as elements - the objects themselves, not the marks drawn over them. */
export function objectElements(board: MountedSticky, type: string): HTMLElement[] {
  return [
    ...board.view.container.querySelectorAll<HTMLElement>(
      `[data-object-type="${type}"]:not(.selection-outline)`,
    ),
  ];
}

export function shapeElements(board: MountedSticky): HTMLElement[] {
  return objectElements(board, SHAPE_TYPE);
}

export function connectorElements(board: MountedSticky): HTMLElement[] {
  return objectElements(board, CONNECTOR_TYPE);
}

export function shapeElement(board: MountedSticky, id: string): HTMLElement {
  return objectElement(board, id, SHAPE_TYPE);
}

export function connectorElement(board: MountedSticky, id: string): HTMLElement {
  return objectElement(board, id, CONNECTOR_TYPE);
}

function objectElement(board: MountedSticky, id: string, type: string): HTMLElement {
  const element = board.view.container.querySelector<HTMLElement>(
    `[data-object-id="${id}"][data-object-type="${type}"]`,
  );
  if (element === null) {
    throw new Error(`no ${type} element is drawn for ${id}`);
  }
  return element;
}

/** The board's objects, whatever they are. */
export function objects(board: MountedSticky): readonly ObjectSnapshot[] {
  return snapshot(board.doc);
}

/** The shape this id holds; throws when the board has no shape of that name. */
export function shapeOf(board: MountedSticky, id: string): ShapeSnapshot {
  const shape = asShapeSnapshot(objects(board).find((object) => object.id === id));
  if (shape === null) {
    throw new Error(`object ${id} is not a shape the board can read`);
  }
  return shape;
}

/** The arrow this id holds. */
export function connectorOf(board: MountedSticky, id: string): ConnectorSnapshot {
  const connector = asConnectorSnapshot(objects(board).find((object) => object.id === id));
  if (connector === null) {
    throw new Error(`object ${id} is not a connector the board can read`);
  }
  return connector;
}

/** The one object that was not there before, which is the one this drag made. */
export function theNewOne(board: MountedSticky, before: ReadonlySet<string>): ObjectSnapshot {
  const added = objects(board).find((object) => !before.has(object.id));
  if (added === undefined) {
    throw new Error('the board has no object that was not there before');
  }
  return added;
}

export interface DragShapeOptions {
  /**
   * When Shift was held. `start` holds it for the whole drag, `middle` picks it up after the first
   * move and holds it to the end, and `until` puts it down at the start and lets go of it before the
   * pointer does.
   *
   * The three are here because the tool reads the key on every move, which means the key that matters
   * is the one held when the pointer is let go - and a test of that rule has to be able to say when
   * the key was down, in the same way the person can.
   */
  shift?: 'start' | 'middle' | 'until';
  /** The element the press lands on: the board, or a thing already on it. */
  on?: HTMLElement;
  /** Stop after the middle move and let the test look at the preview. */
  onMiddle?: (middle: Point) => void | Promise<void>;
}

/**
 * Press, drag, let go: a shape drawn.
 *
 * The move is written out in three steps rather than as one jump, because the middle move is what
 * lets a test look at the preview while the drag is still going, and because a drag that only ever had
 * two events would never catch a tool that decided the shape from the first move.
 */
export async function dragShape(
  board: MountedSticky,
  from: Point,
  to: Point,
  options: DragShapeOptions = {},
): Promise<string> {
  const before = new Set(objects(board).map((object) => object.id));
  const target = options.on ?? board.board;
  const down = board.screenOf(from);
  const middle = board.screenOf({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 });
  const up = board.screenOf(to);
  const held = (position: 'start' | 'middle' | 'end'): boolean => {
    if (options.shift === undefined) {
      return false;
    }
    if (options.shift === 'start') {
      return true;
    }
    if (options.shift === 'middle') {
      return position !== 'start';
    }
    return position === 'start';
  };
  const pointer = (
    event: 'pointerDown' | 'pointerMove' | 'pointerUp',
    at: Point,
    where: Element | Window,
    buttons: number,
    position: 'start' | 'middle' | 'end',
  ): void => {
    fireEvent[event](where, {
      pointerId: 1,
      pointerType: 'mouse',
      buttons,
      button: 0,
      clientX: at.x,
      clientY: at.y,
      shiftKey: held(position),
    });
  };

  pointer('pointerDown', down, target, 1, 'start');
  pointer('pointerMove', middle, window, 1, 'middle');
  if (options.onMiddle !== undefined) {
    await options.onMiddle(middle);
  }
  pointer('pointerMove', up, window, 1, 'end');
  pointer('pointerUp', up, target, 0, 'end');
  await flushFrames();
  return theNewOne(board, before).id;
}

/** A press and a release in the same place, with a tool up: a click, which makes the default thing. */
export async function clickBoard(board: MountedSticky, world: Point): Promise<string | null> {
  const before = new Set(objects(board).map((object) => object.id));
  const at = board.screenOf(world);
  press(board.board, at, {});
  release(board.board, at, {});
  await flushFrames();
  const added = objects(board).find((object) => !before.has(object.id));
  return added?.id ?? null;
}

/** The dashed box a shape drag is showing, or null when it is showing nothing. */
export function previewBox(board: MountedSticky): Element | null {
  return board.view.container.querySelector('[data-testid="shape-preview-rect"]');
}

/** The four dots of the object the connector pointer is over. */
export function dots(board: MountedSticky): SVGCircleElement[] {
  return [
    ...board.view.container.querySelectorAll<SVGCircleElement>('[data-testid="connector-dot"]'),
    ...board.view.container.querySelectorAll<SVGCircleElement>(
      '[data-testid="connector-target-dot"]',
    ),
  ];
}

/** The dot that says "this is the side the arrow will use", or null when none is lit. */
export function targetDot(board: MountedSticky): SVGCircleElement | null {
  return board.view.container.querySelector<SVGCircleElement>('[data-testid="connector-target-dot"]');
}

/** The dashed line of a connector drag in progress, or null. */
export function connectorPreview(board: MountedSticky): SVGLineElement | null {
  return board.view.container.querySelector<SVGLineElement>('[data-testid="connector-preview-line"]');
}

/** The overlay the connector tool draws on, which is only there when it has something to say. */
export function connectorOverlay(board: MountedSticky): SVGSVGElement | null {
  return board.view.container.querySelector<SVGSVGElement>('[data-testid="connector-preview"]');
}

/**
 * The palette's name for a colour, and the word the button is built out of.
 *
 * They are the same word for every colour but one: the empty fill is `none` in the document and "No
 * fill" on the screen, and a test that had to remember which of the two a `data-testid` was made from
 * would be a test that failed for a reason nobody cares about.
 */
const BUTTON_NAME: Record<string, string> = { none: 'no' };

/** One of a shape's colour swatches, by the colour's name in the palette. */
export function swatch(board: MountedSticky, name: 'fill' | 'stroke', color: string): HTMLElement {
  const key = `${name}-${BUTTON_NAME[color] ?? color}`;
  const button = board.view.container.querySelector<HTMLElement>(`[data-testid="${key}"]`);
  if (button === null) {
    throw new Error(`the shape toolbar has no ${key} swatch`);
  }
  return button;
}

/** Press a colour swatch. */
export async function pickColor(
  board: MountedSticky,
  name: 'fill' | 'stroke',
  color: string,
): Promise<void> {
  fireEvent.click(swatch(board, name, color));
  await flushFrames();
}

/** The label element of a shape, or the textarea when it is being typed into. */
export function labelOf(board: MountedSticky, id: string): HTMLElement {
  const editing = objectElement(board, id, SHAPE_TYPE).querySelector<HTMLElement>(
    '[data-testid="shape-label-editor"]',
  );
  const shown = objectElement(board, id, SHAPE_TYPE).querySelector<HTMLElement>(
    '[data-testid="shape-label"]',
  );
  const found = editing ?? shown;
  if (found === null) {
    throw new Error(`shape ${id} draws no label`);
  }
  return found;
}

/** Type into the label of the shape being typed into. */
export async function typeLabel(board: MountedSticky, id: string, text: string): Promise<void> {
  const editor = objectElement(board, id, SHAPE_TYPE).querySelector<HTMLTextAreaElement>(
    '[data-testid="shape-label-editor"]',
  );
  if (editor === null) {
    throw new Error(`shape ${id} is not being typed into`);
  }
  fireEvent.change(editor, { target: { value: `${editor.value}${text}` } });
  await flushFrames();
}

/** Open a shape's label, the way a person does: press it twice. */
export async function openLabel(board: MountedSticky, id: string): Promise<void> {
  const shape = shapeOf(board, id);
  const element = shapeElement(board, id);
  const at = board.screenOf({ x: shape.x + 6, y: shape.y + 6 });
  fireEvent.doubleClick(element, { pointerId: 1, clientX: at.x, clientY: at.y });
  await flushFrames();
}

/**
 * The wide invisible line an arrow is clicked on.
 *
 * An arrow is drawn as a two-unit line with a much wider transparent one over it, because six screen
 * pixels either side of a thin line is not a place anybody can aim a pointer at by hand. In a browser
 * the wide line is what the mouse finds; in jsdom nothing can *find* anything, so a test that means to
 * click an arrow has to press on this element and on nothing else: pressing the arrow's box instead is
 * a press on the board, which is the opposite of what the test is trying to say.
 */
export function hitLine(board: MountedSticky, id: string): SVGElement {
  const element = connectorElement(board, id);
  const line = element.querySelector<SVGElement>('[data-testid="connector-hit"]');
  if (line === null) {
    throw new Error(`the arrow ${id} has no clickable line on screen`);
  }
  return line;
}

/** Where an arrow's line is half way between its two ends, in board units. */
export function arrowMiddle(board: MountedSticky, id: string): Point {
  const element = connectorElement(board, id);
  return {
    x: (Number(element.dataset.fromX) + Number(element.dataset.toX)) / 2,
    y: (Number(element.dataset.fromY) + Number(element.dataset.toY)) / 2,
  };
}

/** Select an arrow by pressing the line it is drawn with, rather than the box around it. */
export async function selectArrow(board: MountedSticky, id: string): Promise<void> {
  const line = hitLine(board, id);
  const screen = screenPoint(board, arrowMiddle(board, id));
  fireEvent.pointerDown(line, {
    pointerId: 1,
    button: 0,
    buttons: 1,
    clientX: screen.x,
    clientY: screen.y,
  });
  fireEvent.pointerUp(line, {
    pointerId: 1,
    button: 0,
    buttons: 0,
    clientX: screen.x,
    clientY: screen.y,
  });
  await flushFrames();
}

/**
 * Drag one of an arrow's ends somewhere else.
 *
 * The press is on the handle, which is drawn on the arrow's end and answers the pointer on its own;
 * the moves and the release go on the window, because a handle being dragged is dragged over the
 * whole board and not only over the arrow it belongs to.
 */
export async function dragEnd(
  board: MountedSticky,
  id: string,
  end: End,
  to: Point,
  over?: HTMLElement,
): Promise<void> {
  const handle = board.view.container.querySelector<SVGCircleElement>(
    `[data-testid="connector-handle-${end}"]`,
  );
  if (handle === null) {
    throw new Error(`the arrow ${id} has no ${end} handle on screen (is it selected?)`);
  }
  const target = over ?? window;
  const down = { x: Number(handle.getAttribute('cx')), y: Number(handle.getAttribute('cy')) };
  const up = board.screenOf(to);
  fireEvent.pointerDown(handle, { pointerId: 1, button: 0, buttons: 1, clientX: down.x, clientY: down.y });
  await flushFrames();
  fireEvent.pointerMove(window, {
    pointerId: 1,
    buttons: 1,
    clientX: (down.x + up.x) / 2,
    clientY: (down.y + up.y) / 2,
  });
  fireEvent.pointerMove(target, { pointerId: 1, buttons: 1, clientX: up.x, clientY: up.y });
  release(target, up, {});
  await flushFrames();
}

/** Select an object by pressing it, the way a person does. */
export async function selectObject(board: MountedSticky, id: string): Promise<void> {
  const object = objects(board).find((candidate) => candidate.id === id);
  if (object === undefined) {
    throw new Error(`object ${id} is not on the board`);
  }
  const at = board.screenOf({ x: object.x + 6, y: object.y + 6 });
  press(board.element(id), at, {});
  release(board.element(id), at, {});
  await flushFrames();
}

/** A point on the line between two points, `t` of the way along: for aiming at an arrow. */
export function along(from: Point, to: Point, t: number): Point {
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}

/** Where a world point is drawn, for an assertion about a `cx` or an `x` attribute. */
export function screenPoint(board: MountedSticky, world: Point): Point {
  const camera = board.camera();
  return worldToScreen(camera, world);
}
