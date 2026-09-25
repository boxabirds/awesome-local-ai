/**
 * Story 10 fixture: a checkout flow diagram built with the real model calls, so every byte is a
 * real Yjs update. Four labelled shapes (rect, diamond, ellipse, rect), three attached arrows and
 * one arrow with a free end.
 *
 *   [Checkout] ──▶ <Paid?> ──▶ [Receipt]
 *                     │
 *                     ▼
 *              (Retry payment) ──▶ · (free end)
 */
import * as Y from 'yjs';
import { initDoc } from '../../src/shared/board-model';
import type { Rect } from '../../src/shared/geometry';
import { createConnector, type Endpoint } from '../../src/shared/objects/connector';
import { createShape, getShapeLabel, setShapeStyle, type ShapeKind } from '../../src/shared/objects/shape';

const AUTHOR = 'g_fixture';

export const CHECKOUT_SHAPES = {
  checkout: { kind: 'rect', label: 'Checkout', rect: { x: 0, y: 0, width: 200, height: 120 } },
  paid: { kind: 'diamond', label: 'Paid?', rect: { x: 340, y: -20, width: 160, height: 160 } },
  retry: { kind: 'ellipse', label: 'Retry payment', rect: { x: 330, y: 280, width: 180, height: 110 } },
  receipt: { kind: 'rect', label: 'Receipt', rect: { x: 660, y: 0, width: 200, height: 120 } },
} as const satisfies Record<string, { kind: ShapeKind; label: string; rect: Rect }>;

export type CheckoutShape = keyof typeof CHECKOUT_SHAPES;

/** Where the free-ended arrow from "Retry payment" ends. */
export const FREE_END = { x: 760, y: 335 } as const;

export interface CheckoutFlow {
  doc: Y.Doc;
  ids: Record<CheckoutShape, string>;
  /** checkout→paid, paid→receipt, paid→retry (attached), retry→FREE_END. */
  arrows: string[];
}

function attached(objectId: string): Endpoint {
  return { kind: 'attached', objectId, fallback: { x: 0, y: 0 } };
}

export function checkoutFlow(): CheckoutFlow {
  const doc = new Y.Doc();
  initDoc(doc);
  const ids = {} as Record<CheckoutShape, string>;
  for (const [name, s] of Object.entries(CHECKOUT_SHAPES) as [
    CheckoutShape,
    (typeof CHECKOUT_SHAPES)[CheckoutShape],
  ][]) {
    const id = createShape(doc, { kind: s.kind, rect: s.rect, at: { x: s.rect.x, y: s.rect.y } }, AUTHOR);
    if (!id) throw new Error(`fixture shape ${name} not created`);
    getShapeLabel(doc, id)!.insert(0, s.label);
    ids[name] = id;
  }
  setShapeStyle(doc, ids.paid, { fill: 'yellow', stroke: 'orange' });
  setShapeStyle(doc, ids.retry, { fill: 'pink', stroke: 'red' });
  setShapeStyle(doc, ids.receipt, { fill: 'green', stroke: 'green' });
  const arrows = [
    createConnector(doc, attached(ids.checkout), attached(ids.paid), AUTHOR),
    createConnector(doc, attached(ids.paid), attached(ids.receipt), AUTHOR),
    createConnector(doc, attached(ids.paid), attached(ids.retry), AUTHOR),
    createConnector(doc, attached(ids.retry), { kind: 'free', ...FREE_END }, AUTHOR),
  ];
  if (arrows.some((a) => !a)) throw new Error('fixture arrow not created');
  return { doc, ids, arrows: arrows as string[] };
}
