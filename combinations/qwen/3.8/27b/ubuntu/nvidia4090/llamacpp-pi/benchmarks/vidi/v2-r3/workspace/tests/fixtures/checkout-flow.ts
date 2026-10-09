/**
 * Story 10 e2e fixture: a small checkout flow — 4 labelled shapes (rect,
 * diamond, ellipse, rect) in a row, 3 connected connectors between adjacent
 * shapes, and one connector with a free tail end.
 *
 * Built with the real shared model calls (createShape / createConnector /
 * getShapeLabel) against a local Y.Doc; the resulting state update is applied
 * to a board page by seedCheckoutFlow, so the fixture shapes appear through
 * the normal sync path (and propagate to every other participant).
 *
 * Layout (world units; the specs use camera (0,0,1), so screen == world;
 * viewport 1280x800):
 *
 *   Cart (rect)      Pick (diamond)   Ship (ellipse)   Done (rect)
 *   x 100..300       x 420..580       x 700..880       x 950..1150
 *   y 100..220       y 80..240        y 100..220       y 100..220
 *   centre (200,160) (500,160)        (790,160)        (1050,160)
 *
 * Connectors: Cart→Pick, Pick→Ship, Ship→Done (attached at both ends) plus
 * Done→free(1200,400). All shapes share the centre row y=160, so attached
 * endpoints settle on the left/right sides.
 */
import * as Y from 'yjs';
import type { Page } from '@playwright/test';
import { initDoc, registerKnownObjectType } from '../../src/shared/board-model';
import { createShape, getShapeLabel, type ShapeKind } from '../../src/shared/objects/shape';
import { createConnector, type Endpoint } from '../../src/shared/objects/connector';

export interface CheckoutLayout {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CheckoutFlow {
  /** The seeded board as a serialized Yjs state update (bytes). */
  update: number[];
  ids: {
    cart: string;
    pick: string;
    ship: string;
    done: string;
    cCartPick: string;
    cPickShip: string;
    cShipDone: string;
    cTail: string;
  };
  layout: { cart: CheckoutLayout; pick: CheckoutLayout; ship: CheckoutLayout; done: CheckoutLayout };
  /** The free tail end of the Done connector. */
  tail: { x: number; y: number };
}

export function buildCheckoutFlow(): CheckoutFlow {
  // The shared model only snapshots types the client registry has registered;
  // in the browser that happens at load. This Node-side fixture does the same
  // so createConnector's live-rect lookups see the seeded shapes.
  registerKnownObjectType('shape');
  registerKnownObjectType('connector');
  const doc = new Y.Doc();
  initDoc(doc);
  const layout: CheckoutFlow['layout'] = {
    cart: { x: 100, y: 100, width: 200, height: 120 },
    pick: { x: 420, y: 80, width: 160, height: 160 },
    ship: { x: 700, y: 100, width: 180, height: 120 },
    done: { x: 950, y: 100, width: 200, height: 120 },
  };
  const mk = (kind: ShapeKind, rect: CheckoutLayout, label: string): string => {
    const id = createShape(doc, { kind, rect, at: { x: rect.x, y: rect.y } }, 'fixture');
    if (id === null) throw new Error('fixture: createShape failed');
    getShapeLabel(doc, id)!.insert(0, label);
    return id;
  };
  const conn = (from: Endpoint, to: Endpoint): string => {
    const id = createConnector(doc, from, to, 'fixture');
    if (id === null) throw new Error('fixture: createConnector failed');
    return id;
  };
  const attached = (objectId: string): Endpoint => ({ kind: 'attached', objectId, fallback: { x: 0, y: 0 } });
  const shapes = {
    cart: mk('rect', layout.cart, 'Cart'),
    pick: mk('diamond', layout.pick, 'Pick'),
    ship: mk('ellipse', layout.ship, 'Ship'),
    done: mk('rect', layout.done, 'Done'),
  };
  // The placeholder fallbacks (0,0) are replaced by createConnector with the
  // live side anchors (all targets exist in this document).
  const ids = {
    ...shapes,
    cCartPick: conn(attached(shapes.cart), attached(shapes.pick)),
    cPickShip: conn(attached(shapes.pick), attached(shapes.ship)),
    cShipDone: conn(attached(shapes.ship), attached(shapes.done)),
    cTail: conn(attached(shapes.done), { kind: 'free', x: 1200, y: 400 }),
  };
  return {
    update: Array.from(Y.encodeStateAsUpdate(doc)),
    ids,
    layout,
    tail: { x: 1200, y: 400 },
  };
}

/**
 * Apply the fixture's state update to the page's board doc. Call after
 * openBoard (once the provider has connected): the objects enter the doc
 * locally and are broadcast to every other participant over the server.
 */
export async function seedCheckoutFlow(page: Page, flow: CheckoutFlow): Promise<void> {
  await page.evaluate((bytes) => {
    const { doc, Y } = window.__vidi6!;
    Y.applyUpdate(doc, Uint8Array.from(bytes), 'seed');
  }, flow.update);
}

/** The ids of all connector objects in the page's doc. */
export async function connectorIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    window.__vidi6!.doc.getMap('objects').forEach((it, key) => {
      if (it.get('type') === 'connector') out.push(key);
    });
    return out;
  });
}

/** The number of shape objects in the page's doc. */
export async function shapeCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    let n = 0;
    window.__vidi6!.doc.getMap('objects').forEach((it) => {
      if (it.get('type') === 'shape') n++;
    });
    return n;
  });
}

/** True if the object id is still present in the page's doc. */
export async function hasObject(page: Page, id: string): Promise<boolean> {
  return page.evaluate((oid) => window.__vidi6!.doc.getMap('objects').has(oid), id);
}

/** Read an endpoint ('from' | 'to') of a connector from the page's doc. */
export async function readEndpoint(
  page: Page,
  connectorId: string,
  which: 'from' | 'to',
): Promise<{ kind: string; objectId?: string; x?: number; y?: number; fallback?: { x: number; y: number } }> {
  return page.evaluate(
    ([cid, w]) => {
      const it = window.__vidi6!.doc.getMap('objects').get(cid);
      if (!it) throw new Error('connector missing');
      return it.get(w);
    },
    [connectorId, which],
  );
}
