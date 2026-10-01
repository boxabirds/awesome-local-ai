import * as Y from 'yjs';
import { initDoc, LOCAL_ORIGIN } from '../../src/shared/board-model';
import { createConnector, type Endpoint } from '../../src/shared/objects/connector';
import { createShape, getShapeLabel, type ShapeKind } from '../../src/shared/objects/shape';

export interface CheckoutFlow { cart: string; paid: string; ship: string; done: string; connectors: string[] }

const att = (objectId: string): Endpoint => ({ kind: 'attached', objectId, fallback: { x: 0, y: 0 } });

/** A checkout flow built with real model calls: 4 labelled shapes, 3 attached arrows and 1 free-ended arrow. */
export function buildCheckoutFlow(doc: Y.Doc = new Y.Doc()): CheckoutFlow {
  initDoc(doc);
  const shape = (kind: ShapeKind, x: number, y: number, label: string) => {
    const id = createShape(doc, { kind, rect: { x, y, width: 160, height: 100 }, at: { x, y } }, 'g_fixture') as string;
    doc.transact(() => getShapeLabel(doc, id)!.insert(0, label), LOCAL_ORIGIN);
    return id;
  };
  const cart = shape('rect', -500, -50, 'Cart');
  const paid = shape('diamond', -200, -50, 'Paid?');
  const ship = shape('ellipse', 100, -50, 'Ship');
  const done = shape('rect', 400, -50, 'Done');
  const connectors = [
    createConnector(doc, att(cart), att(paid), 'g_fixture') as string,
    createConnector(doc, att(paid), att(ship), 'g_fixture') as string,
    createConnector(doc, att(ship), att(done), 'g_fixture') as string,
    createConnector(doc, att(paid), { kind: 'free', x: -120, y: 250 }, 'g_fixture') as string,
  ];
  return { cart, paid, ship, done, connectors };
}
