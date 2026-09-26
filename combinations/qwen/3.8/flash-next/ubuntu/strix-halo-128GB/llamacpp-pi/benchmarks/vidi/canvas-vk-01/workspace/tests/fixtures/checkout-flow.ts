import * as Y from 'yjs';

import { initDoc, moveObjects } from '../../src/shared/board-model';
import { createConnector, type Endpoint } from '../../src/shared/objects/connector';
import { createShape } from '../../src/shared/objects/shape';
import { rectCenter } from '../../src/shared/geometry/connector-geometry';
import type { Rect } from '../../src/shared/geometry';
import type { ShapeKind, StrokeColor } from '../../src/shared/config';

/**
 * The flow the story is about, drawn once for every test that needs a board of
 * shapes and arrows instead of an empty one: four labelled shapes in a row,
 * three arrows attached at both ends, and one arrow with a free end.
 *
 * Everything goes through the real model calls, so the stored records are what
 * the tools would have written.
 */

/** A step of the flow: its kind, its text, and where its box starts. */
interface FlowStep {
  name: 'start' | 'inStock' | 'payment' | 'done';
  kind: ShapeKind;
  label: string;
  x: number;
  stroke: StrokeColor;
}

const STEPS: readonly FlowStep[] = [
  { name: 'start', kind: 'rect', label: 'Basket', x: 0, stroke: 'dark' },
  { name: 'inStock', kind: 'diamond', label: 'In stock?', x: 320, stroke: 'orange' },
  { name: 'payment', kind: 'ellipse', label: 'Payment', x: 640, stroke: 'blue' },
  { name: 'done', kind: 'rect', label: 'Order placed', x: 960, stroke: 'green' },
];

/** Every shape in the flow is the same size, so the anchors line up. */
export const FLOW_SHAPE_SIZE = { width: 200, height: 120 } as const;

/** Where the free end of the loose arrow rests (below the diamond). */
export const LOOSE_END_POINT = { x: 420, y: 320 };

export interface CheckoutFlow {
  start: string;
  inStock: string;
  payment: string;
  done: string;
  /** start → inStock, inStock → payment, payment → done, in that order. */
  arrows: [string, string, string];
  /** The arrow whose far end is not attached to anything. */
  looseEnd: string;
}

/**
 * Build the checkout flow in `doc`, which is initialised here so the fixture is
 * usable straight after `new Y.Doc()`. Returns the ids of everything created.
 */
export function seedCheckoutFlow(doc: Y.Doc): CheckoutFlow {
  initDoc(doc);
  const ids: Record<FlowStep['name'], string> = {
    start: '',
    inStock: '',
    payment: '',
    done: '',
  };
  for (const step of STEPS) {
    const id = createShape(
      doc,
      {
        kind: step.kind,
        rect: { x: step.x, y: 0, ...FLOW_SHAPE_SIZE },
        at: { x: step.x, y: 0 },
        square: false,
      },
      'fixture',
    );
    if (id === null) throw new Error(`checkout-flow: refused ${step.name}`);
    const record = doc.getMap('objects').get(id) as unknown as Y.Map<unknown>;
    (record.get('label') as Y.Text).insert(0, step.label);
    ids[step.name] = id;
  }

  const attached = (objectId: string): Endpoint => ({
    kind: 'attached',
    objectId,
    fallback: centre(doc, objectId),
  });

  const pairs: Array<[string, string]> = [
    [ids.start, ids.inStock],
    [ids.inStock, ids.payment],
    [ids.payment, ids.done],
  ];
  const arrows = pairs.map(([from, to]) => {
    const id = createConnector(doc, attached(from), attached(to), 'fixture');
    if (id === null) throw new Error(`checkout-flow: refused arrow ${from} → ${to}`);
    return id;
  }) as [string, string, string];

  // The loose arrow leaves the diamond's bottom edge and points at nothing.
  const looseEnd = createConnector(
    doc,
    attached(ids.inStock),
    { kind: 'free', x: LOOSE_END_POINT.x, y: LOOSE_END_POINT.y },
    'fixture',
  );
  if (looseEnd === null) throw new Error('checkout-flow: refused the loose arrow');

  return { ...ids, arrows, looseEnd };
}

/** The rectangle a fixture object holds, for anchor arithmetic in tests. */
export function flowRect(doc: Y.Doc, id: string): Rect {
  const record = doc.getMap('objects').get(id) as unknown as Y.Map<unknown>;
  return {
    x: record.get('x') as number,
    y: record.get('y') as number,
    width: record.get('width') as number,
    height: record.get('height') as number,
  };
}

const centre = (doc: Y.Doc, id: string): { x: number; y: number } => rectCenter(flowRect(doc, id));

/**
 * Move one shape of the flow (absolute position, as a drag commits it) and
 * return the new box.
 */
export function moveFlowShape(doc: Y.Doc, id: string, x: number, y: number): void {
  moveObjects(doc, new Map([[id, { x, y }]]));
}
