// Story 10 e2e fixture: a small checkout flow — four labelled shapes
// (rect, diamond, ellipse, rect) with three attached connectors and one
// free-ended connector.
//
// The fixture is a plain-data spec. The actual objects are created inside the
// board document by the e2e spec through the story-10 test hooks
// (`createShape`, `setShapeLabel`, `createConnector`), which call the real
// model functions — so the board is built with real model calls, not a
// hand-written Y.Doc.
//
// Layout (world units): the flow runs left-to-right along y = 40..120, with
// "Done" branching down. Shapes 0 ("Start") and 2 ("Charge card") share the
// same centre line (y = 80), so a connector between them attaches to their
// left/right sides and flips side cleanly when one is dragged past the other.

export interface CheckoutShapeSpec {
  kind: 'rect' | 'ellipse' | 'diamond';
  rect: { x: number; y: number; width: number; height: number };
  label: string;
}

/**
 * A connector endpoint reference: a shape index (attached) or, when the
 * index is null, a free endpoint at `point`.
 */
export interface CheckoutEndpointSpec {
  shape: number | null;
  point?: { x: number; y: number };
}

export interface CheckoutFlowSpec {
  shapes: CheckoutShapeSpec[];
  connectors: Array<{ from: CheckoutEndpointSpec; to: CheckoutEndpointSpec }>;
}

export function checkoutFlowSpec(): CheckoutFlowSpec {
  return {
    shapes: [
      { kind: 'rect', rect: { x: 0, y: 40, width: 160, height: 80 }, label: 'Start' },
      { kind: 'diamond', rect: { x: 300, y: 0, width: 160, height: 160 }, label: 'Validate' },
      { kind: 'ellipse', rect: { x: 560, y: 40, width: 200, height: 80 }, label: 'Charge card' },
      { kind: 'rect', rect: { x: 560, y: 320, width: 200, height: 80 }, label: 'Done' },
    ],
    connectors: [
      { from: { shape: 0 }, to: { shape: 1 } }, // Start -> Validate
      { from: { shape: 1 }, to: { shape: 2 } }, // Validate -> Charge card
      { from: { shape: 2 }, to: { shape: 3 } }, // Charge card -> Done
      { from: { shape: null, point: { x: 200, y: 300 } }, to: { shape: 3 } }, // (free) -> Done
    ],
  };
}

/** Shape indices used by the collaborative tests (same centre line). */
export const CHECKOUT = {
  A: 0, // "Start"  — left
  B: 2, // "Charge card" — right, same y as A
} as const;
