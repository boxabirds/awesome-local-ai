import { act, screen } from '@testing-library/react';
import { screenToWorld, worldToScreen } from '../../src/client/canvas/camera';
import { SHAPE_DEFAULT_SIZE_WORLD } from '../../src/shared/config';
import type { Camera, Point } from '../../src/client/canvas/camera';
import type { SeedConnector, SeedNote, SeedShape } from '../../src/client/canvas/testHooks';
import type { ConnectorSnap } from '../../src/shared/objects/connector';
import type { ShapeSnap } from '../../src/shared/objects/shape';
import { SIDES, sideAnchor } from '../../src/shared/geometry/connector-geometry';
import { dispatchKey, dispatchPointer } from './util';
import { hook } from './stickyUtil';

/** Shapes on the board, in paint order (story 10). */
export function getShapes(): readonly ShapeSnap[] {
  return hook().getShapes();
}

/** Connectors on the board, in paint order, with their ends resolved as drawn. */
export function getConnectors(): readonly ConnectorSnap[] {
  return hook().getConnectors();
}

/** The camera the board is looking through right now. */
export function camera(): Camera {
  return hook().getCamera();
}

/** Look through a camera of the test's choosing, so zoom is a variable (TC-20). */
export function setCamera(cam: Camera): void {
  act(() => hook().setCamera(cam));
}

/** Where a world point appears on screen for the camera the board is using. */
export function screenOf(world: Point, cam = camera()): Point {
  return worldToScreen(cam, world);
}

/** The screen point a given number of *screen* pixels from a world point (TC-20). */
export function screenOffset(world: Point, px: number, zoom = camera().zoom): Point {
  // `px` screen pixels are `px / zoom` board units, so the same pixel distance means
  // a different world distance at every zoom.
  return { x: world.x + px / zoom, y: world.y };
}

/** Where a screen point lands in the board (used for free connector ends). */
export function worldOf(point: Point, cam = camera()): Point {
  return screenToWorld(cam, point);
}

/** Sticky notes as fixtures — the things an arrow can be attached to. */
export function seedNotes(specs: readonly SeedNote[]): string[] {
  let ids: string[] = [];
  act(() => {
    ids = hook().seedNotes(specs);
  });
  return ids;
}

/** One note, with the box asked for rather than the standard size. */
export function seedNote(rect: { x: number; y: number; width: number; height: number }): string {
  return seedNotes([{ ...rect, text: 'Note' }])[0]!;
}

/** Create shapes as fixtures, as if the board had been saved with them on it. */
export function seedShapes(specs: readonly SeedShape[]): string[] {
  let ids: string[] = [];
  act(() => {
    ids = hook().seedShapes(specs);
  });
  return ids;
}

export function seedShape(spec: SeedShape): string {
  return seedShapes([spec])[0]!;
}

/** And connectors, whose ends may name shapes seeded by an earlier call. */
export function seedConnectors(specs: readonly SeedConnector[]): string[] {
  let ids: string[] = [];
  act(() => {
    ids = hook().seedConnectors(specs);
  });
  return ids;
}

export function seedConnector(spec: SeedConnector): string {
  return seedConnectors([spec])[0]!;
}

export function shapeEls(): HTMLElement[] {
  return screen.queryAllByTestId('shape-object');
}

export function shapeEl(index = 0): HTMLElement {
  const el = shapeEls()[index];
  if (!el) throw new Error(`no shape at index ${index}`);
  return el;
}

export function connectorEls(): HTMLElement[] {
  return screen.queryAllByTestId('connector-object');
}

export function connectorEl(index = 0): HTMLElement {
  const el = connectorEls()[index];
  if (!el) throw new Error(`no connector at index ${index}`);
  return el;
}

/** The invisible wide line an arrow is clicked through (its stroke is the tolerance). */
export function connectorHit(index = 0): SVGLineElement {
  const el = screen.queryAllByTestId('connector-hit')[index];
  if (!el) throw new Error(`no connector hit line at index ${index}`);
  return el as unknown as SVGLineElement;
}

/** The surface the Shape tool draws on, or null when that tool is not active. */
export function shapeToolEl(): HTMLElement | null {
  return screen.queryByTestId('shape-tool');
}

/** The surface the Connector tool drags on, or null when that tool is not active. */
export function connectorToolEl(): HTMLElement | null {
  return screen.queryByTestId('connector-tool');
}

/** The dashed outline of the shape currently being drawn. */
export function previewEl(): HTMLElement | null {
  return screen.queryByTestId('shape-preview');
}

/** The four side anchors the Connector tool shows for the object under the pointer. */
export function dotEls(): HTMLElement[] {
  return screen.queryAllByTestId('connector-dot');
}

/** Press and drag on a surface, releasing at the last point (window sees the moves). */
export function dragOn(
  el: Element,
  from: Point,
  to: Point,
  opts: { steps?: number; shiftKey?: boolean; pointerId?: number } = {},
): void {
  const steps = opts.steps ?? 4;
  const pointerId = opts.pointerId ?? 1;
  dispatchPointer(el, 'pointerdown', { pointerId, clientX: from.x, clientY: from.y });
  for (let i = 1; i <= steps; i++) {
    dispatchPointer(el, 'pointermove', {
      pointerId,
      clientX: from.x + ((to.x - from.x) * i) / steps,
      clientY: from.y + ((to.y - from.y) * i) / steps,
      shiftKey: opts.shiftKey ?? false,
    });
  }
  dispatchPointer(el, 'pointerup', {
    pointerId,
    clientX: to.x,
    clientY: to.y,
    shiftKey: opts.shiftKey ?? false,
  });
}

/**
 * The Shape tool's whole gesture: press S, drag on the tool's own surface, and the
 * board holds a shape where the drag was.
 */
export function createShapeByDrag(
  from: Point,
  to: Point,
  opts: { key?: string; shiftKey?: boolean } = {},
): ShapeSnap {
  const layer = shapeLayer(opts.key ?? 's');
  dragOn(layer, from, to, { shiftKey: opts.shiftKey });
  const shapes = getShapes();
  return shapes[shapes.length - 1]!;
}

/** Switch to the Shape tool and hand back its drawing surface. */
export function shapeLayer(key = 's'): HTMLElement {
  dispatchKey({ key });
  const el = shapeToolEl();
  if (!el) throw new Error(`the ${key} tool has no drawing surface`);
  return el;
}

/** Switch to the Connector tool and hand back the surface it drags on. */
export function connectorLayer(): HTMLElement {
  dispatchKey({ key: 'l' });
  const el = connectorToolEl();
  if (!el) throw new Error('the Connector tool has no surface');
  return el;
}

/** Click once with the Shape tool: a standard shape lands centred on the click. */
export function createShapeByClick(at: Point, opts: { key?: string } = {}): ShapeSnap {
  const layer = shapeLayer(opts.key ?? 's');
  dispatchPointer(layer, 'pointerdown', { clientX: at.x, clientY: at.y });
  dispatchPointer(layer, 'pointerup', { clientX: at.x, clientY: at.y });
  const shapes = getShapes();
  return shapes[shapes.length - 1]!;
}

/** The default size a click produces, for tests that assert a shape is standard. */
export const DEFAULT_SHAPE_SIZE = SHAPE_DEFAULT_SIZE_WORLD;

/** Double-click a shape to edit its label, the way a person does. */
export function editShapeLabel(index = 0, at: Point = { x: 10, y: 10 }): void {
  const el = shapeEl(index);
  dispatchPointer(el, 'pointerdown', { clientX: at.x, clientY: at.y });
  dispatchPointer(el, 'pointerup', { clientX: at.x, clientY: at.y });
  const event = new MouseEvent('dblclick', {
    bubbles: true,
    cancelable: true,
    clientX: at.x,
    clientY: at.y,
  });
  act(() => {
    el.dispatchEvent(event);
  });
}

/** Type into the shape's label editor, one keystroke at a time. */
export function typeIntoShapeLabel(text: string): void {
  const input = screen.getByTestId('shape-label-input') as HTMLTextAreaElement;
  act(() => {
    input.focus();
    for (const char of text) {
      input.value += char;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
}

/** Click something by its test id, in a way React has time to notice. */
export function clickTestId(testId: string): void {
  const el = screen.getByTestId(testId);
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

/** Click one of the shape toolbar's colour swatches by its accessible name. */
export function clickShapeSwatch(name: string): void {
  const button = screen.getByRole('button', { name }) as HTMLButtonElement;
  act(() => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

/** The side anchors of an object, as the Connector tool should show them. */
export function sideAnchorPoints(rect: { x: number; y: number; width: number; height: number }): {
  side: (typeof SIDES)[number];
  at: Point;
}[] {
  const cam = camera();
  return SIDES.map((side) => ({ side, at: worldToScreen(cam, sideAnchor(rect, side)) }));
}
