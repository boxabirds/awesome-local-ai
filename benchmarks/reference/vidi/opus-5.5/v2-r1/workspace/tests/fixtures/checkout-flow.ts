// Story 10 fixture: a checkout flow diagram built with the real model calls — four labelled
// shapes (rect, diamond, ellipse, rect), three attached arrows and one free-ended arrow.
import * as Y from 'yjs';
import { initDoc } from '../../src/shared/board-model';
import type { Rect } from '../../src/shared/geometry';
import { type Endpoint, createConnector } from '../../src/shared/objects/connector';
import { type ShapeKind, createShape, getShapeLabel, setShapeStyle } from '../../src/shared/objects/shape';

export interface CheckoutFlow {
  doc: Y.Doc;
  /** Every update the doc emitted while being built, in order. */
  updates: Uint8Array[];
  shapes: { checkout: string; paid: string; retry: string; done: string };
  arrows: { checkoutToPaid: string; paidToDone: string; paidToRetry: string; note: string };
}

const attached = (objectId: string): Endpoint => ({ kind: 'attached', objectId, fallback: { x: 0, y: 0 } });

/** Shapes laid out left to right from (x0, y0), world units. */
export function checkoutFlow(x0 = 200, y0 = 200): CheckoutFlow {
  const doc = new Y.Doc();
  const updates: Uint8Array[] = [];
  doc.on('update', (u: Uint8Array) => updates.push(u));
  initDoc(doc);
  const shape = (kind: ShapeKind, rect: Rect, label: string) => {
    const id = createShape(doc, { kind, rect, at: { x: rect.x, y: rect.y } }, 'g_fixture')!;
    getShapeLabel(doc, id)!.insert(0, label);
    return id;
  };
  const checkout = shape('rect', { x: x0, y: y0, width: 160, height: 80 }, 'Checkout');
  const paid = shape('diamond', { x: x0 + 300, y: y0 - 20, width: 120, height: 120 }, 'Paid?');
  const retry = shape('ellipse', { x: x0 + 280, y: y0 + 220, width: 160, height: 90 }, 'Retry payment');
  const done = shape('rect', { x: x0 + 560, y: y0, width: 160, height: 80 }, 'Order confirmed');
  setShapeStyle(doc, done, { fill: 'green', stroke: 'green' });
  setShapeStyle(doc, retry, { fill: 'pink', stroke: 'red' });
  const arrow = (from: Endpoint, to: Endpoint) => createConnector(doc, from, to, 'g_fixture')!;
  return {
    doc,
    updates,
    shapes: { checkout, paid, retry, done },
    arrows: {
      checkoutToPaid: arrow(attached(checkout), attached(paid)),
      paidToDone: arrow(attached(paid), attached(done)),
      paidToRetry: arrow(attached(paid), attached(retry)),
      note: arrow(attached(done), { kind: 'free', x: x0 + 800, y: y0 - 120 }),
    },
  };
}
