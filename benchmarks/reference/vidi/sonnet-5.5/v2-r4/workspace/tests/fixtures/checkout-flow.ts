import * as Y from 'yjs';
import { createConnector, type Endpoint } from '../../src/shared/objects/connector';
import { createShape, getShapeLabel, type ShapeKind } from '../../src/shared/objects/shape';
import { initDoc } from '../../src/shared/board-model';

export interface CheckoutFlow {
  doc: Y.Doc;
  ids: { cart: string; pay: string; ship: string; done: string };
  connectors: string[];
}

/**
 * Checkout flow built with real model calls: four labelled shapes (rect, diamond, ellipse, rect),
 * three attached arrows between them and one arrow with free ends below.
 */
export function buildCheckoutFlow(): CheckoutFlow {
  const doc = new Y.Doc();
  initDoc(doc);
  const shape = (kind: ShapeKind, label: string, x: number, y: number, w: number, h: number) => {
    const id = createShape(doc, { kind, rect: { x, y, width: w, height: h }, at: { x, y } }, 'g_fixture')!;
    getShapeLabel(doc, id)!.insert(0, label);
    return id;
  };
  const cart = shape('rect', 'Cart', -500, -200, 160, 100);
  const pay = shape('diamond', 'Paid?', -200, -225, 160, 150);
  const ship = shape('ellipse', 'Ship', 100, -200, 160, 100);
  const done = shape('rect', 'Done', 400, -200, 160, 100);
  const att = (objectId: string): Endpoint => ({ kind: 'attached', objectId, fallback: { x: 0, y: 0 } });
  const connectors = [
    createConnector(doc, att(cart), att(pay), 'g_fixture')!,
    createConnector(doc, att(pay), att(ship), 'g_fixture')!,
    createConnector(doc, att(ship), att(done), 'g_fixture')!,
    createConnector(doc, { kind: 'free', x: -500, y: 150 }, { kind: 'free', x: -100, y: 150 }, 'g_fixture')!,
  ];
  return { doc, ids: { cart, pay, ship, done }, connectors };
}
