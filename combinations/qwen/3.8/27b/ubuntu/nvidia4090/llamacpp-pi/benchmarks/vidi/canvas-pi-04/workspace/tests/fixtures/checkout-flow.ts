// Story 10 e2e fixture: the "checkout flow" board (task 15).
//
// Four labelled shapes (rect, diamond, ellipse, rect), three attached
// connectors and one free-ended connector. The layout is applied server
// side through real model calls (createShape / getShapeLabel /
// createConnector) by the /__test/boards/:id/seed-flow worker hook, so the
// board has exactly the same shape as one grown by hand.
//
// Layout (world units, 1280x800 viewport at 100% zoom):
//
//   Checkout[rect]      Authorize[diamond]   Payment[ellipse]
//   (100,100,160,120)   (400,100,160,120)    (700,100,160,120)
//        |->|  (260,160)->(400,160) (560,160)->(700,160)
//        v                v                   v
//   (400,160)...      Confirmation email[rect]
//   (400,400,160,120)  <---(400..560,460) free end at (940,460) ->
//
//   checkout -> auth -> payment -> confirm   (attached, in order)
//   (940,460)  -> confirm                    (free end, attached end)

export type FlowShapeKind = 'rect' | 'ellipse' | 'diamond';

export interface FlowShapeSpec {
  /** Stable key the tests use to find the object; not stored in the doc. */
  key: string;
  kind: FlowShapeKind;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FlowEndpointSpec {
  /** Attached to the shape with this key. */
  key?: string;
  /** A free world point (when `key` is absent). */
  x?: number;
  y?: number;
}

export interface FlowConnectorSpec {
  from: FlowEndpointSpec;
  to: FlowEndpointSpec;
}

export interface FlowSpec {
  shapes: FlowShapeSpec[];
  connectors: FlowConnectorSpec[];
}

export const CHECKOUT_FLOW: FlowSpec = {
  shapes: [
    { key: 'checkout', kind: 'rect', label: 'Checkout', x: 100, y: 100, w: 160, h: 120 },
    { key: 'auth', kind: 'diamond', label: 'Authorize', x: 400, y: 100, w: 160, h: 120 },
    { key: 'payment', kind: 'ellipse', label: 'Payment gateway', x: 700, y: 100, w: 160, h: 120 },
    { key: 'confirm', kind: 'rect', label: 'Confirmation email', x: 400, y: 400, w: 160, h: 120 },
  ],
  connectors: [
    { from: { key: 'checkout' }, to: { key: 'auth' } },
    { from: { key: 'auth' }, to: { key: 'payment' } },
    { from: { key: 'payment' }, to: { key: 'confirm' } },
    { from: { x: 940, y: 460 }, to: { key: 'confirm' } },
  ],
};
