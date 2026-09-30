// Story 10 fixture: a checkout flow (world units, top-left positions) built with
// real model calls through the test hooks: 4 labelled shapes, 3 attached arrows
// and 1 arrow with a free end.
import type { Page } from '@playwright/test';

export const FLOW_SHAPES = [
  { kind: 'rect', x: 200, y: 200, width: 200, height: 120, label: 'Checkout' },
  { kind: 'diamond', x: 520, y: 180, width: 160, height: 160, label: 'Paid?' },
  { kind: 'ellipse', x: 800, y: 200, width: 200, height: 120, label: 'Send receipt' },
  { kind: 'rect', x: 520, y: 460, width: 160, height: 100, label: 'Retry payment' },
] as const;

/** Arrows by shape index; `null` = a free end at `free`. */
export const FLOW_ARROWS = [
  { from: 0, to: 1 },
  { from: 1, to: 2 },
  { from: 1, to: 3 },
  { from: 3, to: null, free: { x: 300, y: 620 } },
] as const;

export interface CheckoutFlow {
  shapes: string[];
  arrows: string[];
}

/** Seeds the flow into the page's board; returns the new ids. */
export async function seedCheckoutFlow(page: Page): Promise<CheckoutFlow> {
  return page.evaluate(
    ({ shapes, arrows }) => {
      const hooks = window.__vidi6!;
      const ids = hooks.seedShapes!(shapes.map((s) => ({ ...s })));
      const attached = (i: number) => ({ kind: 'attached', objectId: ids[i]!, fallback: { x: 0, y: 0 } });
      const arrowIds = hooks.seedConnectors!(
        arrows.map((a) => ({
          from: attached(a.from),
          to: a.to === null ? { kind: 'free', ...(a as { free: { x: number; y: number } }).free } : attached(a.to),
        })),
      );
      return { shapes: ids, arrows: arrowIds };
    },
    { shapes: FLOW_SHAPES, arrows: FLOW_ARROWS },
  );
}
