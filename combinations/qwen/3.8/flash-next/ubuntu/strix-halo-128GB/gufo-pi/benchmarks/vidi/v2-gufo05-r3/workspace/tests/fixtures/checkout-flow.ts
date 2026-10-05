/**
 * The checkout flow fixture (story 10 e2e).
 *
 * Four labelled shapes — a rectangle, a diamond, an ellipse and a rectangle — joined
 * by three arrows that are attached at both ends, plus one arrow with a loose end
 * hanging below the decision. It is built with the *real* model functions, so the
 * bytes are the bytes a person drawing this flow would have written: one transaction
 * per change, the same `objects` map, the same encoded endpoints. That matters for the
 * collaborative specs, which assert how a second client resolves these endpoints after
 * somebody moves or deletes a shape — a fixture that hand-wrote the Y.Map would be
 * testing a document the app can never produce.
 *
 * Everything sits inside the world rectangle a 1280x800 viewport shows at 100% with
 * the default camera, so a spec can press on a shape without scrolling, and the boxes
 * are returned next to the ids so a spec can compute side anchors instead of hardcoding
 * pixel positions twice.
 */

import * as Y from 'yjs';

import { initDoc } from '../../src/shared/board-model';
import { createConnector, type Endpoint } from '../../src/shared/objects/connector';
import { createShape, getShapeLabel } from '../../src/shared/objects/shape';
import type { Rect } from '../../src/shared/geometry';

/** The four shapes and the spare arrow, by their role in the flow. */
export interface CheckoutFlowIds {
  start: string;
  decide: string;
  pay: string;
  shipped: string;
  /** The arrow whose loose end dangles below `decide`. */
  branch: string;
  /** The three attached-to-attached arrows, in the order they were drawn. */
  links: string[];
}

export interface CheckoutFlowFixture {
  doc: Y.Doc;
  /** One Yjs update per change, oldest first. */
  updates: Uint8Array[];
  ids: CheckoutFlowIds;
  boxes: Record<'start' | 'decide' | 'pay' | 'shipped', Rect>;
}

/** Record every update `body` makes to `doc`, oldest first (see fixtures/boards.ts). */
function record(doc: Y.Doc, body: () => void): Uint8Array[] {
  const updates: Uint8Array[] = [];
  const listener = (update: Uint8Array): void => {
    updates.push(update.slice());
  };
  doc.on('update', listener);
  try {
    body();
  } finally {
    doc.off('update', listener);
  }
  return updates;
}

const BOXES = {
  start: { x: -580, y: -60, width: 200, height: 120 },
  decide: { x: -260, y: -90, width: 220, height: 180 },
  pay: { x: 120, y: -60, width: 200, height: 120 },
  shipped: { x: 430, y: -60, width: 200, height: 120 },
} satisfies Record<string, Rect>;

const LABELS = {
  start: 'Add to cart',
  decide: 'In stock?',
  pay: 'Take payment',
  shipped: 'Shipped',
};

const centre = (rect: Rect): { x: number; y: number } => ({
  x: rect.x + rect.width / 2,
  y: rect.y + rect.height / 2,
});

/** The midpoint of the side of `rect` that faces `toward`. */
const anchorToward = (rect: Rect, toward: Rect): { x: number; y: number } => {
  const a = centre(rect);
  const b = centre(toward);
  return Math.abs(b.x - a.x) >= Math.abs(b.y - a.y)
    ? { x: b.x >= a.x ? rect.x + rect.width : rect.x, y: a.y }
    : { x: a.x, y: b.y >= a.y ? rect.y + rect.height : rect.y };
};

/** An end joined to a shape, with its birth anchor as the fallback. */
const joined = (id: string, from: Rect, toward: Rect): Endpoint => ({
  kind: 'attached',
  objectId: id,
  fallback: anchorToward(from, toward),
});

/**
 * Build the flow.
 *
 * `by` names the author written into each object, so a spec can tell whose stroke a
 * shape remembers being.
 */
export function checkoutFlow(by = 'dana'): CheckoutFlowFixture {
  const doc = new Y.Doc();
  const ids: Partial<CheckoutFlowIds> = {};
  const links: string[] = [];

  const updates = record(doc, () => {
    initDoc(doc);

    type Key = keyof typeof BOXES;
    const made: Record<string, string> = {};
    const shape = (key: Key, kind: 'rect' | 'diamond' | 'ellipse'): void => {
      const id = createShape(doc, { kind, rect: BOXES[key], at: { x: BOXES[key].x, y: BOXES[key].y } }, by);
      if (!id) throw new Error(`fixture could not draw the ${key} shape`);
      getShapeLabel(doc, id)?.insert(0, LABELS[key]);
      made[key] = id;
    };
    shape('start', 'rect');
    shape('decide', 'diamond');
    shape('pay', 'ellipse');
    shape('shipped', 'rect');

    // The flow itself: each arrow joins the two sides that face each other.
    const link = (a: Key, b: Key): void => {
      const id = createConnector(
        doc,
        joined(made[a], BOXES[a], BOXES[b]),
        joined(made[b], BOXES[b], BOXES[a]),
        by,
      );
      if (!id) throw new Error(`fixture could not join ${a} to ${b}`);
      links.push(id);
    };
    link('start', 'decide');
    link('decide', 'pay');
    link('pay', 'shipped');

    // One arrow that goes nowhere yet: joined to the decision, loose below it, ready
    // for a spec to drag its end onto something.
    const branch = createConnector(
      doc,
      joined(made.decide, BOXES.decide, BOXES.shipped),
      { kind: 'free', x: -150, y: 260 },
      by,
    );
    if (!branch) throw new Error('fixture could not draw the spare arrow');

    ids.start = made.start;
    ids.decide = made.decide;
    ids.pay = made.pay;
    ids.shipped = made.shipped;
    ids.branch = branch;
    ids.links = links;
  });

  return { doc, updates, ids: ids as CheckoutFlowIds, boxes: BOXES };
}

/** The bytes that make a room look like this flow. */
export function encodeFlow(fixture: CheckoutFlowFixture): Uint8Array {
  return Y.encodeStateAsUpdate(fixture.doc);
}
