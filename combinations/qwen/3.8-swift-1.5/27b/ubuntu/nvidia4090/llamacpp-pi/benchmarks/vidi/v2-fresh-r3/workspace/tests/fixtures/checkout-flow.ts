import * as Y from 'yjs';
import { createShape, getShapeLabel } from '../../src/shared/objects/shape';
import { createConnector } from '../../src/shared/objects/connector';

/**
 * Fixture: Checkout-flow board (design.md).
 * 4 labelled shapes (rect, diamond, ellipse, rect), 3 attached connectors,
 * 1 free-ended connector. Built with real model calls.
 */
export function createCheckoutFlowBoard(doc: Y.Doc, by = 'fixture'): {
  shapes: { start: string; decision: string; process: string; end: string };
  connectors: string[];
} {
  const shapes: { start: string; decision: string; process: string; end: string } = {
    start: '',
    decision: '',
    process: '',
    end: '',
  };

  // Shape 1: "Start" (rect) at (100, 200)
  shapes.start = createShape(doc, { kind: 'rect', rect: null, at: { x: 100, y: 200 } }, by)!;
  getShapeLabel(doc, shapes.start)!.insert(0, 'Start');

  // Shape 2: "Paid?" (diamond) at (400, 200)
  shapes.decision = createShape(doc, { kind: 'diamond', rect: null, at: { x: 400, y: 200 } }, by)!;
  getShapeLabel(doc, shapes.decision)!.insert(0, 'Paid?');

  // Shape 3: "Process" (ellipse) at (700, 100)
  shapes.process = createShape(doc, { kind: 'ellipse', rect: null, at: { x: 700, y: 100 } }, by)!;
  getShapeLabel(doc, shapes.process)!.insert(0, 'Process');

  // Shape 4: "Done" (rect) at (700, 300)
  shapes.end = createShape(doc, { kind: 'rect', rect: null, at: { x: 700, y: 300 } }, by)!;
  getShapeLabel(doc, shapes.end)!.insert(0, 'Done');

  // Connector 1: Start → Paid? (attached)
  const c1 = createConnector(
    doc,
    { kind: 'attached', objectId: shapes.start, fallback: { x: 180, y: 200 } },
    { kind: 'attached', objectId: shapes.decision, fallback: { x: 320, y: 200 } },
    by,
  )!;

  // Connector 2: Paid? → Process (attached)
  const c2 = createConnector(
    doc,
    { kind: 'attached', objectId: shapes.decision, fallback: { x: 480, y: 160 } },
    { kind: 'attached', objectId: shapes.process, fallback: { x: 620, y: 100 } },
    by,
  )!;

  // Connector 3: Paid? → Done (attached)
  const c3 = createConnector(
    doc,
    { kind: 'attached', objectId: shapes.decision, fallback: { x: 480, y: 240 } },
    { kind: 'attached', objectId: shapes.end, fallback: { x: 620, y: 300 } },
    by,
  )!;

  // Connector 4: Free-ended (from a point to the Start shape)
  const c4 = createConnector(
    doc,
    { kind: 'free', x: 20, y: 200 },
    { kind: 'attached', objectId: shapes.start, fallback: { x: 20, y: 200 } },
    by,
  )!;

  return { shapes, connectors: [c1, c2, c3, c4] };
}
