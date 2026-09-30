/**
 * Fixture: checkout-flow — 4 labelled shapes and 3 attached connectors + 1 free-ended connector.
 * Used by e2e tests to set up a realistic diagram.
 */
import * as Y from 'yjs';

import { createShape } from '../../src/shared/objects/shape';
import { createConnector, type Endpoint } from '../../src/shared/objects/connector';
import { sideAnchor, nearestSide } from '../../src/shared/geometry/connector-geometry';
import type { Rect } from '../../src/shared/geometry';
import type { Point } from '../../src/shared/board-model';
import { initDoc } from '../../src/shared/board-model';

export interface FlowShape {
  id: string;
  kind: string;
  label: string;
  rect: Rect;
}

export interface FlowConnector {
  id: string;
  fromEnd: Endpoint;
  toEnd: Endpoint;
}

export interface CheckoutFlow {
  shapes: FlowShape[];
  connectors: FlowConnector[];
}

/**
 * Build a checkout-flow fixture on a fresh Y.Doc.
 *
 * Layout (world coords):
 *   "Start" (rect, 100,100, 200x120)
 *        | → connector
 *   "Valid?" (diamond, 100,350, 200x200)
 *        | → connector
 *   "Process" (ellipse, 100,650, 200x120)
 *        | → connector
 *   "Done" (rect, 100,900, 200x120)
 *   "Cancel" (rect, 400,350, 200x120) — connected from "Valid?" via free end connector
 */
export function buildCheckoutFlow(): { doc: Y.Doc; flow: CheckoutFlow } {
  const doc = new Y.Doc();
  initDoc(doc);

  const shapes: FlowShape[] = [];
  const connectors: FlowConnector[] = [];

  // Shape 1: "Start" rect
  const startId = createShape(doc, {
    kind: 'rect',
    rect: { x: 100, y: 100, width: 200, height: 120 },
    at: { x: 100, y: 100 },
  }, 'fixture')!;
  const startObj = doc.getMap('objects').get(startId) as Y.Map<unknown>;
  (startObj.get('label') as Y.Text).doc?.transact(() => {
    (startObj.get('label') as Y.Text).insert(0, 'Start');
  });
  shapes.push({ id: startId, kind: 'rect', label: 'Start', rect: { x: 100, y: 100, width: 200, height: 120 } });

  // Shape 2: "Valid?" diamond
  const validId = createShape(doc, {
    kind: 'diamond',
    rect: { x: 100, y: 350, width: 200, height: 200 },
    at: { x: 100, y: 350 },
  }, 'fixture')!;
  const validObj = doc.getMap('objects').get(validId) as Y.Map<unknown>;
  (validObj.get('label') as Y.Text).doc?.transact(() => {
    (validObj.get('label') as Y.Text).insert(0, 'Valid?');
  });
  shapes.push({ id: validId, kind: 'diamond', label: 'Valid?', rect: { x: 100, y: 350, width: 200, height: 200 } });

  // Shape 3: "Process" ellipse
  const processId = createShape(doc, {
    kind: 'ellipse',
    rect: { x: 100, y: 650, width: 200, height: 120 },
    at: { x: 100, y: 650 },
  }, 'fixture')!;
  const processObj = doc.getMap('objects').get(processId) as Y.Map<unknown>;
  (processObj.get('label') as Y.Text).doc?.transact(() => {
    (processObj.get('label') as Y.Text).insert(0, 'Process');
  });
  shapes.push({ id: processId, kind: 'ellipse', label: 'Process', rect: { x: 100, y: 650, width: 200, height: 120 } });

  // Shape 4: "Done" rect
  const doneId = createShape(doc, {
    kind: 'rect',
    rect: { x: 100, y: 900, width: 200, height: 120 },
    at: { x: 100, y: 900 },
  }, 'fixture')!;
  const doneObj = doc.getMap('objects').get(doneId) as Y.Map<unknown>;
  (doneObj.get('label') as Y.Text).doc?.transact(() => {
    (doneObj.get('label') as Y.Text).insert(0, 'Done');
  });
  shapes.push({ id: doneId, kind: 'rect', label: 'Done', rect: { x: 100, y: 900, width: 200, height: 120 } });

  // Shape 5: "Cancel" rect
  const cancelId = createShape(doc, {
    kind: 'rect',
    rect: { x: 400, y: 350, width: 200, height: 120 },
    at: { x: 400, y: 350 },
  }, 'fixture')!;
  const cancelObj = doc.getMap('objects').get(cancelId) as Y.Map<unknown>;
  (cancelObj.get('label') as Y.Text).doc?.transact(() => {
    (cancelObj.get('label') as Y.Text).insert(0, 'Cancel');
  });
  shapes.push({ id: cancelId, kind: 'rect', label: 'Cancel', rect: { x: 400, y: 350, width: 200, height: 120 } });

  // Helper: create attached connector between two shapes
  function attach(fromId: string, fromRect: Rect, toId: string, toRect: Rect) {
    const towardTo: Point = { x: toRect.x + toRect.width / 2, y: toRect.y + toRect.height / 2 };
    const towardFrom: Point = { x: fromRect.x + fromRect.width / 2, y: fromRect.y + fromRect.height / 2 };
    const fromSide = nearestSide(fromRect, towardTo);
    const toSide = nearestSide(toRect, towardFrom);
    const fromAnchor = sideAnchor(fromRect, fromSide);
    const toAnchor = sideAnchor(toRect, toSide);
    const connId = createConnector(doc,
      { kind: 'attached', objectId: fromId, fallback: fromAnchor },
      { kind: 'attached', objectId: toId, fallback: toAnchor },
      'fixture',
    )!;
    connectors.push({
      id: connId,
      fromEnd: { kind: 'attached', objectId: fromId, fallback: fromAnchor },
      toEnd: { kind: 'attached', objectId: toId, fallback: toAnchor },
    });
  }

  // Connector: Start → Valid?
  attach(startId, shapes[0]!.rect, validId, shapes[1]!.rect);

  // Connector: Valid? → Process
  attach(validId, shapes[1]!.rect, processId, shapes[2]!.rect);

  // Connector: Process → Done
  attach(processId, shapes[2]!.rect, doneId, shapes[3]!.rect);

  // Connector: Valid? → Cancel (free end on Cancel side)
  const towardCancel: Point = { x: 500, y: 410 };
  const fromSideValid = nearestSide(shapes[1]!.rect, towardCancel);
  const fromAnchorValid = sideAnchor(shapes[1]!.rect, fromSideValid);
  const freeEnd: Endpoint = { kind: 'free', x: 400, y: 410 };
  const cancelConnId = createConnector(doc,
    { kind: 'attached', objectId: validId, fallback: fromAnchorValid },
    freeEnd,
    'fixture',
  )!;
  connectors.push({
    id: cancelConnId,
    fromEnd: { kind: 'attached', objectId: validId, fallback: fromAnchorValid },
    toEnd: freeEnd,
  });

  return { doc, flow: { shapes, connectors } };
}
