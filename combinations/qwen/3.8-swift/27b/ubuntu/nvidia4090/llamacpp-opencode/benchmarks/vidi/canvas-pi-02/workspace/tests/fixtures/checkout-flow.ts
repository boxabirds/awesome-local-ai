// The checkout-flow fixture (story 10 e2e): seeds the board with the
// canonical 4-shape / 4-connector diagram through the test-mode hooks.

import type { Page } from '@playwright/test';

export interface CheckoutFlow {
  /** [cart, paid, verify, shipped] (world positions 0/300/600/900 at y 0). */
  shapes: [string, string, string, string];
  /** [cart→paid, paid→verify, verify→shipped, shipped→FREE(1200,80)]. */
  connectors: [string, string, string, string];
}

/** Seeds the checkout-flow fixture on the page's board; null on failure. */
export async function seedCheckoutFlow(page: Page): Promise<CheckoutFlow | null> {
  return page.evaluate(() => window.__vidi6?.seedCheckoutFlow() ?? null);
}
