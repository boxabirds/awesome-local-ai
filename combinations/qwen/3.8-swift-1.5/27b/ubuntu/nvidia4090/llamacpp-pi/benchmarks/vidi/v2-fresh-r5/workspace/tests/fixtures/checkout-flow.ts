/**
 * Checkout-flow board fixture (story 10).
 * 4 labelled shapes (rect, diamond, ellipse, rect), 3 attached connectors,
 * 1 free-ended connector — built with real model calls.
 */
import * as Y from 'yjs';
import { createShape, getShapeLabel } from '../../src/shared/objects/shape';
import { createConnector } from '../../src/shared/objects/connector';
import { initDoc } from '../../src/shared/board-model';

export interface CheckoutFlowBoard {
  doc: Y.Doc;
  shapeIds: { rect1: string; diamond: string; ellipse: string; rect2: string };
  connectorIds: { c1: string; c2: string; c3: string; c4: string };
}

/**
 * Build a checkout-flow board on a fresh Y.Doc.
 * Layout (world units):
 *   rect1 "Order"     at (0, 0)     160x160
 *   diamond "Paid?"   at (300, 0)   160x160
 *   ellipse "Charge"  at (500, 0)   160x160
 *   rect2 "Ship"      at (300, 200) 160x160
 *
 * Connectors:
 *   c1: rect1 → diamond (attached)
 *   c2: diamond → ellipse (attached)
 *   c3: diamond → rect2 (attached)
 *   c4: rect1 → free point at (100, 300)
 */
export function buildCheckoutFlow(): CheckoutFlowBoard {
  const doc = new Y.Doc();
  initDoc(doc);

  // Create shapes
  const rect1 = createShape(doc, {
    kind: 'rect',
    rect: { x: 0, y: 0, width: 160, height: 160 },
    at: { x: 0, y: 0 },
  }, 'fixture')!;

  const diamond = createShape(doc, {
    kind: 'diamond',
    rect: { x: 300, y: 0, width: 160, height: 160 },
    at: { x: 300, y: 0 },
  }, 'fixture')!;

  const ellipse = createShape(doc, {
    kind: 'ellipse',
    rect: { x: 500, y: 0, width: 160, height: 160 },
    at: { x: 500, y: 0 },
  }, 'fixture')!;

  const rect2 = createShape(doc, {
    kind: 'rect',
    rect: { x: 300, y: 200, width: 160, height: 160 },
    at: { x: 300, y: 200 },
  }, 'fixture')!;

  // Add labels
  getShapeLabel(doc, rect1)!.insert(0, 'Order');
  getShapeLabel(doc, diamond)!.insert(0, 'Paid?');
  getShapeLabel(doc, ellipse)!.insert(0, 'Charge');
  getShapeLabel(doc, rect2)!.insert(0, 'Ship');

  // Create connectors
  const c1 = createConnector(doc,
    { kind: 'attached', objectId: rect1, fallback: { x: 160, y: 80 } },
    { kind: 'attached', objectId: diamond, fallback: { x: 300, y: 80 } },
    'fixture'
  )!;

  const c2 = createConnector(doc,
    { kind: 'attached', objectId: diamond, fallback: { x: 460, y: 80 } },
    { kind: 'attached', objectId: ellipse, fallback: { x: 500, y: 80 } },
    'fixture'
  )!;

  const c3 = createConnector(doc,
    { kind: 'attached', objectId: diamond, fallback: { x: 380, y: 160 } },
    { kind: 'attached', objectId: rect2, fallback: { x: 380, y: 200 } },
    'fixture'
  )!;

  const c4 = createConnector(doc,
    { kind: 'attached', objectId: rect1, fallback: { x: 80, y: 160 } },
    { kind: 'free', x: 100, y: 300 },
    'fixture'
  )!;

  return {
    doc,
    shapeIds: { rect1, diamond, ellipse, rect2 },
    connectorIds: { c1, c2, c3, c4 },
  };
}
