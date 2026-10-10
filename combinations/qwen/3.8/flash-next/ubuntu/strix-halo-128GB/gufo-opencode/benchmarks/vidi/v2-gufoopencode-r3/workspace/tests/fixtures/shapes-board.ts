import * as Y from 'yjs';
import { initDoc } from '../../src/shared/board-model';
import { nearestSide, sideAnchor } from '../../src/shared/geometry/connector-geometry';
import { createConnector } from '../../src/shared/objects/connector';
import { createShape, getShapeLabel } from '../../src/shared/objects/shape';
import type { ShapeKind } from '../../src/shared/config';
import type { Rect } from '../../src/shared/geometry';

export interface CheckoutBoard {
  doc: Y.Doc;
  shapeIds: Record<'start' | 'paid' | 'process' | 'done', string>;
  connectorIds: string[];
}

// Checkout flow board for shape/connector tests: four labelled shapes
// (rect, diamond, ellipse, rect), three attached connectors following the
// flow, and one free-ended connector — all built with real model calls.
export function buildCheckoutBoard(): CheckoutBoard {
  const doc = new Y.Doc();
  initDoc(doc);

  const rects: Record<'start' | 'paid' | 'process' | 'done', { rect: Rect; kind: ShapeKind; label: string }> = {
    start: { rect: { x: 0, y: 0, width: 240, height: 120 }, kind: 'rect', label: 'Start' },
    paid: { rect: { x: 440, y: 0, width: 200, height: 140 }, kind: 'diamond', label: 'Paid?' },
    process: { rect: { x: 440, y: 320, width: 240, height: 120 }, kind: 'ellipse', label: 'Process order' },
    done: { rect: { x: 0, y: 320, width: 240, height: 120 }, kind: 'rect', label: 'Done' }
  };

  const shapeIds = {} as CheckoutBoard['shapeIds'];
  for (const [key, spec] of Object.entries(rects)) {
    const id = createShape(doc, { kind: spec.kind, rect: spec.rect, at: spec.rect }, 'g_fixture');
    if (id === null) throw new Error(`fixture: could not create ${key}`);
    getShapeLabel(doc, id)?.insert(0, spec.label);
    shapeIds[key as keyof CheckoutBoard['shapeIds']] = id;
  }

  const attach = (a: keyof CheckoutBoard['shapeIds'], b: keyof CheckoutBoard['shapeIds']): string | null => {
    const ra = rects[a].rect;
    const rb = rects[b].rect;
    const ca = { x: ra.x + ra.width / 2, y: ra.y + ra.height / 2 };
    const cb = { x: rb.x + rb.width / 2, y: rb.y + rb.height / 2 };
    return createConnector(
      doc,
      { kind: 'attached', objectId: shapeIds[a], fallback: sideAnchor(ra, nearestSide(ra, cb)) },
      { kind: 'attached', objectId: shapeIds[b], fallback: sideAnchor(rb, nearestSide(rb, ca)) },
      'g_fixture'
    );
  };

  const connectorIds: string[] = [];
  for (const pair of [
    ['start', 'paid'],
    ['paid', 'process'],
    ['process', 'done']
  ] as const) {
    const id = attach(pair[0], pair[1]);
    if (id === null) throw new Error(`fixture: could not connect ${pair[0]} to ${pair[1]}`);
    connectorIds.push(id);
  }

  // Free-ended connector: floats in the blank area and points at Done.
  const done = rects.done.rect;
  const free = createConnector(
    doc,
    { kind: 'free', x: -260, y: 200 },
    { kind: 'attached', objectId: shapeIds.done, fallback: sideAnchor(done, nearestSide(done, { x: -260, y: 200 })) },
    'g_fixture'
  );
  if (free === null) throw new Error('fixture: could not create free connector');
  connectorIds.push(free);

  return { doc, shapeIds, connectorIds };
}
