import type * as Y from 'yjs';
import { seedCheckoutFlow as build, type CheckoutFlow } from '../../src/shared/board-seed';

export type { CheckoutFlow };

// Story 10 e2e fixture: a 4-step checkout flow — labelled rect, diamond,
// ellipse and rect joined by 3 attached connectors, plus 1 free-ended
// connector — built with the real shape/connector model. The browser test seeds
// the live board through `window.__vidi6.seedCheckoutFlow()`, which calls the
// same shared builder; this module is the Node-side entry point (integration
// style) for the identical layout.
export function seedCheckoutFlow(doc: Y.Doc): CheckoutFlow {
  return build(doc);
}
