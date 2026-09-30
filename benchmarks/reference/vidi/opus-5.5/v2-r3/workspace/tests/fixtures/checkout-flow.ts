// Story 10 fixture: a checkout flow built with the real model calls — four
// labelled shapes (rect, diamond, ellipse, rect), three attached arrows and
// one arrow with a free end. World coordinates.
import * as Y from 'yjs';
import { initDoc } from '../../src/shared/board-model';
import type { Rect } from '../../src/shared/geometry';
import { createConnector, type Endpoint } from '../../src/shared/objects/connector';
import { createShape, getShapeLabel, type ShapeKind } from '../../src/shared/objects/shape';

export const CHECKOUT_SHAPES: { key: 'cart' | 'paid' | 'receipt' | 'retry'; kind: ShapeKind; rect: Rect; label: string }[] = [
  { key: 'cart', kind: 'rect', rect: { x: 100, y: 100, width: 160, height: 100 }, label: 'Cart' },
  { key: 'paid', kind: 'diamond', rect: { x: 400, y: 80, width: 140, height: 140 }, label: 'Paid?' },
  { key: 'receipt', kind: 'ellipse', rect: { x: 700, y: 100, width: 160, height: 100 }, label: 'Receipt' },
  { key: 'retry', kind: 'rect', rect: { x: 400, y: 350, width: 160, height: 100 }, label: 'Retry payment' },
];

export interface CheckoutFlow {
  doc: Y.Doc;
  shapes: Record<'cart' | 'paid' | 'receipt' | 'retry', string>;
  connectors: string[];
}

export function checkoutFlow(): CheckoutFlow {
  const doc = new Y.Doc();
  initDoc(doc);
  const shapes = {} as CheckoutFlow['shapes'];
  for (const s of CHECKOUT_SHAPES) {
    const id = createShape(doc, { kind: s.kind, rect: s.rect, at: { x: s.rect.x, y: s.rect.y } }, 'fixture')!;
    getShapeLabel(doc, id)!.insert(0, s.label);
    shapes[s.key] = id;
  }
  const on = (objectId: string): Endpoint => ({ kind: 'attached', objectId, fallback: { x: 0, y: 0 } });
  const connectors = [
    createConnector(doc, on(shapes.cart), on(shapes.paid), 'fixture')!,
    createConnector(doc, on(shapes.paid), on(shapes.receipt), 'fixture')!,
    createConnector(doc, on(shapes.paid), on(shapes.retry), 'fixture')!,
    createConnector(doc, on(shapes.receipt), { kind: 'free', x: 1000, y: 150 }, 'fixture')!,
  ];
  return { doc, shapes, connectors };
}
