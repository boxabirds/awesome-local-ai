/**
 * Story 10 · task 15 — the checkout-flow fixture (design "Fixtures").
 *
 * A small board worth looking at, built with the *real* model functions rather
 * than hand-written `Y.Map`s, so anything that reads it (a snapshot, a hit test,
 * a render, a two-document sync) sees exactly what a person's gestures would
 * have produced: four labelled shapes — rectangle, diamond, ellipse, rectangle —
 * three arrows attached at both ends and one arrow with a free end.
 *
 * The shapes are laid out left to right in a band, with the diamond's branch
 * dropping down, so an arrow between two of them always has a clear nearest
 * side and the geometry tests get to exercise a side *change* (a shape moved
 * past its neighbour) rather than only a side that never moves.
 */
import * as Y from 'yjs';
import { initDoc } from '../../src/shared/board-model';
import { createShape, type ShapeKind } from '../../src/shared/objects/shape';
import { createConnector } from '../../src/shared/objects/connector';
import { LOCAL_ORIGIN } from '../../src/shared/doc';

/** What the fixture made, so a test can point at parts of it by name. */
export interface CheckoutFlow {
  doc: Y.Doc;
  /** Shape ids, in layout order: start, decide, wait, ship. */
  shapes: Record<'start' | 'decide' | 'wait' | 'ship', string>;
  /** Connector ids: start→decide, decide→wait, decide→ship, and the free one. */
  connectors: Record<'toDecide' | 'toWait' | 'toShip' | 'free', string>;
}

interface ShapeSpec {
  key: 'start' | 'decide' | 'wait' | 'ship';
  kind: ShapeKind;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
}

/** The four shapes: a rectangle, a decision diamond, an ellipse and a rectangle. */
const SHAPE_SPECS: readonly ShapeSpec[] = [
  {
    key: 'start',
    kind: 'rect',
    x: -320,
    y: -80,
    width: 180,
    height: 120,
    label: 'Order placed',
  },
  {
    key: 'decide',
    kind: 'diamond',
    x: -60,
    y: -100,
    width: 200,
    height: 160,
    label: 'In stock?',
  },
  {
    key: 'wait',
    kind: 'ellipse',
    x: 240,
    y: -140,
    width: 200,
    height: 120,
    label: 'Backorder — wait 5 days',
  },
  {
    key: 'ship',
    kind: 'rect',
    x: 240,
    y: 60,
    width: 200,
    height: 120,
    label: 'Ship now',
  },
];

/**
 * Build the fixture into `doc` (which must already be initialised). Every shape
 * gets its label, every arrow is written by the real `createConnector`, so a
 * refused arrow would show up as a missing id rather than a broken record.
 */
export function buildCheckoutFlow(doc: Y.Doc): CheckoutFlow {
  const ids: Record<string, string> = {};
  for (const spec of SHAPE_SPECS) {
    const id = createShape(
      doc,
      {
        kind: spec.kind,
        rect: { x: spec.x, y: spec.y, width: spec.width, height: spec.height },
        at: { x: spec.x, y: spec.y },
      },
      'fixture',
    );
    if (id === null) throw new Error(`fixture: could not create ${spec.key}`);
    const record = doc.getMap<Y.Map<unknown>>('objects').get(id)!;
    const label = record.get('label') as Y.Text;
    doc.transact(() => label.insert(0, spec.label), LOCAL_ORIGIN);
    ids[spec.key] = id;
  }

  const made = (from: string, to: string | { x: number; y: number }) => {
    const target =
      typeof to === 'string'
        ? ({ kind: 'attached', objectId: to, fallback: { x: 0, y: 0 } } as const)
        : ({ kind: 'free', x: to.x, y: to.y } as const);
    const id = createConnector(
      doc,
      { kind: 'attached', objectId: from, fallback: { x: 0, y: 0 } },
      target,
      'fixture',
    );
    if (id === null) throw new Error('fixture: could not create a connector');
    return id;
  };

  return {
    doc,
    shapes: {
      start: ids.start!,
      decide: ids.decide!,
      wait: ids.wait!,
      ship: ids.ship!,
    },
    connectors: {
      toDecide: made(ids.start!, ids.decide!),
      toWait: made(ids.decide!, ids.wait!),
      toShip: made(ids.decide!, ids.ship!),
      // An arrow into empty space, so a test has a free-ended one to draw.
      free: made(ids.ship!, { x: 620, y: 220 }),
    },
  };
}

/** A fresh, initialised document holding the checkout flow. */
export function makeCheckoutDoc(): CheckoutFlow {
  const doc = new Y.Doc();
  initDoc(doc);
  return buildCheckoutFlow(doc);
}
