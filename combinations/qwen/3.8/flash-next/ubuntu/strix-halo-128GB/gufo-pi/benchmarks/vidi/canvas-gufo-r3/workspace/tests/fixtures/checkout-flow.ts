import * as Y from 'yjs';
import { initDoc, LOCAL_ORIGIN } from '@shared/board-model';
import { createShape, getShapeLabel } from '@shared/objects/shape';
import { createConnector, type Endpoint } from '@shared/objects/connector';
import type { ShapeKind } from '@shared/config';

interface FlowShape {
  kind: ShapeKind;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
}

const FLOW: FlowShape[] = [
  { kind: 'rect', x: 0, y: 0, width: 160, height: 120, label: 'Start' },
  { kind: 'diamond', x: 300, y: 20, width: 200, height: 160, label: 'Approved?' },
  { kind: 'ellipse', x: 650, y: 0, width: 180, height: 120, label: 'Ship it' },
  { kind: 'rect', x: 320, y: 320, width: 160, height: 120, label: 'Revise' },
];

/**
 * Seed a checkout-flow diagram: 4 labelled shapes, 3 attached connectors and
 * 1 free-ended connector. Built with the real model functions so anchors and
 * z-order match production. Returns the created ids.
 */
export function seedCheckoutFlow(doc: Y.Doc): { shapes: string[]; connectors: string[] } {
  initDoc(doc);
  const shapes: string[] = [];
  for (const s of FLOW) {
    const id = createShape(
      doc,
      { kind: s.kind, rect: { x: s.x, y: s.y, width: s.width, height: s.height }, at: { x: s.x + s.width / 2, y: s.y + s.height / 2 } },
      'fixture',
    );
    if (!id) continue;
    const label = getShapeLabel(doc, id);
    if (label) doc.transact(() => label.insert(0, s.label), LOCAL_ORIGIN);
    shapes.push(id);
  }
  const attached = (i: number): Endpoint => ({
    kind: 'attached',
    objectId: shapes[i],
    fallback: { x: FLOW[i].x + FLOW[i].width / 2, y: FLOW[i].y + FLOW[i].height / 2 },
  });
  const connectors: string[] = [];
  const edges: Array<[number, number]> = [
    [0, 1], // Start -> Approved?
    [1, 2], // Approved? -> Ship it
    [1, 3], // Approved? -> Revise
  ];
  for (const [a, b] of edges) {
    const id = createConnector(doc, attached(a), attached(b), 'fixture');
    if (id) connectors.push(id);
  }
  // One free-ended connector: from Revise out to empty space.
  const freeEnd = createConnector(doc, attached(3), { kind: 'free', x: 800, y: 400 }, 'fixture');
  if (freeEnd) connectors.push(freeEnd);
  return { shapes, connectors };
}
