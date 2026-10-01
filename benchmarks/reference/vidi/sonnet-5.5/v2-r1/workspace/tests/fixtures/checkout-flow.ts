import * as Y from 'yjs';
import { initDoc } from '../../src/shared/board-model';
import type { Endpoint } from '../../src/shared/objects/connector';
import { createConnector } from '../../src/shared/objects/connector';
import { createShape, getShapeLabel } from '../../src/shared/objects/shape';
import type { ShapeKind } from '../../src/shared/objects/shape';

export interface CheckoutFlow {
  doc: Y.Doc;
  shapes: Record<'cart' | 'paid' | 'ship' | 'done', string>;
  connectors: string[];
}

const attached = (objectId: string): Endpoint => ({ kind: 'attached', objectId, fallback: { x: 0, y: 0 } });

/** Checkout-flow board built with real model calls: 4 labelled shapes (rect, diamond, ellipse, rect), 3 attached arrows, 1 free-ended arrow. */
export function checkoutFlow(doc: Y.Doc = new Y.Doc()): CheckoutFlow {
  initDoc(doc);
  const make = (kind: ShapeKind, x: number, y: number, label: string) => {
    const id = createShape(doc, { kind, rect: { x, y, width: 160, height: 100 }, at: { x, y } }, 'u_fixture') as string;
    getShapeLabel(doc, id)?.insert(0, label);
    return id;
  };
  const cart = make('rect', 0, 0, 'Cart');
  const paid = make('diamond', 300, 0, 'Paid?');
  const ship = make('ellipse', 600, 0, 'Ship');
  const done = make('rect', 600, 250, 'Done');
  const connectors = [
    createConnector(doc, attached(cart), attached(paid), 'u_fixture'),
    createConnector(doc, attached(paid), attached(ship), 'u_fixture'),
    createConnector(doc, attached(ship), attached(done), 'u_fixture'),
    createConnector(doc, attached(paid), { kind: 'free', x: 380, y: 300 }, 'u_fixture'),
  ] as string[];
  return { doc, shapes: { cart, paid, ship, done }, connectors };
}
