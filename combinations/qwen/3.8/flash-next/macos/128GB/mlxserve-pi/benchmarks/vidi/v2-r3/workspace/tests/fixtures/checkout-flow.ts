// A realistic story-10 board (design "Fixtures"): four labelled shapes and the
// arrows that make them a flow — three attached to shapes at both ends, and one
// whose far end is a free point in the air, which is what an arrow that has not
// been connected to anything yet actually is.
//
// Like `boards.ts`, nothing here is hand-written JSON: every shape is drawn with
// `createShape`, every label written into its `Y.Text` and every arrow with
// `createConnector`, so the board a test is handed is one the app itself could
// have made — same fields, same `z` ordering, same ends. A fixture that faked the
// document would test the fixture.
import * as Y from 'yjs';
import { initDoc } from '../../src/shared/board-model';
import { createShape, getShapeLabel } from '../../src/shared/objects/shape';
import { createConnector } from '../../src/shared/objects/connector';
import { sideAnchor } from '../../src/shared/geometry/connector-geometry';
import type { ConnectorEndpoint, ConnectorSide, ShapeKind } from '../../src/shared/config';
import type { Rect } from '../../src/shared/geometry';

/** The shapes of the flow, by the part they play in it. */
export type CheckoutFlowShape = 'start' | 'decision' | 'ship' | 'waitlist';

/** The fixture as ids. */
export interface CheckoutFlow {
  /** 'Customer checks out' — a rectangle. */
  start: string;
  /** 'In stock?' — a diamond, the decision the flow turns on. */
  decision: string;
  /** 'Ship it today' — an ellipse. */
  ship: string;
  /** 'Join the waitlist' — a rectangle. */
  waitlist: string;
  /** The three arrows between shapes, in the order they were drawn. */
  arrows: string[];
  /** The arrow whose far end was left in the air. */
  looseEnd: string;
}

/** The four shapes as drawn: where each box is, what kind it is, what it says. */
export const CHECKOUT_FLOW_SHAPES: Record<CheckoutFlowShape, { kind: ShapeKind } & Rect & { label: string }> = {
  start: { kind: 'rect', x: -520, y: -120, width: 200, height: 120, label: 'Customer checks out' },
  decision: { kind: 'diamond', x: -190, y: -140, width: 220, height: 160, label: 'In stock?' },
  ship: { kind: 'ellipse', x: 190, y: -220, width: 220, height: 130, label: 'Ship it today' },
  waitlist: { kind: 'rect', x: 190, y: 60, width: 220, height: 130, label: 'Join the waitlist' },
};

/** Where the loose end of the fourth arrow is left: out to the right of the board. */
export const LOOSE_END_POINT = { x: 560, y: -20 };

/** The box of one of the fixture's shapes, as a plain `Rect`. */
export function checkoutFlowRect(name: CheckoutFlowShape): Rect {
  const box = CHECKOUT_FLOW_SHAPES[name];
  return { x: box.x, y: box.y, width: box.width, height: box.height };
}

/**
 * Build the checkout flow into `doc` and name its objects. The document is left
 * as it would be after somebody drew the whole thing by hand: shapes, labels and
 * arrows in the order they would have happened, each in its own transaction.
 */
export function checkoutFlow(doc: Y.Doc): CheckoutFlow {
  initDoc(doc);

  const ids: Record<CheckoutFlowShape, string> = { start: '', decision: '', ship: '', waitlist: '' };
  for (const name of Object.keys(CHECKOUT_FLOW_SHAPES) as CheckoutFlowShape[]) {
    const box = CHECKOUT_FLOW_SHAPES[name];
    const at = { x: box.x, y: box.y };
    const id = createShape(doc, {
      kind: box.kind,
      rect: { x: box.x, y: box.y, width: box.width, height: box.height },
      at,
    });
    if (id === null) throw new Error(`fixture shape ${name} was refused by the model`);
    const label = getShapeLabel(doc, id);
    if (label === undefined) throw new Error(`fixture shape ${name} has no label to write into`);
    label.insert(0, box.label);
    ids[name] = id;
  }

  // The arrows. Each end is attached to the side of a shape that faces the other
  // one — `sideAnchor` is asked with the centre of the shape at the other end of
  // the arrow, exactly as the tool asks it when the pointer is let go there — and
  // carries that point as its fallback, which is what an end keeps for the day the
  // shape under it goes away.
  const attach = (name: CheckoutFlowShape, side: ConnectorSide): ConnectorEndpoint => ({
    kind: 'attached',
    objectId: ids[name],
    fallback: sideAnchor(checkoutFlowRect(name), side),
  });

  const arrows: string[] = [];
  const draw = (
    from: CheckoutFlowShape,
    fromSide: ConnectorSide,
    to: CheckoutFlowShape,
    toSide: ConnectorSide,
  ): string => {
    const id = createConnector(doc, {
      from: attach(from, fromSide),
      to: attach(to, toSide),
    });
    if (id === null) throw new Error(`fixture arrow between ${from} and ${to} was refused by the model`);
    arrows.push(id);
    return id;
  };

  draw('start', 'right', 'decision', 'left');
  draw('decision', 'right', 'ship', 'left');
  draw('decision', 'right', 'waitlist', 'left');
  // …and one drawn from a shape out into nothing, because that is how most arrows
  // on a real board spend their first few seconds.
  const loose = createConnector(doc, {
    from: attach('ship', 'right'),
    to: { kind: 'free', x: LOOSE_END_POINT.x, y: LOOSE_END_POINT.y },
  });
  if (loose === null) throw new Error('fixture arrow with the loose end was refused by the model');

  return { ...ids, arrows, looseEnd: loose };
}

/** The whole board as one encoded update, e.g. to apply into another document. */
export function encodeCheckoutFlow(doc: Y.Doc): Uint8Array {
  return Y.encodeStateAsUpdate(doc);
}

/** The fixture as a fresh document, already built: the usual way in. */
export function checkoutFlowDoc(): { doc: Y.Doc; flow: CheckoutFlow } {
  const doc = new Y.Doc();
  const flow = checkoutFlow(doc);
  return { doc, flow };
}
