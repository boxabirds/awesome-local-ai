// Story 10: a checkout-flow diagram built with the real model calls — 4 labelled shapes (rect, diamond, ellipse,
// rect), 3 attached connectors and 1 connector with a free end.
import * as Y from 'yjs';
import { LOCAL_ORIGIN, registerModelObjectType } from '../../src/shared/board-model';
import type { Rect } from '../../src/shared/geometry';
import { createShape, getShapeLabel, type ShapeKind } from '../../src/shared/objects/shape';
import { createConnector, type Endpoint } from '../../src/shared/objects/connector';
import { recordBoard, type RecordedBoard } from './boards';

// Outside the app (Node test runners) the client registry is not loaded; the model needs to know the types to
// find the rects arrows attach to.
registerModelObjectType('shape');
registerModelObjectType('connector');

export const CHECKOUT_AUTHOR = 'g_fixture';

export interface CheckoutFlow extends RecordedBoard {
  shapes: { cart: string; paid: string; receipt: string; retry: string };
  connectors: string[];
  freeConnector: string;
}

function labelled(doc: Y.Doc, kind: ShapeKind, rect: Rect, label: string): string {
  const id = createShape(doc, { kind, rect, at: { x: rect.x, y: rect.y } }, CHECKOUT_AUTHOR)!;
  doc.transact(() => getShapeLabel(doc, id)!.insert(0, label), LOCAL_ORIGIN);
  return id;
}

const to = (objectId: string): Endpoint => ({ kind: 'attached', objectId, fallback: { x: 0, y: 0 } });

export function checkoutFlow(): CheckoutFlow {
  let shapes!: CheckoutFlow['shapes'];
  let connectors: string[] = [];
  let freeConnector = '';
  const board = recordBoard((doc) => {
    shapes = {
      cart: labelled(doc, 'rect', { x: 0, y: 0, width: 200, height: 120 }, 'Checkout'),
      paid: labelled(doc, 'diamond', { x: 350, y: -20, width: 160, height: 160 }, 'Paid?'),
      receipt: labelled(doc, 'ellipse', { x: 650, y: 0, width: 200, height: 120 }, 'Send receipt'),
      retry: labelled(doc, 'rect', { x: 350, y: 300, width: 160, height: 100 }, 'Retry payment'),
    };
    connectors = [
      createConnector(doc, to(shapes.cart), to(shapes.paid), CHECKOUT_AUTHOR)!,
      createConnector(doc, to(shapes.paid), to(shapes.receipt), CHECKOUT_AUTHOR)!,
      createConnector(doc, to(shapes.paid), to(shapes.retry), CHECKOUT_AUTHOR)!,
    ];
    freeConnector = createConnector(doc, to(shapes.retry), { kind: 'free', x: 100, y: 350 }, CHECKOUT_AUTHOR)!;
  });
  return { ...board, shapes, connectors, freeConnector };
}
