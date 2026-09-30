// Driving a board that has shapes and arrows on it (story 10's component tests).
//
// Built on the drivers that are already here (`board-ui.tsx`, `text-ui.tsx`) rather than
// beside them: the same fake provider, the same real `<Board>`, and the same rule that a
// thing is asserted by what ends up in the document rather than by calling the model and
// hoping it looked right on the screen.
//
// One thing here is genuinely new, and it is where story 10's tools live: a drawing tool
// is a sheet over the board, in screen space, so a gesture with a tool up is dispatched
// **on that sheet** — which is exactly what a browser does with a pointer over it. A test
// that dispatched its drag on the viewport instead would be asserting that a tool's sheet
// does not catch the pointer, which is not what it does.
import { act, fireEvent, screen, within } from '@testing-library/react';
import type { BoardObject } from '../../../src/shared/board-model';
import { objectBounds, snapshotObjects } from '../../../src/shared/board-model';
import { createShape, readShapeSnapshot, type ShapeSnapshot } from '../../../src/shared/objects/shape';
import {
  createConnector,
  readConnectorSnapshot,
  type ConnectorSnapshot,
} from '../../../src/shared/objects/connector';
import { endpointFallback, type Endpoint } from '../../../src/shared/geometry/connector-geometry';
import type { Rect } from '../../../src/shared/geometry';
import type { Point } from '../../../src/client/canvas/camera';
import { worldToScreen } from '../../../src/client/canvas/camera';
import { dispatchPointer, VIEWPORT } from './events';

export { dispatchPointer };
import { advance, camera, doc, flush, pressKey, screenOfPoint } from './text-ui';

export { drag, dragSlow, marquee, pressUndo, pressRedo } from './board-ui';

export {
  advance,
  camera,
  clickEmpty,
  doc,
  FakeWebsocketProvider,
  flush,
  open,
  pressEscape,
  pressKey,
  pressSelectTool,
  pressTextTool,
  remoteChange,
  screenOfPoint,
  selectToolActive,
  textToolActive,
  VIEWPORT,
} from './text-ui';

// --- the tools ---------------------------------------------------------------

export const pressShapeTool = (): void => pressKey({ key: 's' });
export const pressConnectorTool = (): void => pressKey({ key: 'l' });

const pressed = (testId: string): boolean =>
  (screen.getByTestId(testId) as HTMLButtonElement).getAttribute('aria-pressed') === 'true';

export const shapeToolActive = (): boolean => pressed('tool-shape');
export const connectorToolActive = (): boolean => pressed('tool-connector');

/** A tool's sheet is what catches the pointer while that tool is up. */
export const shapeSheet = (): HTMLElement => screen.getByTestId('shape-tool');
export const connectorSheet = (): HTMLElement => screen.getByTestId('connector-tool');

/** Nothing over the board: the board itself has the pointer again. */
export const noSheetIsUp = (): boolean =>
  screen.queryByTestId('shape-tool') === null && screen.queryByTestId('connector-tool') === null;

/** Press, travel, land, let go — a drag on a tool's own sheet, between world points. */
function dragOn(which: HTMLElement, from: Point, to: Point, shift = false): void {
  const start = screenOfPoint(from);
  const end = screenOfPoint(to);
  dispatchPointer(which, 'pointerdown', start.x, start.y, { shiftKey: shift });
  flush();
  dispatchPointer(which, 'pointermove', (start.x + end.x) / 2, (start.y + end.y) / 2, { shiftKey: shift });
  flush();
  dispatchPointer(which, 'pointermove', end.x, end.y, { shiftKey: shift });
  flush();
  dispatchPointer(which, 'pointerup', end.x, end.y, { shiftKey: shift });
  flush();
}

/** A press and a release in one place on a tool's sheet: a click, which drops a shape. */
function clickOn(which: HTMLElement, at: Point): void {
  const spot = screenOfPoint(at);
  dispatchPointer(which, 'pointerdown', spot.x, spot.y);
  flush();
  dispatchPointer(which, 'pointerup', spot.x, spot.y);
  flush();
}

/**
 * Draw a shape by dragging, asking for the tool on the way: `S`, then a drag from one
 * world point to another. Returns the id of the shape that came of it.
 */
export function drawShape(from: Point, to: Point, shift = false): string {
  const before = shapeIds();
  pressShapeTool();
  dragOn(shapeSheet(), from, to, shift);
  return onlyNew(before, shapeIds, 'shape');
}

/** Drop a shape of the standard size with a click, of the kind asked for. */
export function dropShape(at: Point, kind?: 'rect' | 'ellipse' | 'diamond'): string {
  const before = shapeIds();
  pressShapeTool();
  if (kind !== undefined) pressShapeKind(kind);
  clickOn(shapeSheet(), at);
  return onlyNew(before, shapeIds, 'shape');
}

/** Ask the Shape tool for a kind: the shape menu is only up while the tool is. */
export function pressShapeKind(kind: 'rect' | 'ellipse' | 'diamond'): void {
  fireEvent.click(screen.getByTestId(`shape-kind-${kind}`) as HTMLButtonElement);
  flush();
}

/** A click on the Shape tool's sheet, wherever the tool has left the pointer. */
export function clickShapeSheet(at: Point): void {
  clickOn(shapeSheet(), at);
}

/** The Shape tool's own sheet: press somewhere on it, drag, let go. */
export function dragShapeSheet(from: Point, to: Point, shift = false): void {
  dragOn(shapeSheet(), from, to, shift);
}

/** A drag on the Shape tool's sheet that is left part way: no release. */
export function dragShapeSheetPartway(from: Point, to: Point): void {
  const sheet = shapeSheet();
  const start = screenOfPoint(from);
  const end = screenOfPoint(to);
  dispatchPointer(sheet, 'pointerdown', start.x, start.y);
  dispatchPointer(sheet, 'pointermove', (start.x + end.x) / 2, (start.y + end.y) / 2);
  flush();
}

/** Let go of the Shape tool's sheet where it is: the shape is made here. */
export function releaseShapeSheet(at: Point): void {
  dispatchPointer(shapeSheet(), 'pointerup', screenOfPoint(at).x, screenOfPoint(at).y);
  flush();
}

/**
 * Look at the board through another zoom, which is what the zoom controls do. The hook is
 * the one the board publishes in test mode; a component test that wants a zoom has to ask
 * the board for it, because only the board owns its camera.
 */
export function setCameraTo(zoom: number, at: Point = { x: -VIEWPORT.width / 2, y: -VIEWPORT.height / 2 }): void {
  const hooks = window.__vidi6;
  if (!hooks) throw new Error('the board publishes no camera hook in this build');
  act(() => {
    hooks.setCamera({ x: at.x, y: at.y, zoom });
  });
  flush();
}

/** A keystroke inside the open label editor. */
export function pressShapeLabelKey(key: string, init: Record<string, unknown> = {}): void {
  fireEvent.keyDown(shapeLabelEditor(), { key, ...init });
  flush();
}

/** The preview the Shape tool draws while it is being dragged, or null. */
export const shapePreview = (): HTMLElement | null => screen.queryByTestId('shape-tool-preview');

/** The dots the Connector tool offers mid-drag: one per side of what it can attach to. */
export const connectorDots = (): HTMLElement[] =>
  Array.from(document.querySelectorAll('[data-testid^="connector-dot-"]')) as HTMLElement[];

/** The arrow the Connector tool is drawing behind the pointer, or null. */
export const connectorPreview = (): HTMLElement | null => screen.queryByTestId('connector-tool-preview');

/**
 * Draw an arrow from one world point to another: `L`, then a drag. The arrow is attached
 * to whatever was under each end, which is the whole thing the tool is for. Nothing comes
 * of a drag the model refuses, and this says so rather than throwing.
 */
export function drawConnector(from: Point, to: Point): string | null {
  const before = connectorIds();
  pressConnectorTool();
  dragOn(connectorSheet(), from, to);
  const created = connectorIds().filter((id) => !before.includes(id));
  return created[0] ?? null;
}

function onlyNew(before: string[], read: () => string[], what: string): string {
  const created = read().filter((id) => !before.includes(id));
  if (created.length !== 1) throw new Error(`expected one new ${what}, got ${created.length}`);
  return created[0] as string;
}

// --- the objects -------------------------------------------------------------

const idsOf = (type: string): string[] =>
  snapshotObjects(doc())
    .filter((object) => object.type === type)
    .map((object) => object.id);

export const shapeIds = (): string[] => idsOf('shape');
export const connectorIds = (): string[] => idsOf('connector');

export function shapeObject(id: string): ShapeSnapshot {
  const object = readShapeSnapshot(doc(), id);
  if (!object) throw new Error(`"${id}" is not a shape in the document`);
  return object;
}

export function connectorObject(id: string): ConnectorSnapshot {
  const object = readConnectorSnapshot(doc(), id);
  if (!object) throw new Error(`"${id}" is not an arrow in the document`);
  return object;
}

/** The box a shape is drawn in, as the board reads it. */
export const shapeBox = (id: string): Rect => objectBounds(shapeObject(id));

/** What one end of an arrow is attached to, in the words it is stored in. */
export const connectorEnd = (id: string, end: 'from' | 'to'): Endpoint =>
  end === 'from' ? connectorObject(id).from : connectorObject(id).to;

/** Where an arrow's two ends are drawn, which is what an arrow's position means. */
export function connectorPoints(id: string): { from: Point; to: Point } {
  const connector = connectorObject(id);
  const at = (end: 'from' | 'to'): Point => {
    const point = endpointFallback(end === 'from' ? connector.from : connector.to);
    if (point === null) throw new Error(`the "${end}" end of "${id}" has no point at all`);
    return point;
  };
  return { from: at('from'), to: at('to') };
}

// --- the elements ------------------------------------------------------------

const elements = (testId: string): HTMLElement[] => screen.queryAllByTestId(testId) as HTMLElement[];

export const shapeElements = (): HTMLElement[] => elements('shape-object');
export const connectorElements = (): HTMLElement[] => elements('connector-object');

export function shapeElement(id: string): HTMLElement {
  const found = shapeElements().find((element) => element.dataset.id === id);
  if (!found) throw new Error(`no shape "${id}" on the screen`);
  return found;
}

export function connectorElement(id: string): HTMLElement {
  const found = connectorElements().find((element) => element.dataset.id === id);
  if (!found) throw new Error(`no arrow "${id}" on the screen`);
  return found;
}

/** Which shapes the board says are selected. */
export const selectedShapeIds = (): string[] =>
  shapeElements()
    .filter((element) => element.dataset.selected === 'true')
    .map((element) => element.dataset.id as string);

export const selectedConnectorIds = (): string[] =>
  connectorElements()
    .filter((element) => element.dataset.selected === 'true')
    .map((element) => element.dataset.id as string);

// --- the label ---------------------------------------------------------------

/** Double-click a shape: its label opens to be typed in, as any object's text does. */
export function openShapeLabel(id: string): void {
  const element = shapeElement(id);
  const spot = screenOfPoint(centreOf(id));
  dispatchPointer(element, 'pointerdown', spot.x, spot.y);
  dispatchPointer(element, 'pointerup', spot.x, spot.y);
  fireEvent.doubleClick(element, { clientX: spot.x, clientY: spot.y });
  flush();
}

/** The shape's label as it is written in the document. */
export const shapeLabel = (id: string): string => shapeObject(id).label;

/** The open label editor. There is only ever one: the board edits one object at a time. */
export const shapeLabelEditor = (): HTMLTextAreaElement =>
  screen.getByTestId('shape-object-editor') as HTMLTextAreaElement;

/** Type a whole value into the open label editor, the way `input` reports it. */
export function typeShapeLabel(value: string): void {
  fireEvent.input(shapeLabelEditor(), { target: { value } });
  advance(16);
  flush();
}

/** What the shape says on the screen, in the label the board lays out for it. */
export const shapeLabelText = (id: string): string => {
  const label = shapeElement(id).querySelector('[data-testid="shape-object-label"]');
  if (!label) throw new Error(`no label drawn for "${id}"`);
  return label.textContent ?? '';
};

// --- the shape's toolbar -----------------------------------------------------

/** Click a swatch the way a person does: by its name, `Blue fill` or `Red outline`. */
export function clickShapeSwatch(label: string): void {
  fireEvent.click(screen.getByLabelText(label) as HTMLButtonElement);
  flush();
}

/** The two colours a shape is painted with, read back from the document. */
export const shapeColors = (id: string): { fill: string; stroke: string } => {
  const shape = shapeObject(id);
  return { fill: shape.fill, stroke: shape.stroke };
};

// --- the arrow's handles -----------------------------------------------------

/** Drag a selected arrow's end handle to a world point: a re-attach. */
export function dragConnectorHandle(id: string, end: 'from' | 'to', toWorld: Point): void {
  const element = within(connectorElement(id)).getByTestId(`connector-handle-${end}`) as HTMLElement;
  const rect = element.getBoundingClientRect();
  const from = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  const to = worldToScreen(camera(), toWorld);
  dispatchPointer(element, 'pointerdown', from.x, from.y);
  dispatchPointer(element, 'pointermove', (from.x + to.x) / 2, (from.y + to.y) / 2);
  dispatchPointer(element, 'pointermove', to.x, to.y);
  dispatchPointer(element, 'pointerup', to.x, to.y);
  flush();
}

/** The shape an arrow is pointing at, by the id its end names. */
export const attachedTo = (id: string, end: 'from' | 'to'): string | null => {
  const endpoint = connectorEnd(id, end);
  return endpoint.kind === 'attached' ? endpoint.objectId : null;
};

// --- scenery -----------------------------------------------------------------

/**
 * A shape put in through the model, because it is scenery rather than the thing under
 * test. The tool's own way of making a shape is what the tests below are about; a test
 * that needed three shapes to point at would be a worse test for making them by hand.
 */
export function makeShape(at: Point, size: { width: number; height: number } = { width: 200, height: 200 }): string {
  let id = '';
  act(() => {
    const created = createShape(doc(), { rect: { x: at.x, y: at.y, ...size } }, 'scenery');
    if (created === null) throw new Error('the model refused a shape this test asked for');
    id = created;
  });
  flush();
  return id;
}

/** An arrow put in through the model, between two shapes or two points. */
export function makeConnector(from: Endpoint, to: Endpoint): string {
  let id: string | null = null;
  act(() => {
    id = createConnector(doc(), from, to, 'scenery');
  });
  flush();
  if (id === null) throw new Error('the model refused an arrow this test asked for');
  return id;
}

/** The centre of a shape, in world units. */
export function centreOf(id: string): Point {
  const box = objectBounds(objectById(id) as BoardObject);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** The centre of a shape, on the screen. */
export const centreOnScreen = (id: string): Point => worldToScreen(camera(), centreOf(id));

/** The object with an id, whatever it is. */
export const objectById = (id: string): BoardObject | undefined =>
  snapshotObjects(doc()).find((object) => object.id === id);
