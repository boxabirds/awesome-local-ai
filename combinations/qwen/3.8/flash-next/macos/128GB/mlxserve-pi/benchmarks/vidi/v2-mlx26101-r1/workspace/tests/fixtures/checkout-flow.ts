// A flow, for the tests that need more than one shape and one arrow.
//
// Four labelled shapes in a row — a basket, a decision, a payment, a receipt — with three
// arrows joining each to the next and a fourth arrow that leaves the first shape and ends as a
// point on the board. It is built with the model calls the interface itself makes
// (`createShape`, `createConnector`, the editor's own label write), so the board that arrives is
// a board a person could have drawn: it propagates, renders, selects, moves and deletes exactly
// the way anything drawn by hand does, and it is the same four shapes and four arrows in every
// test that uses it.
//
// The free-ended arrow is the reason this fixture is not just four joins: an arrow with one end
// a point on the board is what an arrow *becomes* when the object it pointed at is deleted, so a
// flow that already contains one can be asked whether a delete left the arrows that had nothing
// to do with it alone.
//
// The places are world units, and the board starts with world 0,0 in the middle of its window at
// 100%, so this whole flow is on screen when a board opens and every point in it is a point a
// mouse can be put on.

import type { Page } from '@playwright/test';
import type { Point } from '../../src/shared/geometry';
import type { ShapeKind } from '../../src/shared/objects/shape';

/** One shape of the flow: what kind it is, what it is called, and where its centre is. */
export interface FlowShape {
  kind: ShapeKind;
  label: string;
  at: Point;
}

/** The four shapes, left to right, in the order they are drawn. */
export const FLOW_SHAPES: readonly FlowShape[] = [
  { kind: 'rect', label: 'Basket', at: { x: -540, y: -60 } },
  { kind: 'diamond', label: 'Card details ok?', at: { x: -180, y: -60 } },
  { kind: 'ellipse', label: 'Payment', at: { x: 180, y: -60 } },
  { kind: 'rect', label: 'Receipt', at: { x: 540, y: -60 } },
];

/** Which shapes the joined arrows go between, by position in `FLOW_SHAPES`. */
export const FLOW_JOINS: readonly [number, number][] = [
  [0, 1],
  [1, 2],
  [2, 3],
];

/** The free end of the arrow that has one: a point on the board under the first shape. */
export const FLOW_FREE_END: Point = { x: -540, y: 220 };

/** The flow as it is on a board: four shapes, then four arrows, in the order above. */
export interface Flow {
  /** Shape ids, in the order of `FLOW_SHAPES`. */
  shapes: string[];
  /** The three joined arrows, in the order of `FLOW_JOINS`. */
  arrows: string[];
  /** The arrow whose far end is a point on the board rather than an object. */
  freeArrow: string;
}

/** What the flow looks like once it is on a board: four of each. */
export const FLOW_SHAPE_COUNT = FLOW_SHAPES.length;
export const FLOW_ARROW_COUNT = FLOW_JOINS.length + 1;

/**
 * Put the flow on the page's board, and wait until the page has it. The writes go through the
 * live document, so they reach everybody else on the board the way any other write does.
 */
export async function seedFlow(page: Page): Promise<Flow> {
  const flow = await page.evaluate(
    (layout) => {
      const api = window.__vidi6TestBoard;
      if (!api) throw new Error('board test handle missing');
      const shapes = layout.shapes.map((shape) => {
        const id = api.createShape(shape.at, shape.kind);
        if (id === null) throw new Error('the model refused a shape the flow asks for');
        api.writeShape(id, shape.label);
        return id;
      });
      const arrows = layout.joins.map(([from, to]) => {
        const id = api.connect(shapes[from]!, shapes[to]!);
        if (id === null) throw new Error('the model refused an arrow the flow asks for');
        return id;
      });
      const freeArrow = api.connectToPoint(shapes[0]!, layout.freeEnd);
      if (freeArrow === null) throw new Error('the model refused the free-ended arrow');
      return { shapes, arrows, freeArrow };
    },
    { shapes: FLOW_SHAPES, joins: FLOW_JOINS, freeEnd: FLOW_FREE_END },
  );
  await waitForFlow(page);
  return flow;
}

/**
 * Wait until this page's board holds the whole flow.
 *
 * Every write of the flow is its own transaction, so it travels to the other screens as
 * several updates that arrive one after another: a page can hold three of the four shapes, or
 * all four shapes and two of the four arrows. A test that reads such a page as if it were the
 * whole flow reads a board that is on its way, not a board that is there — so anything that is
 * going to compare a flow across screens, or write on top of a flow somebody else seeded,
 * waits here first.
 */
export async function waitForFlow(page: Page): Promise<void> {
  await page.waitForFunction(
    (counts) => {
      const api = window.__vidi6TestBoard;
      if (!api) return false;
      return (
        api.shapes().length === counts.shapes && api.connectors().length === counts.arrows
      );
    },
    { shapes: FLOW_SHAPE_COUNT, arrows: FLOW_ARROW_COUNT },
  );
}
