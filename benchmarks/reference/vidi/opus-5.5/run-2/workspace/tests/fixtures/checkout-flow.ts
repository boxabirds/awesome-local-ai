/**
 * Story 10 fixture (design Fixtures): a checkout-flow board built with real model calls —
 * 4 labelled shapes (rect, diamond, ellipse, rect), 3 attached connectors and 1 connector
 * with a free end.
 */
import * as Y from 'yjs';
import { createShape, getShapeLabel, setShapeStyle, type ShapeKind } from '../../src/shared/objects/shape';
import { createConnector, type Endpoint } from '../../src/shared/objects/connector';
import type { Rect } from '../../src/shared/geometry';

export interface CheckoutFlow {
  doc: Y.Doc;
  shapes: { id: string; kind: ShapeKind; label: string; rect: Rect }[];
  connectors: string[];
}

const SHAPES: { kind: ShapeKind; label: string; rect: Rect }[] = [
  { kind: 'rect', label: 'Checkout', rect: { x: 100, y: 100, width: 200, height: 120 } },
  { kind: 'diamond', label: 'Paid?', rect: { x: 420, y: 80, width: 160, height: 160 } },
  { kind: 'ellipse', label: 'Ship order', rect: { x: 700, y: 100, width: 200, height: 120 } },
  { kind: 'rect', label: 'Retry payment', rect: { x: 420, y: 360, width: 160, height: 100 } },
];

export function buildCheckoutFlow(doc: Y.Doc = new Y.Doc()): CheckoutFlow {
  const shapes = SHAPES.map((s) => {
    const id = createShape(doc, { kind: s.kind, rect: s.rect, at: { x: s.rect.x, y: s.rect.y } }, 'fixture')!;
    getShapeLabel(doc, id)!.insert(0, s.label);
    return { id, ...s };
  });
  setShapeStyle(doc, shapes[0]!.id, { fill: 'blue' });
  setShapeStyle(doc, shapes[1]!.id, { fill: 'yellow', stroke: 'orange' });
  const at = (i: number): Endpoint => ({ kind: 'attached', objectId: shapes[i]!.id, fallback: { x: 0, y: 0 } });
  const connectors = [
    createConnector(doc, at(0), at(1), 'fixture')!,
    createConnector(doc, at(1), at(2), 'fixture')!,
    createConnector(doc, at(1), at(3), 'fixture')!,
    createConnector(doc, at(2), { kind: 'free', x: 1000, y: 300 }, 'fixture')!,
  ];
  return { doc, shapes, connectors };
}
