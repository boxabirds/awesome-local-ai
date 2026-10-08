import type * as Y from 'yjs';
import { createConnector } from '../../src/shared/objects/connector';
import { createShape, getShapeLabel, setShapeStyle } from '../../src/shared/objects/shape';
import type { SeedConnector, SeedShape } from '../../src/client/canvas/testHooks';
import type { EndpointInput } from '../../src/shared/objects/connector';

/**
 * The story's golden-path diagram (design "Fixtures"): a checkout flow of four
 * labelled shapes — a rectangle, a diamond, an ellipse and a rectangle — joined by
 * three arrows that are attached at both ends, plus one arrow whose far end is fixed
 * to a point of the board rather than to a shape.
 *
 * The layout is in world units, chosen to sit inside the 1280x800 e2e viewport at
 * 100% zoom with world (0,0) in the middle of the screen: the shapes run from screen
 * x 80 to x 1180 and the loose arrow ends at screen (1160, 700).
 */

/** One shape of the fixture: where it is, what it is, and what it says. */
export const CHECKOUT_FLOW_SHAPES: readonly SeedShape[] = [
  { kind: 'rect', x: -560, y: -120, width: 220, height: 110, label: 'Browse items', fill: 'white', stroke: 'dark' },
  { kind: 'diamond', x: -240, y: -120, width: 220, height: 110, label: 'Signed in?', fill: 'yellow', stroke: 'orange' },
  { kind: 'ellipse', x: 80, y: -120, width: 220, height: 110, label: 'Payment taken', fill: 'green', stroke: 'green' },
  { kind: 'rect', x: 320, y: 120, width: 220, height: 110, label: 'Receipt sent', fill: 'blue', stroke: 'blue' },
] as const;

/**
 * The arrows, as the index of the shape each end points at, or the world point a free
 * end is fixed to. Three attached arrows in a line, and one arrow with a free end.
 */
export const CHECKOUT_FLOW_CONNECTORS: readonly {
  from: number | { x: number; y: number };
  to: number | { x: number; y: number };
}[] = [
  { from: 0, to: 1 },
  { from: 1, to: 2 },
  { from: 2, to: 3 },
  // The loose end: attached to the last shape, pointing at nothing yet.
  { from: 3, to: { x: 520, y: 300 } },
] as const;

/** The fixture's arrows as connector seeds, once the shapes have their ids. */
export function checkoutFlowConnectorSeeds(ids: readonly string[]): SeedConnector[] {
  return CHECKOUT_FLOW_CONNECTORS.map((spec) => ({
    from: end(ids, spec.from),
    to: end(ids, spec.to),
  }));

  function end(ids: readonly string[], e: number | { x: number; y: number }): SeedConnector['from'] {
    return typeof e === 'number' ? { objectId: ids[e]! } : { x: e.x, y: e.y };
  }
}

/** What `buildCheckoutFlow` made, in the order it made it. */
export interface CheckoutFlowFixture {
  /** The four shapes, in the order of `CHECKOUT_FLOW_SHAPES`. */
  shapes: string[];
  /** The four arrows: the three attached ones, then the arrow with a free end. */
  connectors: string[];
}

/**
 * Build the whole flow on a document with the same model calls the app makes, so a
 * fixture is a board somebody could have drawn — not a hand-written Y.Map.
 */
export function buildCheckoutFlow(doc: Y.Doc, by = 'dana'): CheckoutFlowFixture {
  const shapes: string[] = [];
  const connectors: string[] = [];
  doc.transact(() => {
    for (const spec of CHECKOUT_FLOW_SHAPES) {
      const width = spec.width ?? 220;
      const height = spec.height ?? 110;
      const id = createShape(
        doc,
        {
          kind: spec.kind ?? 'rect',
          rect: { x: spec.x, y: spec.y, width, height },
          at: { x: spec.x + width / 2, y: spec.y + height / 2 },
        },
        by,
      );
      if (!id) continue;
      setShapeStyle(doc, id, { fill: spec.fill, stroke: spec.stroke });
      if (spec.label) getShapeLabel(doc, id)?.insert(0, spec.label);
      shapes.push(id);
    }
    for (const spec of CHECKOUT_FLOW_CONNECTORS) {
      const id = createConnector(doc, endpoint(shapes, spec.from), endpoint(shapes, spec.to), by);
      if (id) connectors.push(id);
    }
  });
  return { shapes, connectors };

  function endpoint(shapes: string[], e: number | { x: number; y: number }): EndpointInput {
    if (typeof e === 'number') {
      const id = shapes[e]!;
      const spec = CHECKOUT_FLOW_SHAPES[e]!;
      const width = spec.width ?? 220;
      const height = spec.height ?? 110;
      return {
        kind: 'attached',
        objectId: id,
        fallback: { x: spec.x + width / 2, y: spec.y + height / 2 },
      };
    }
    return { kind: 'free', x: e.x, y: e.y };
  }
}
