import * as Y from 'yjs';
import { initDoc } from '../../src/shared/board-model';
import { createConnector } from '../../src/shared/objects/connector';
import { createShape, getShapeLabel, setShapeStyle } from '../../src/shared/objects/shape';

export interface CheckoutFlow {
  doc: Y.Doc;
  /** Every Yjs update, in order (what a room would append as log rows). */
  updates: Uint8Array[];
  ids: { cart: string; paid: string; ship: string; done: string };
  /** Objects on the board: 4 shapes and 4 arrows. */
  objectCount: number;
}

/** 4 labelled shapes (rect, diamond, ellipse, rect), 3 attached arrows and 1 arrow with a free end. */
export function checkoutFlow(): CheckoutFlow {
  const doc = new Y.Doc();
  const updates: Uint8Array[] = [];
  doc.on('update', (u: Uint8Array) => updates.push(u));
  initDoc(doc);
  const shape = (kind: 'rect' | 'ellipse' | 'diamond', x: number, y: number, w: number, h: number, label: string) => {
    const id = createShape(doc, { kind, rect: { x, y, width: w, height: h }, at: { x, y } }, 'g_fixture') as string;
    getShapeLabel(doc, id)!.insert(0, label);
    return id;
  };
  const cart = shape('rect', 100, 100, 200, 100, 'Checkout');
  const paid = shape('diamond', 450, 80, 160, 140, 'Paid?');
  const ship = shape('ellipse', 800, 100, 200, 100, 'Ship');
  const done = shape('rect', 450, 380, 200, 100, 'Done');
  setShapeStyle(doc, done, { fill: 'green' });
  const attach = (objectId: string) => ({ kind: 'attached' as const, objectId, fallback: { x: 0, y: 0 } });
  createConnector(doc, attach(cart), attach(paid), 'g_fixture');
  createConnector(doc, attach(paid), attach(ship), 'g_fixture');
  createConnector(doc, attach(paid), attach(done), 'g_fixture');
  createConnector(doc, attach(ship), { kind: 'free', x: 1100, y: 450 }, 'g_fixture');
  return { doc, updates, ids: { cart, paid, ship, done }, objectCount: 8 };
}
