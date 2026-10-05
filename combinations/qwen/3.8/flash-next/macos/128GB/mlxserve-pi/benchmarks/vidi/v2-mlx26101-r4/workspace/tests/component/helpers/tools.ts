/**
 * Helpers for story 10's component tests: the two drawing tools, the shapes they make, the arrows.
 *
 * Three rules run through this file, and they are the rules of the code it tests.
 *
 * **Screen and board are different units and are always converted.** The board opens with the world origin in
 * the middle of the window, so a press at screen 100 is a press at board -412, and a test that said otherwise
 * would be asserting the size of the window rather than the position of a shape. Points a test *presses* are
 * given in board units and turned with `screenOf`; points a test *asserts about* are read from the document,
 * which speaks board units and needs no conversion at all.
 *
 * **A press is delivered to the element that would receive it.** jsdom hands an event to the element a test
 * names, with no idea of geometry: it will happily deliver a click aimed at the middle of a shape to the
 * toolbar. So a test of the Shape tool presses on the tool's own sheet, which is where the browser would have
 * put the press, and a test of a shape's swatch presses on the swatch. Where the honest question is about
 * geometry rather than about who receives an event — "is a click seven pixels from an arrow an arrow?" — the
 * test asks the board's own hit test, which is the code that answers that question in the product, and says
 * so at the call.
 *
 * **The document is the witness.** Every assertion is about what the model holds: a shape's box, an arrow's
 * two ends, which object is selected. What a component rendered is only asserted where the component is the
 * product — the preview of a shape being dragged, the four dots that answer *where would an arrow join?*.
 */
import { expect } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';

import type { ObjectSnapshot } from '../../../src/shared/board-model';
import { createSticky } from '../../../src/shared/board-model';
import type { ShapeKind } from '../../../src/shared/config';
import { SHAPE_DEFAULT_SIZE_WORLD } from '../../../src/shared/config';
import type { ConnectorSnap, ConnectorEnd } from '../../../src/shared/objects/connector';
import { attachableRects, createConnector, setConnectorEndpoint } from '../../../src/shared/objects/connector';
import type { ShapeSnap } from '../../../src/shared/objects/shape';
import { createShape, getShapeLabel } from '../../../src/shared/objects/shape';
import type { StrokeSnap } from '../../../src/shared/objects/stroke';
import { createStroke, scaledPoints } from '../../../src/shared/objects/stroke';
import type { Point, Rect } from '../../../src/shared/geometry';
import { distanceToSegment } from '../../../src/shared/geometry/polyline';
import { attachedEndpoint, nearestSide, resolveEndpoints, sideAnchor } from '../../../src/shared/geometry/connector-geometry';
import type { Endpoint } from '../../../src/shared/geometry/connector-geometry';
import { camera, doc, pointerDown, pointerEvent, surface } from './stickyBoard';
import { moveWindow, upWindow } from './selection';
import { cameraStore } from '../../../src/client/canvas/cameraStore';
import { screenToWorld, worldToScreen } from '../../../src/client/canvas/camera';

export { hitTestObject } from '../../../src/client/objects/registry';
export { attachableRects } from '../../../src/shared/objects/connector';
export { scaledPoints, strokeHit } from '../../../src/shared/objects/stroke';
export type { ConnectorEnd, ConnectorSnap, ShapeSnap };

// The board itself, from the helper these tests are built on, so a story 10 test names one file.
export {
  camera,
  doc,
  pointerCancel,
  pointerDown,
  pointerEvent,
  pointerMove,
  pointerUp,
  renderBoard,
  surface,
  somebodyElse,
  stickies,
  stickyById,
} from './stickyBoard';
export { moveWindow, upWindow, cancelWindow } from './selection';

/** A pointer position on the board, in board units. */
export type At = Point;

/** The middle of the window, which is the middle of the world: the origin is drawn here. */
export const WORLD_CENTRE: At = { x: 0, y: 0 };

/** Where a board point is on the screen, right now. */
export function screenOf(at: At): Point {
  return worldToScreen(camera(), at);
}

/** Where a screen point is on the board, right now. */
export function worldOfScreen(at: Point): At {
  return screenToWorld(camera(), at);
}

/** Draw the board at this zoom, the way the zoom control does. */
export function setZoom(zoom: number): void {
  act(() => {
    cameraStore.setCameraTest({ zoom });
  });
}

/**
 * Wait until the board has drawn itself with the camera its store holds.
 *
 * The camera is handed out at most once per animation frame, which is what keeps a trackpad gesture from
 * rendering sixty times a second. A test that changes the zoom and at once asks what something is drawn like
 * is therefore asking about a frame that has not been painted: the store knows, the components do not yet.
 * The world layer's transform is the witness, because it is the thing the camera is drawn as.
 */
export async function rendered(): Promise<void> {
  await waitFor(() => {
    const layer = document.querySelector<HTMLElement>('[data-testid="world-layer"]');
    if (layer === null) throw new Error('there is no board to wait for');
    const at = camera();
    expect(layer.style.transform).toBe(`scale(${at.zoom}) translate(${-at.x}px, ${-at.y}px)`);
  });
}

/**
 * Put the world origin at the top-left of the window, so that screen and board are the same numbers.
 *
 * The board opens with its origin in the middle of the window, which is what a person looking at a board
 * wants and what a test reading the design's own figures does not: the design says "a drag from (100,100) to
 * (300,220)" and means a shape at 100,100. Rather than convert those figures in every test, a test that wants
 * them frames the camera here. Everything in these files still goes through `screenOf` and the document, so a
 * test that framed the board elsewhere would still be correct — this only saves it the arithmetic.
 */
export function frameAtOrigin(): void {
  act(() => {
    cameraStore.setCameraTest({ x: 0, y: 0, zoom: 1 });
  });
}

/** Which tool the board says it is in. */
export function activeTool(): string {
  return surface().dataset.activeTool ?? '';
}

/** A single-letter shortcut, aimed at the window: the way a key reaches the board. */
export function pressKey(key: string, init: KeyboardEventInit = {}): void {
  fireEvent.keyDown(window, { key, ...init });
}

/** Press `S`, and wait for the sheet to be there: a tool that is armed is a tool you can press. */
export async function armShapeTool(): Promise<HTMLElement> {
  pressKey('s');
  await waitFor(() => expect(screen.queryByTestId('shape-tool')).not.toBeNull());
  return screen.getByTestId('shape-tool');
}

/** The same for `L`. */
export async function armConnectorTool(): Promise<HTMLElement> {
  pressKey('l');
  await waitFor(() => expect(screen.queryByTestId('connector-tool')).not.toBeNull());
  return screen.getByTestId('connector-tool');
}

export function shapeSheet(): HTMLElement {
  return screen.getByTestId('shape-tool');
}

export function connectorSheet(): HTMLElement {
  return screen.getByTestId('connector-tool');
}

export function toolOverlayPresent(): boolean {
  return (
    screen.queryByTestId('shape-tool') !== null ||
    screen.queryByTestId('connector-tool') !== null ||
    screen.queryByTestId('pen-tool') !== null
  );
}

/** The shapes on the board, as the document holds them. */
export function shapes(): readonly ShapeSnap[] {
  return window.__vidi6?.getShapes() ?? [];
}

export function shapeById(id: string): ShapeSnap {
  const shape = shapes().find((entry) => entry.id === id);
  if (!shape) throw new Error(`no shape with id ${id} on the board`);
  return shape;
}

/** The arrows on the board, with the ends as the document holds them. */
export function connectors(): readonly ConnectorSnap[] {
  return window.__vidi6?.getConnectors() ?? [];
}

/** The drawings on the board, with the points as the document holds them. */
export function strokes(): readonly StrokeSnap[] {
  return window.__vidi6?.getStrokes() ?? [];
}

export function strokeById(id: string): StrokeSnap {
  const stroke = strokes().find((entry) => entry.id === id);
  if (!stroke) throw new Error(`no stroke with id ${id} on the board`);
  return stroke;
}

/** The rendered drawing, by id. */
export function strokeElement(id: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-stroke-id="${id}"]`);
  if (!element) throw new Error(`no rendered stroke with id ${id}`);
  return element;
}

export function connectorById(id: string): ConnectorSnap {
  const arrow = connectors().find((entry) => entry.id === id);
  if (!arrow) throw new Error(`no connector with id ${id} on the board`);
  return arrow;
}

export function shapeElement(id: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-shape-id="${id}"]`);
  if (!element) throw new Error(`no rendered shape with id ${id}`);
  return element;
}

export function connectorElement(id: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-connector-id="${id}"]`);
  if (!element) throw new Error(`no rendered connector with id ${id}`);
  return element;
}

/** Every object on the board, of every type. */
export function allObjects(): ObjectSnapshot[] {
  if (window.__vidi6 === undefined) return [];
  // A drawing's `color` is one of the six inks and the board's `ObjectSnapshot` says one of the six papers, so
  // the two do not type-check together even though every field is right (see `StrokeSnap`). The board itself
  // hands out snapshots of every type, so the list is assembled with the drawing widened to what the board's
  // own generic reader reports it as — which is what the product actually holds.
  const drawings = strokes() as unknown as ObjectSnapshot[];
  return [...window.__vidi6.getStickies(), ...shapes(), ...connectors(), ...drawings].sort((a, b) => a.z - b.z);
}

/** The boxes an arrow may be attached to, as the board hands them to its objects. */
export function boardRects(): ReadonlyMap<string, Rect> {
  return attachableRects(allObjects());
}

/**
 * Put a shape on the board without dragging one: for the tests whose subject is not the drag.
 *
 * The box is the shape's own — `x`/`y` are its top-left, in board units — and a side that is not given is the
 * board's standard size. This is the model's `createShape` and nothing else: a shape that a test needs must
 * not depend on the tool being right, and the tool has its own tests.
 */
export function addShape(box: { x: number; y: number; width?: number; height?: number; kind?: ShapeKind }): string {
  let id = '';
  act(() => {
    id = createShape(doc(), {
      kind: box.kind ?? 'rect',
      rect: {
        x: box.x,
        y: box.y,
        width: box.width ?? SHAPE_DEFAULT_SIZE_WORLD,
        height: box.height ?? SHAPE_DEFAULT_SIZE_WORLD,
      },
      at: { x: box.x, y: box.y },
      createdBy: 'tester',
    })!;
  });
  if (!id) throw new Error('the model refused a shape it should have made');
  return id;
}

/**
 * Put an arrow on the board without drawing it.
 *
 * Either end may be given as a point (a free end, fixed there) or as an endpoint from the geometry (an
 * attached one). This is the model's `createConnector`, so an arrow a test needs does not depend on the tool
 * being right — and the tool has its own tests.
 */
/**
 * `ConnectorEnd` is which end of an arrow is meant — `from` or `to` — and `Endpoint` is where an end is:
 * attached to an object, or fixed to a point on the board. Both names appear in these helpers, and mixing
 * them up is exactly the mistake the model's own tests were written to catch.
 */
export function addConnector(from: Endpoint | Point, to: Endpoint | Point): string {
  let id = '';
  act(() => {
    id = createConnector(doc(), from, to, 'tester')!;
  });
  if (!id) throw new Error('the model refused an arrow it should have made');
  return id;
}

/** Attach one end of an arrow to an object, at the side that faces the other end. */
export function attachEnd(id: string, end: ConnectorEnd, objectId: string): void {
  const box = boardRects().get(objectId);
  if (box === undefined) throw new Error(`no object ${objectId} to attach an end to`);
  act(() => {
    setConnectorEndpoint(doc(), id, end, attachedEndpoint(objectId, sideAnchor(box, nearestSide(box, centreOf(box)))));
  });
}

/** Put a note on the board, centred on this board point. */
export function addNote(at: At): string {
  let id = '';
  act(() => {
    id = createSticky(doc(), at);
  });
  if (!id) throw new Error('the model refused a note it should have made');
  return id;
}

/**
 * Press, travel, let go — the whole of a drawing gesture.
 *
 * The press is fired on the tool's sheet, because with a tool armed the sheet is what the browser's pointer
 * hits; the moves and the release go to the window, because a drag that leaves the board sideways still has
 * to be drawn to where it stopped. The travel is stepped, so that a tool which only ever sees the start and
 * the end of a drag cannot pass for one that follows the pointer.
 */
export function sweep(sheet: HTMLElement, from: At, to: At, steps = 3): void {
  const start = screenOf(from);
  pointerDown(sheet, start.x, start.y);
  for (let step = 1; step <= steps; step += 1) {
    const at = screenOf({ x: from.x + ((to.x - from.x) * step) / steps, y: from.y + ((to.y - from.y) * step) / steps });
    fireEvent(window, pointerEvent('pointermove', at.x, at.y));
  }
  const end = screenOf(to);
  fireEvent(window, pointerEvent('pointerup', end.x, end.y, { buttons: 0 }));
}

/** Move the pointer over the connector sheet without pressing: this is what makes the dots appear. */
export function hoverSheet(at: At, init: PointerEventInit = {}): void {
  const point = screenOf(at);
  fireEvent.pointerMove(connectorSheet(), { clientX: point.x, clientY: point.y, pointerId: 1, pointerType: 'mouse', ...init });
}

/** Which of the four dots the tool says this pointer would use, or null when nothing is under it. */
export function nearestDot(): { side: string; at: Point } | null {
  const dot = ['top', 'right', 'bottom', 'left']
    .map((side) => ({ side, element: screen.queryByTestId(`connector-dot-${side}`) }))
    .find((entry) => entry.element?.dataset.nearest === 'true');
  if (dot?.element === null || dot?.element === undefined) return null;
  return { side: dot.side, at: { x: Number(dot.element.getAttribute('cx')), y: Number(dot.element.getAttribute('cy')) } };
}

/** The four dots that are drawn, wherever the pointer is. */
export function dots(): { side: string; at: Point; nearest: boolean }[] {
  return ['top', 'right', 'bottom', 'left']
    .map((side) => ({ side, element: screen.queryByTestId(`connector-dot-${side}`) }))
    .filter((entry): entry is { side: string; element: HTMLElement } => entry.element !== null)
    .map((entry) => ({
      side: entry.side,
      at: { x: Number(entry.element.getAttribute('cx')), y: Number(entry.element.getAttribute('cy')) },
      nearest: entry.element.dataset.nearest === 'true',
    }));
}

/** The words stored in a shape's label, read out of the document — the witness, not the screen. */
export function labelText(id: string): string {
  const label = getShapeLabel(doc(), id);
  if (label === undefined) throw new Error(`the shape ${id} has no label to read`);
  return label.toString();
}

/** The label of a shape, read out of the document. */
export function labelOf(id: string): string {
  const element = shapeElement(id);
  const editor = element.querySelector<HTMLTextAreaElement>('[data-testid="shape-textarea"]');
  if (editor !== null) return editor.value;
  const label = element.querySelector<HTMLElement>('[data-testid="shape-label"]');
  return label?.textContent ?? '';
}

/** Type into the shape's open editor the way a browser does: value, then the event that reports it. */
export function typeIntoShape(text: string): void {
  const editor = screen.getByTestId('shape-textarea');
  if (!(editor instanceof HTMLTextAreaElement)) throw new Error('the shape editor is not a textarea');
  editor.value = editor.value + text;
  fireEvent.input(editor);
}

/** The same, for a whole replacement: a paste. */
export function pasteIntoShape(text: string): void {
  const editor = screen.getByTestId('shape-textarea');
  if (!(editor instanceof HTMLTextAreaElement)) throw new Error('the shape editor is not a textarea');
  editor.value = text;
  fireEvent.input(editor);
}

/** Press a shape and let go: select it. */
export function pressShape(id: string, init: PointerEventInit = {}): void {
  const at = screenOf(centreOf(shapeById(id)));
  pointerDown(shapeElement(id), at.x, at.y, init);
  fireEvent(window, pointerEvent('pointerup', at.x, at.y, { buttons: 0, ...init }));
}

/** Press a shape and hold the pointer down there. */
export function pressOnShape(id: string, init: PointerEventInit = {}): Point {
  const at = screenOf(centreOf(shapeById(id)));
  pointerDown(shapeElement(id), at.x, at.y, init);
  return at;
}

/** The middle of anything, in board units. */
export function centreOf(object: { x: number; y: number; width: number; height: number }): At {
  return { x: object.x + object.width / 2, y: object.y + object.height / 2 };
}

/** Press the arrow's own click target — the strip along its line — and let go: select the arrow. */
export function pressConnector(id: string, init: PointerEventInit = {}): void {
  const at = screenOf(arrowMid(id));
  const strip = connectorElement(id).querySelector<HTMLElement>('[data-testid="connector-hit"]');
  if (strip === null) throw new Error(`the arrow ${id} drew no click target`);
  pointerDown(strip, at.x, at.y, init);
  fireEvent(window, pointerEvent('pointerup', at.x, at.y, { buttons: 0, ...init }));
}

/** The middle of an arrow's line, in board units. */
export function arrowMid(id: string): At {
  const arrow = connectorById(id);
  const ends = resolve(arrow);
  return { x: (ends.from.x + ends.to.x) / 2, y: (ends.from.y + ends.to.y) / 2 };
}

/** Where an arrow is drawn, given where its objects are. */
export function resolve(arrow: ConnectorSnap): { from: At; to: At } {
  const ends = resolveEndpoints(arrow, boardRects());
  return { from: { x: ends.from.x, y: ends.from.y }, to: { x: ends.to.x, y: ends.to.y } };
}

/* ------------------------------------------------------------------ pen ---- */

/**
 * Press `P`, and wait for the sheet to be there.
 *
 * The pen is the one tool that does not step aside after it has drawn, so arming it is a thing a test does
 * once and then relies on for every gesture that follows — which is also why these helpers never assume that
 * the sheet went away after a stroke.
 */
export async function armPenTool(): Promise<HTMLElement> {
  pressKey('p');
  await waitFor(() => expect(screen.queryByTestId('pen-tool')).not.toBeNull());
  return screen.getByTestId('pen-tool');
}

export function penSheet(): HTMLElement {
  return screen.getByTestId('pen-tool');
}

/** The pen's options panel, which is only in the document while the pen is armed. */
export function penToolbar(): HTMLElement | null {
  return screen.queryByTestId('pen-toolbar');
}

/** Choose an ink. */
export function pressPenColor(color: string): void {
  fireEvent.click(screen.getByTestId(`pen-color-${color}`));
}

/** Choose a nib. */
export function pressPenThickness(thickness: string): void {
  fireEvent.click(screen.getByTestId(`pen-thickness-${thickness}`));
}

/** Which inks and nibs the panel says are chosen, as the `aria-pressed` the story asks for. */
export function penPressed(): { colors: string[]; thicknesses: string[] } {
  const pressed = (prefix: string, names: string[]): string[] =>
    names.filter((name) => screen.getByTestId(`${prefix}-${name}`).getAttribute('aria-pressed') === 'true');
  return {
    colors: pressed('pen-color', ['black', 'blue', 'red', 'green', 'orange', 'purple']),
    thicknesses: pressed('pen-thickness', ['thin', 'medium', 'thick']),
  };
}

/** What the panel's live region says, or nothing when there is no panel. */
export function penStatus(): string | null {
  return screen.queryByTestId('pen-status')?.textContent ?? null;
}

/**
 * The preview as the screen holds it: the `d` of the path being drawn, or null when nothing is being drawn.
 *
 * Screen units, exactly as drawn — which is the point. The preview is the one stroke on the board that is
 * never in the document, so the element is the only witness it has, and a test that compared it with board
 * coordinates would be comparing a preview with a record.
 */
export function penPreviewD(): string | null {
  const path = screen.queryByTestId('pen-preview-path');
  return path === null ? null : (path.getAttribute('d') ?? null);
}

/** The ink and nib the preview is drawn with, read off the preview itself. */
export function penPreviewPaint(): { stroke: string | null; width: string | null } {
  const path = screen.queryByTestId('pen-preview-path');
  return { stroke: path?.getAttribute('stroke') ?? null, width: path?.getAttribute('stroke-width') ?? null };
}

/**
 * Put a drawing on the board without drawing it: for the tests whose subject is not the pen.
 *
 * The points are board coordinates, in the order the pen went through them; the box is the model's, computed
 * from them. This is the model's `createStroke`, so a test that needs a stroke on the board does not depend
 * on the tool being right — and the tool has its own tests.
 */
export function addStroke(points: readonly Point[], options: { color?: string; thickness?: string } = {}): string {
  let id = '';
  act(() => {
    id = createStroke(doc(), { points, color: options.color, thickness: options.thickness }, 'tester')!;
  });
  if (!id) throw new Error('the model refused a stroke it should have made');
  return id;
}

/**
 * Put the pen down at this board point, on the tool's sheet.
 *
 * The press is fired on the sheet and not on the board, because the sheet is what the browser's pointer is
 * over with the pen armed — the same reason the shape tests press on theirs, and the reason a test that
 * pressed on a sticky note would be testing something the product never does.
 */
export function penDown(at: At, init: PointerEventInit = {}): Point {
  const point = screenOf(at);
  pointerDown(penSheet(), point.x, point.y, init);
  return point;
}

/** Put the pen down and let go again without moving: a dot. */
export function penTap(at: At, init: PointerEventInit = {}): void {
  const point = penDown(at, init);
  upWindow(point, init);
}

/**
 * Take the pen through these board points, one event apiece, and leave it down.
 *
 * Every point becomes a `pointermove`, because a test that only sent the first and the last would be testing
 * a tool that only ever sees two points of a drag. Nothing here waits for a frame: the preview is drawn once
 * per frame and the points are recorded as they arrive, and it is the recorded points a test is checking.
 */
export function penTrace(points: readonly At[]): void {
  for (const point of points) moveWindow(screenOf(point));
}

/** Draw a whole path: press, travel, let go. Returns when the pen is up, not when the stroke is stored. */
export function penDraw(points: readonly At[], init: PointerEventInit = {}): void {
  if (points.length === 0) throw new Error('a path with no points is not a stroke to draw');
  penDown(points[0]!, init);
  penTrace(points.slice(1));
  upWindow(screenOf(points[points.length - 1]!), init);
}

/** How far a board point is from a drawing's line, in board units — the question the hit test answers. */
export function distanceToStroke(id: string, at: At): number {
  const stroke = strokeById(id);
  const line = scaledPoints(stroke);
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i + 1 < line.length; i += 1) {
    const from = line[i]!;
    const to = line[i + 1]!;
    best = Math.min(best, distanceToSegment(from, to, at));
  }
  return line.length === 1 ? Math.hypot(at.x - line[0]!.x, at.y - line[0]!.y) : best;
}
