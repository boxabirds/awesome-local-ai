/**
 * Story 10 e2e fixture: the "Checkout flow" board.
 *
 * Built with the REAL board-model calls (createShape + createConnector), so
 * the update bytes are exactly what the app writes. Specs seed a fresh board
 * by applying `update` through the `applyUpdates` test hook (non-provider
 * origin: pushed to the room and persisted, so late joiners see it too).
 *
 * Layout (world units; the e2e camera is (-640, -360) zoom 1, so screen =
 * world + (640, 360)):
 *
 *   Start (rect)      (-500, -60, 120, 90)   screen x 140..260
 *   Charge (diamond)  (-200, -60, 120, 90)   screen x 440..560
 *   Card (ellipse)    ( 100, -60, 120, 90)   screen x 740..860
 *   Done (rect)       ( 400, -60, 120, 90)   screen x 1040..1160
 *
 * Connectors: Start→Charge, Charge→Card, Card→Done (all attached/attached),
 * plus one free-ended arrow dangling off Card's bottom side.
 */
import * as Y from 'yjs';
import { LOCAL_ORIGIN, type Endpoint } from '@/shared/board-model';
import { nearestSide, sideAnchor } from '@/shared/geometry/connector-geometry';
import type { Point, Rect } from '@/shared/geometry';
import { createShape, getShapeLabel, type ShapeKind } from '@/shared/objects/shape';
import { createConnector } from '@/shared/objects/connector';

export interface CheckoutFlowShape {
  id: string;
  label: string;
  rect: Rect;
}

export interface CheckoutFlowConnector {
  id: string;
  /** The object at the `from` end (null: free end). */
  fromId: string | null;
  /** The object at the `to` end (null: free end). */
  toId: string | null;
}

export interface CheckoutFlow {
  shapes: CheckoutFlowShape[];
  connectors: CheckoutFlowConnector[];
  /** Full-state update of the built doc (base64). */
  update: string;
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return Buffer.from(binary, 'binary').toString('base64');
}

export function buildCheckoutFlow(): CheckoutFlow {
  const doc = new Y.Doc();

  const layout: { label: string; kind: ShapeKind; rect: Rect }[] = [
    { label: 'Start', kind: 'rect', rect: { x: -500, y: -60, width: 120, height: 90 } },
    { label: 'Charge', kind: 'diamond', rect: { x: -200, y: -60, width: 120, height: 90 } },
    { label: 'Card', kind: 'ellipse', rect: { x: 100, y: -60, width: 120, height: 90 } },
    { label: 'Done', kind: 'rect', rect: { x: 400, y: -60, width: 120, height: 90 } },
  ];

  const shapes = layout.map((s) => {
    const id = createShape(doc, { kind: s.kind, rect: s.rect, at: { x: s.rect.x, y: s.rect.y } }, 'fixture');
    if (id === null) throw new Error(`fixture: shape ${s.label} not created`);
    const label = getShapeLabel(doc, id);
    if (label === undefined) throw new Error(`fixture: no label for ${s.label}`);
    doc.transact(() => {
      label.insert(0, s.label);
    }, LOCAL_ORIGIN);
    return { id, label: s.label, rect: s.rect };
  });

  const rectOf = (id: string): Rect => shapes.find((s) => s.id === id)!.rect;
  const center = (r: Rect): Point => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
  const attached = (objectId: string, toward: Point): Endpoint => {
    const rect = rectOf(objectId);
    return { kind: 'attached', objectId, fallback: sideAnchor(rect, nearestSide(rect, toward)) };
  };

  const connectors: CheckoutFlowConnector[] = [];
  const link = (fromId: string, toId: string): void => {
    const id = createConnector(
      doc,
      attached(fromId, center(rectOf(toId))),
      attached(toId, center(rectOf(fromId))),
      'fixture',
    );
    if (id === null) throw new Error(`fixture: connector ${fromId}->${toId} rejected`);
    connectors.push({ id, fromId, toId });
  };
  link(shapes[0].id, shapes[1].id);
  link(shapes[1].id, shapes[2].id);
  link(shapes[2].id, shapes[3].id);

  // One free-ended connector off Card's bottom.
  const freeEnd: Point = { x: 160, y: 200 };
  const freeId = createConnector(doc, attached(shapes[2].id, freeEnd), { kind: 'free', x: freeEnd.x, y: freeEnd.y }, 'fixture');
  if (freeId === null) throw new Error('fixture: free-ended connector rejected');
  connectors.push({ id: freeId, fromId: shapes[2].id, toId: null });

  return { shapes, connectors, update: base64(Y.encodeStateAsUpdate(doc)) };
}
