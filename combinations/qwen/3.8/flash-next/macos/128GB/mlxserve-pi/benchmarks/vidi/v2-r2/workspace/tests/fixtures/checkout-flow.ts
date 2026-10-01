// A flow, built the way the board builds one.
//
// Four labelled shapes and the arrows between them - the shape of a real board a
// person would draw: a start, a decision, the thing done, and the follow-up, with
// one arrow left pointing at open board because that is what people do. Every object
// here is made by the same functions the toolbar and the two tools call, so the bytes
// are the bytes a board made by hand produces, and a fixture that invented its own
// could pass a test while a drawn flow did not survive.
//
// The points are chosen inside the band a browser window shows at the default camera
// (about 640 by 400 board units around the board's start point), so a test can seed
// this flow and then click it.

import * as Y from 'yjs';
import { initDoc } from '../../src/shared/board-model';
import type { ShapeKind } from '../../src/shared/config';
import type { Point, Rect } from '../../src/shared/geometry';
import { attachTarget, createConnector, endpointAtDrop } from '../../src/shared/objects/connector';
import { createShape, getShapeLabel } from '../../src/shared/objects/shape';

/** Who made it, in the fixture's own words: it lands in `createdBy`. */
const FLOW_AUTHOR = 'fixture';

/** What the four shapes are, left to right, and what they say. */
export const FLOW_SHAPES: readonly { kind: ShapeKind; label: string; rect: Rect }[] = [
  { kind: 'rect', label: 'Start', rect: { x: -560, y: -240, width: 200, height: 120 } },
  { kind: 'diamond', label: 'Ready to ship?', rect: { x: -240, y: -260, width: 220, height: 160 } },
  { kind: 'ellipse', label: 'Ship it', rect: { x: 100, y: -240, width: 220, height: 120 } },
  { kind: 'rect', label: 'Retro next week', rect: { x: 380, y: -20, width: 240, height: 140 } },
];

/** Where the arrow that points at nothing is let go: board, not a shape. */
export const FLOW_FREE_END: Point = { x: -150, y: 160 };

/** A built flow: the document, its updates, and the ids in it. */
export interface FlowFixture {
  doc: Y.Doc;
  /** Every update the flow was built from, oldest first (what `append` stores). */
  updates: Uint8Array[];
  /** The whole flow as one update, for applying to a live board in a single write. */
  all: Uint8Array;
  /** The four shape ids, left to right, in `FLOW_SHAPES` order. */
  shapes: string[];
  /** The four arrow ids, in the order they were drawn: three between shapes, one free. */
  connectors: string[];
}

/** The board point in the middle of a rectangle. */
const middle = (rect: Rect): Point => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });

/**
 * Build the flow, collecting updates. Each model call is its own transaction, so one
 * object is one update - the unit the room stores - and `all` is what a board that had
 * this flow drawn on it and then reloaded reads back as.
 */
export function checkoutFlow(): FlowFixture {
  const doc = new Y.Doc();
  const updates: Uint8Array[] = [];
  doc.on('update', (update: Uint8Array) => {
    updates.push(update.slice());
  });

  initDoc(doc);

  const shapes: string[] = [];
  for (const shape of FLOW_SHAPES) {
    const id = createShape(doc, { kind: shape.kind, rect: shape.rect, at: middle(shape.rect) }, FLOW_AUTHOR);
    if (id === null) throw new Error(`fixture shape ${shape.kind} was refused by the model`);
    const label = getShapeLabel(doc, id);
    if (label === undefined) throw new Error(`fixture shape ${id} has no label`);
    label.insert(0, shape.label);
    shapes.push(id);
  }

  // An arrow is drawn by dropping its ends: the object under each end, aimed past the
  // object at the other end of the arrow. So the arrows here are drawn by the same
  // maths the Connector tool uses, anchored to the sides that face each other.
  const drop = (from: number, to: number | Point): string | null => {
    const start = middle(FLOW_SHAPES[from]!.rect);
    const finish = typeof to === 'number' ? middle(FLOW_SHAPES[to]!.rect) : to;
    const a = attachTarget(doc, start);
    const b = typeof to === 'number' ? attachTarget(doc, finish) : null;
    return createConnector(
      doc,
      endpointAtDrop(a, start, finish),
      endpointAtDrop(b, finish, start),
      FLOW_AUTHOR,
    );
  };

  const connectors: string[] = [];
  for (const [from, to] of [[0, 1], [1, 2], [2, 3]] as [number, number][]) {
    const id = drop(from, to);
    if (id === null) throw new Error(`fixture arrow ${from} -> ${to} was refused by the model`);
    connectors.push(id);
  }
  // the last arrow is let go over open board: attached to the decision at one end,
  // fixed to a point on the board at the other
  const loose = drop(1, FLOW_FREE_END);
  if (loose === null) throw new Error('fixture arrow to open board was refused by the model');
  connectors.push(loose);

  return { doc, updates, all: Y.encodeStateAsUpdate(doc), shapes, connectors };
}
