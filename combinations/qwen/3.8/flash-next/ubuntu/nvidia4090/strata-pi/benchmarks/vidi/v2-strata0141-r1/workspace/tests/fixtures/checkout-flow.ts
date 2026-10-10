import * as Y from 'yjs';
import type { Point, Rect } from '../../src/shared/geometry';
import { objectSnapshots } from '../../src/shared/board-model';
import {
  createConnector,
  type EndpointInput,
  type ConnectorSnapshot,
} from '../../src/shared/objects/connector';
import {
  createShape,
  getShapeLabel,
  type ShapeSnapshot,
  setShapeStyle,
} from '../../src/shared/objects/shape';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  type ShapeFillColor,
  type ShapeKind,
  type ShapeStrokeColor,
} from '../../src/shared/config';

/**
 * The story 10 fixture (`shape.ui`, `connector.ui`, `connector.follow`): a small
 * checkout flow - four labelled shapes in a row and four arrows between them, one
 * arrow that ends in empty space instead of on a shape.
 *
 * Shapes are given as top-left corner plus size, i.e. exactly the rectangle
 * `createShape` takes and `ShapeSnapshot` stores. Sizes are world units. The row is
 * spaced so that every attached end resolves onto a *left* or *right* side, and the
 * free-ended arrow points *down*, where the side is not obvious from the order of
 * the list - which is the part of the resolution worth having on screen.
 */
export interface FixtureShape {
  readonly key: string;
  readonly kind: ShapeKind;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly label: string;
  readonly fill: ShapeFillColor;
  readonly stroke: ShapeStrokeColor;
}

/** An end is either the key of a shape in this fixture, or a point in world units. */
export type FixtureEnd = { readonly shape: string } | { readonly point: Point };

export interface FixtureConnector {
  readonly key: string;
  readonly from: FixtureEnd;
  readonly to: FixtureEnd;
}

export const CHECKOUT_FLOW_SHAPES: readonly FixtureShape[] = [
  {
    key: 'cart',
    kind: 'rect',
    x: 80,
    y: 80,
    width: 220,
    height: 140,
    label: 'Cart: 3 items',
    fill: 'white',
    stroke: 'dark',
  },
  {
    key: 'payment',
    kind: 'diamond',
    x: 420,
    y: 40,
    width: 220,
    height: 220,
    label: 'Card accepted?',
    fill: 'yellow',
    stroke: 'dark',
  },
  {
    key: 'paid',
    kind: 'ellipse',
    x: 760,
    y: 90,
    width: 220,
    height: 140,
    label: 'Paid',
    fill: 'green',
    stroke: 'dark',
  },
  {
    key: 'receipt',
    kind: 'rect',
    x: 1100,
    y: 80,
    width: 220,
    height: 140,
    label: 'Receipt emailed',
    fill: 'blue',
    stroke: 'dark',
  },
];

export const CHECKOUT_FLOW_CONNECTORS: readonly FixtureConnector[] = [
  { key: 'cart-payment', from: { shape: 'cart' }, to: { shape: 'payment' } },
  { key: 'payment-paid', from: { shape: 'payment' }, to: { shape: 'paid' } },
  { key: 'paid-receipt', from: { shape: 'paid' }, to: { shape: 'receipt' } },
  // The fourth arrow is the free-ended one: it starts on the diamond and ends in the
  // empty space below it, where it stays however the board moves.
  { key: 'chargeback', from: { shape: 'payment' }, to: { point: { x: 530, y: 420 } } },
];

export interface CheckoutFlow {
  readonly shapes: Readonly<Record<string, string>>;
  readonly connectors: Readonly<Record<string, string>>;
}

function shapeRect(entry: FixtureShape): Rect {
  return { x: entry.x, y: entry.y, width: entry.width, height: entry.height };
}

function centreOf(entry: FixtureShape): Point {
  return { x: entry.x + entry.width / 2, y: entry.y + entry.height / 2 };
}

function endpointFor(end: FixtureEnd, shapes: Readonly<Record<string, string>>): EndpointInput {
  if ('shape' in end) {
    const id = shapes[end.shape];
    if (!id) {
      throw new Error(`checkout flow: no shape named ${end.shape}`);
    }
    return { kind: 'attached', objectId: id };
  }
  return { kind: 'free', x: end.point.x, y: end.point.y };
}

/**
 * Build the flow with the model's own functions - `createShape`, `setShapeStyle`,
 * the label `Y.Text`, `createConnector` - so a fixture can never drift from what the
 * product is able to store. Returns the ids by key.
 */
export function seedCheckoutFlow(doc: Y.Doc, createdBy = 'checkout-flow'): CheckoutFlow {
  const shapes: Record<string, string> = {};
  for (const entry of CHECKOUT_FLOW_SHAPES) {
    const id = createShape(
      doc,
      { kind: entry.kind, rect: shapeRect(entry), at: centreOf(entry) },
      createdBy,
    );
    if (!id) {
      throw new Error(`checkout flow: could not create ${entry.key}`);
    }
    // A shape created without a style already carries the defaults, and the board
    // model refuses a write that would change nothing (`board.no_op`), so only a
    // shape that actually differs from them is styled.
    if ((entry.fill !== DEFAULT_SHAPE_FILL || entry.stroke !== DEFAULT_SHAPE_STROKE)
      && !setShapeStyle(doc, id, { fill: entry.fill, stroke: entry.stroke })) {
      throw new Error(`checkout flow: could not style ${entry.key}`);
    }
    const label = getShapeLabel(doc, id);
    if (!label) {
      throw new Error(`checkout flow: ${entry.key} has no label to write into`);
    }
    label.insert(0, entry.label);
    shapes[entry.key] = id;
  }

  const connectors: Record<string, string> = {};
  for (const entry of CHECKOUT_FLOW_CONNECTORS) {
    const id = createConnector(
      doc,
      endpointFor(entry.from, shapes),
      endpointFor(entry.to, shapes),
      createdBy,
    );
    if (!id) {
      throw new Error(`checkout flow: could not connect ${entry.key}`);
    }
    connectors[entry.key] = id;
  }

  return { shapes, connectors };
}

/** The flow as the board sees it: shapes and arrows, in the order the board holds them. */
export function checkoutFlowObjects(doc: Y.Doc): {
  shapes: ShapeSnapshot[];
  connectors: ConnectorSnapshot[];
} {
  const all = objectSnapshots(doc);
  return {
    shapes: all.filter((entry) => entry.type === 'shape') as ShapeSnapshot[],
    connectors: all.filter((entry) => entry.type === 'connector') as ConnectorSnapshot[],
  };
}
