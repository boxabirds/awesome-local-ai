/**
 * Story 10 e2e fixture — the "checkout flow" board (connector.ui e2e
 * fixtures): 4 labelled shapes (rect, diamond, ellipse, rect), 3 attached
 * connectors (Cart→Checkout→Payment, Checkout→Confirmation) and 1
 * free-ended connector (Payment→free point), built with the REAL model
 * calls so the e2e exercises the same code paths as the UI.
 *
 * Invoked in-page through the `__vidi6.seedCheckoutFlow()` test hook
 * (Board.tsx binds this function to the page's doc + identity).
 */
import type * as Y from 'yjs';
import {
  createShape,
  getShapeLabel,
  type ShapeKind,
} from 'src/shared/objects/shape';
import { createConnector } from 'src/shared/objects/connector';
import { sideAnchor, nearestSide, type Endpoint } from 'src/shared/geometry/connector-geometry';

interface FixtureShape {
  kind: ShapeKind;
  rect: { x: number; y: number; width: number; height: number };
  label: string;
}

const LAYOUT: FixtureShape[] = [
  { kind: 'rect', rect: { x: 100, y: 100, width: 160, height: 120 }, label: 'Cart' },
  { kind: 'diamond', rect: { x: 400, y: 100, width: 160, height: 120 }, label: 'Checkout' },
  { kind: 'ellipse', rect: { x: 700, y: 100, width: 160, height: 120 }, label: 'Payment' },
  { kind: 'rect', rect: { x: 400, y: 300, width: 160, height: 120 }, label: 'Confirmation' },
];

const centreOf = (r: FixtureShape['rect']) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

/**
 * Seeds the checkout flow into `doc` and returns the shape ids in layout
 * order [cart, checkout, payment, confirmation].
 */
export function seedCheckoutFlow(doc: Y.Doc, identity: string): string[] {
  const ids: string[] = [];
  for (const s of LAYOUT) {
    const id = createShape(doc, { kind: s.kind, rect: s.rect, at: { x: s.rect.x, y: s.rect.y } }, identity);
    if (id) {
      getShapeLabel(doc, id)?.insert(0, s.label);
      ids.push(id);
    }
  }

  const rectOf = (i: number): FixtureShape['rect'] => LAYOUT[i].rect;
  const attached = (i: number, towardIndex: number | null): Endpoint => {
    const r = rectOf(i);
    const toward = towardIndex === null ? centreOf(r) : centreOf(rectOf(towardIndex));
    return { kind: 'attached', objectId: ids[i], fallback: sideAnchor(r, nearestSide(r, toward)) };
  };

  // Cart → Checkout → Payment, Checkout → Confirmation (3 attached).
  createConnector(doc, attached(0, 1), attached(1, 0), identity);
  createConnector(doc, attached(1, 2), attached(2, 1), identity);
  createConnector(doc, attached(1, 3), attached(3, 1), identity);
  // Payment → free point (1 free-ended).
  createConnector(doc, attached(2, null), { kind: 'free', x: 1000, y: 420 }, identity);

  return ids;
}
