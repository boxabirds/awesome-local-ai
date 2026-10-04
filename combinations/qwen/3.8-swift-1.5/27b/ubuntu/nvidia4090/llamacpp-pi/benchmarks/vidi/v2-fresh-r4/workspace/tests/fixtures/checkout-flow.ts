/**
 * Checkout-flow fixture (story 10): a classic flowchart built with the real
 * model calls — four labelled shapes (rect, diamond, ellipse, rect), three
 * attached connectors and one free-ended connector.
 *
 * The seeded document is pushed to a live board by
 * `tests/e2e/helpers/seed-checkout.ts`, which streams the full Yjs state over
 * a WebSocket the same way `seed-board.ts` does for sticky notes.
 */
import * as Y from 'yjs';
import { initDoc, LOCAL_ORIGIN } from '../../src/shared/board-model';
import { createShape, getShapeLabel, type ShapeKind } from '../../src/shared/objects/shape';
import { createConnector, type Endpoint } from '../../src/shared/objects/connector';
import { applyTextDiff } from '../../src/shared/text-edit';

export interface CheckoutFlowIds {
  /** rect — "Customer arrives" (0, 0, 180, 80) */
  start: string;
  /** diamond — "In stock?" (300, -20, 180, 120) */
  decide: string;
  /** ellipse — "Charge card" (300, 220, 180, 80) */
  charge: string;
  /** rect — "Order confirmed" (600, 0, 180, 80) */
  done: string;
  /** start -> decide, decide -> done, decide -> charge (all attached) */
  attachedConnectors: string[];
  /** charge -> free point (560, 40): the free-ended connector */
  freeConnector: string;
}

function makeLabeledShape(
  doc: Y.Doc,
  kind: ShapeKind,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
): string {
  const id = createShape(doc, { kind, rect: { x, y, width: w, height: h }, at: { x, y } }, 'fixture')!;
  applyTextDiff(getShapeLabel(doc, id)!, label, LOCAL_ORIGIN);
  return id;
}

/**
 * Build the checkout flow on `doc` (which must be a fresh, initialised
 * board document) and return the created ids.
 */
export function seedCheckoutFlow(doc: Y.Doc): CheckoutFlowIds {
  initDoc(doc);

  const start = makeLabeledShape(doc, 'rect', 0, 0, 180, 80, 'Customer arrives');
  const decide = makeLabeledShape(doc, 'diamond', 300, -20, 180, 120, 'In stock?');
  const charge = makeLabeledShape(doc, 'ellipse', 300, 220, 180, 80, 'Charge card');
  const done = makeLabeledShape(doc, 'rect', 600, 0, 180, 80, 'Order confirmed');

  const c1 = createConnector(
    doc,
    { kind: 'attached', objectId: start, fallback: { x: 180, y: 40 } },
    { kind: 'attached', objectId: decide, fallback: { x: 300, y: 40 } },
    'fixture',
  )!;
  const c2 = createConnector(
    doc,
    { kind: 'attached', objectId: decide, fallback: { x: 480, y: 40 } },
    { kind: 'attached', objectId: done, fallback: { x: 600, y: 40 } },
    'fixture',
  )!;
  const c3 = createConnector(
    doc,
    { kind: 'attached', objectId: decide, fallback: { x: 390, y: 100 } },
    { kind: 'attached', objectId: charge, fallback: { x: 390, y: 220 } },
    'fixture',
  )!;

  const freeEnd: Endpoint = { kind: 'free', x: 560, y: 40 };
  const c4 = createConnector(
    doc,
    { kind: 'attached', objectId: charge, fallback: { x: 480, y: 260 } },
    freeEnd,
    'fixture',
  )!;

  return {
    start,
    decide,
    charge,
    done,
    attachedConnectors: [c1, c2, c3],
    freeConnector: c4,
  };
}
