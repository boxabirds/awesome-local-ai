import * as Y from 'yjs';
import { createShape } from '../../src/shared/objects/shape';
import { createConnector } from '../../src/shared/objects/connector';

/**
 * Checkout-flow board fixture: 4 labelled shapes (rect, diamond, ellipse, rect),
 * 3 attached connectors, 1 free-ended connector. Built with real model calls.
 *
 * Layout (world coordinates):
 *   [Start] ────→ [Paid?] ────→ [Process]
 *                                   │
 *                                   ↓
 *                               [End] (free end connector)
 */
export function buildCheckoutFlow(doc: Y.Doc): {
  shapes: { start: string; paid: string; process: string; end: string };
  connectors: { c1: string; c2: string; c3: string; freeEnd: string };
} {
  // Create shapes
  const start = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 200, height: 100 }, at: { x: 0, y: 0 } }, 'fixture')!;
  const paid = createShape(doc, { kind: 'diamond', rect: { x: 400, y: 0, width: 200, height: 150 }, at: { x: 400, y: 0 } }, 'fixture')!;
  const process = createShape(doc, { kind: 'ellipse', rect: { x: 800, y: 0, width: 200, height: 120 }, at: { x: 800, y: 0 } }, 'fixture')!;
  const end = createShape(doc, { kind: 'rect', rect: { x: 800, y: 300, width: 200, height: 100 }, at: { x: 800, y: 300 } }, 'fixture')!;

  // Set labels
  const labelStart = (doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>).get(start)?.get('label');
  if (labelStart instanceof Y.Text) labelStart.insert(0, 'Start');

  const labelPaid = (doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>).get(paid)?.get('label');
  if (labelPaid instanceof Y.Text) labelPaid.insert(0, 'Paid?');

  const labelProcess = (doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>).get(process)?.get('label');
  if (labelProcess instanceof Y.Text) labelProcess.insert(0, 'Process');

  const labelEnd = (doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>).get(end)?.get('label');
  if (labelEnd instanceof Y.Text) labelEnd.insert(0, 'End');

  // Connectors
  // c1: start → paid (attached both ends)
  const c1 = createConnector(doc,
    { kind: 'attached', objectId: start, fallback: { x: 200, y: 50 } },
    { kind: 'attached', objectId: paid, fallback: { x: 400, y: 75 } },
    'fixture',
  )!;

  // c2: paid → process (attached both ends)
  const c2 = createConnector(doc,
    { kind: 'attached', objectId: paid, fallback: { x: 600, y: 75 } },
    { kind: 'attached', objectId: process, fallback: { x: 800, y: 60 } },
    'fixture',
  )!;

  // c3: process → end (attached both ends)
  const c3 = createConnector(doc,
    { kind: 'attached', objectId: process, fallback: { x: 900, y: 120 } },
    { kind: 'attached', objectId: end, fallback: { x: 900, y: 300 } },
    'fixture',
  )!;

  // freeEnd: from 'end' shape to a free point below
  const freeEnd = createConnector(doc,
    { kind: 'attached', objectId: end, fallback: { x: 900, y: 400 } },
    { kind: 'free', x: 900, y: 550 },
    'fixture',
  )!;

  return {
    shapes: { start, paid, process, end },
    connectors: { c1, c2, c3, freeEnd },
  };
}
