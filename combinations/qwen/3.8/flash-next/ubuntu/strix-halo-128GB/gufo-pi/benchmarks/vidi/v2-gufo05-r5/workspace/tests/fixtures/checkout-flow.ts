/**
 * The checkout-flow fixture (story 10).
 *
 * A board somebody had already drawn on: four labelled shapes - a rectangle, a decision diamond, an
 * ellipse and another rectangle - joined by three arrows, plus one arrow whose tail is attached and
 * whose head points at nothing yet. That last one matters: a board with only attached arrows never
 * shows what an arrow does when the thing it points at is gone.
 *
 * Like the other fixtures this file only *describes* the board; the shapes and arrows are made by
 * the real model functions, called through the client's test hooks by `helpers/shapes.ts`. Nothing
 * here asserts, and nothing here encodes a board to be pasted in.
 */
import type { Endpoint } from '../../src/shared/objects/connector';
import type { ShapeKind } from '../../src/shared/objects/shape';

/** One shape of the flow, in world units, with the words in it. */
export interface FixtureShape {
  readonly kind: ShapeKind;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly label: string;
}

/**
 * One end of an arrow: either the shape it is attached to, given by its position in `shapes`, or a
 * world point it is left free at.
 */
export type FixtureEnd = { readonly shape: number } | { readonly x: number; readonly y: number };

export interface FixtureConnector {
  readonly from: FixtureEnd;
  readonly to: FixtureEnd;
}

export interface CheckoutFlow {
  readonly shapes: readonly FixtureShape[];
  readonly connectors: readonly FixtureConnector[];
}

/** The middle of a fixture shape, which is where an arrow to it is aimed. */
function shapeCentre(shape: FixtureShape): { x: number; y: number } {
  return { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 };
}

/**
 * A cart that does not work the second time: each shape is far enough from the last for its arrows
 * to have a side to leave from, and all of it is inside what a 1280x800 board centred on the origin
 * can see, so a test can point at it without panning first.
 */
export const CHECKOUT_FLOW: CheckoutFlow = {
  shapes: [
    { kind: 'rect', x: -600, y: -200, width: 200, height: 120, label: 'Start checkout' },
    { kind: 'diamond', x: -280, y: -210, width: 220, height: 140, label: 'In stock?' },
    { kind: 'ellipse', x: 80, y: -200, width: 220, height: 120, label: 'Take payment' },
    {
      kind: 'rect',
      x: -600,
      y: 80,
      width: 240,
      height: 140,
      label: 'Ask for another card',
    },
  ],
  connectors: [
    { from: { shape: 0 }, to: { shape: 1 } },
    { from: { shape: 1 }, to: { shape: 2 } },
    { from: { shape: 3 }, to: { shape: 0 } },
    // attached at the tail, free at the head: the arrow that goes somewhere later
    { from: { shape: 2 }, to: { x: 380, y: 120 } },
  ],
};

/** The endpoint the model is asked for, given the ids the fixture's shapes came back with. */
export function endpointFor(
  end: FixtureEnd,
  flow: CheckoutFlow,
  shapeIds: readonly string[],
): Endpoint {
  if ('shape' in end) {
    const shape = flow.shapes[end.shape];
    if (!shape) throw new Error(`the fixture has no shape number ${end.shape}`);
    const id = shapeIds[end.shape];
    if (!id) throw new Error(`shape number ${end.shape} of the fixture was never made`);
    return { kind: 'attached', objectId: id, fallback: shapeCentre(shape) };
  }
  return { kind: 'free', x: end.x, y: end.y };
}
