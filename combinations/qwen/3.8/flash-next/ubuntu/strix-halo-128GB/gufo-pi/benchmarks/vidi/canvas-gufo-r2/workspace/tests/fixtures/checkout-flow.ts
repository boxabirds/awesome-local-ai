/**
 * Checkout-flow fixture for story 10 e2e tests.
 * Provides 4 labelled shapes (rect, diamond, ellipse, rect), 3 attached connectors,
 * 1 free-ended connector built with real model calls.
 */
import * as Y from 'yjs';
import { initDoc } from '../../src/shared/board-model';
import { createShape } from '../../src/shared/objects/shape';
import { createConnector, type Endpoint } from '../../src/shared/objects/connector';
import type { Rect } from '../../src/shared/geometry';
import { nearestSide, sideAnchor } from '../../src/shared/geometry/connector-geometry';

export interface CheckoutFlow {
  doc: Y.Doc;
  shapeIds: { start: string; decision: string; end: string; log: string };
  connectorIds: string[];
}

export function buildCheckoutFlow(): CheckoutFlow {
  const doc = new Y.Doc();
  initDoc(doc);

  const start = createShape(doc, { kind: 'rect', rect: { x: 100, y: 100, width: 160, height: 100 }, at: { x: 180, y: 150 } }, 'fixture')!;
  const decision = createShape(doc, { kind: 'diamond', rect: { x: 350, y: 100, width: 140, height: 140 }, at: { x: 420, y: 170 } }, 'fixture')!;
  const end = createShape(doc, { kind: 'rect', rect: { x: 600, y: 100, width: 160, height: 100 }, at: { x: 680, y: 150 } }, 'fixture')!;
  const log = createShape(doc, { kind: 'ellipse', rect: { x: 350, y: 350, width: 140, height: 100 }, at: { x: 420, y: 400 } }, 'fixture')!;

  // Attach labels
  const objects = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
  doc.transact(() => {
    (objects.get(start)!.get('label') as Y.Text).insert(0, 'Start');
    (objects.get(decision)!.get('label') as Y.Text).insert(0, 'Valid?');
    (objects.get(end)!.get('label') as Y.Text).insert(0, 'Done');
    (objects.get(log)!.get('label') as Y.Text).insert(0, 'Log');
  });

  // Helper to make attached endpoint
  function attached(objectId: string, otherRect: Rect): Endpoint {
    const obj = objects.get(objectId)!;
    const r: Rect = { x: obj.get('x') as number, y: obj.get('y') as number, width: (obj.get('width') as number) ?? 200, height: (obj.get('height') as number) ?? 200 };
    const side = nearestSide(r, { x: otherRect.x + otherRect.width / 2, y: otherRect.y + otherRect.height / 2 });
    return { kind: 'attached', objectId, fallback: sideAnchor(r, side) };
  }

  const rect = (id: string): Rect => {
    const obj = objects.get(id)!;
    return { x: obj.get('x') as number, y: obj.get('y') as number, width: (obj.get('width') as number) ?? 200, height: (obj.get('height') as number) ?? 200 };
  };

  // 3 attached connectors
  const conn1 = createConnector(doc, attached(start, rect(decision)), attached(decision, rect(start)), 'fixture')!;
  const conn2 = createConnector(doc, attached(decision, rect(end)), attached(end, rect(decision)), 'fixture')!;
  const conn3 = createConnector(doc, attached(decision, rect(log)), attached(log, rect(decision)), 'fixture')!;

  // 1 free-ended connector
  const freeEnd = { kind: 'free' as const, x: 100, y: 300 };
  const conn4 = createConnector(doc, attached(start, { x: 100, y: 300, width: 0, height: 0 }), freeEnd, 'fixture')!;

  return {
    doc,
    shapeIds: { start, decision, end, log },
    connectorIds: [conn1, conn2, conn3, conn4],
  };
}
