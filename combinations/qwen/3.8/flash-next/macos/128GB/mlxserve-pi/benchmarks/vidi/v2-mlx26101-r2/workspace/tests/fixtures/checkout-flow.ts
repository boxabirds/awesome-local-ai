/**
 * A flow on the board, for the story about shapes and arrows.
 *
 * Four labelled shapes and four arrows - three of them joined to shapes at both ends,
 * one of them joined at one end and fixed to a point of board at the other - which is
 * the smallest board that can show every thing an arrow does: it follows an object it
 * is joined to, it does not follow one it is not, and when the object it is joined to
 * goes away it keeps the position it had.
 *
 * The content is written with the app's own model functions - the ones behind the Shape
 * tool and the Connector tool - rather than by building `objects` maps by hand. The
 * calls happen in the page, through the test hook, because the document a board has is
 * the page's own (`tests/fixtures/boards.ts` is the same idea for a board that is being
 * seeded into storage rather than drawn on screen, and for the same reason). What comes
 * back is the ids, in the order they were made, because everything a test wants to say
 * about an arrow is about *this* arrow.
 *
 * The board units are chosen so the whole flow is on screen at the standard view of the
 * e2e viewport (1280 x 800 at 100%, origin in the middle): nothing here needs the camera
 * moved to be seen, and a test that has to pan before it can click is a test that is
 * testing the pan.
 */

import { expect, type Page } from '@playwright/test';

import type { Rect } from '../../src/shared/geometry.js';
import {
  EVENTUALLY,
  addConnector,
  addShape,
  connectorElements,
  docConnectors,
  docShapes,
  shapeElements,
} from '../e2e/helpers/shapes.js';

/** Who made each thing, as the document records it. Nobody in this build has a name. */
const DANA = 'dana';

/** The four shapes: three of the three kinds, with the rectangle twice because flows need boxes. */
export interface FlowShape {
  kind: 'rect' | 'diamond' | 'ellipse';
  label: string;
  rect: Rect;
  fill?: string;
  stroke?: string;
}

export const CHECKOUT_FLOW_SHAPES: FlowShape[] = [
  { kind: 'rect', label: 'Add to cart', rect: { x: -560, y: -230, width: 200, height: 120 } },
  {
    kind: 'diamond',
    label: 'In stock?',
    rect: { x: -220, y: -230, width: 200, height: 120 },
    fill: 'yellow',
  },
  {
    kind: 'ellipse',
    label: 'Checkout',
    rect: { x: 140, y: -230, width: 220, height: 120 },
    fill: 'green',
    stroke: 'dark',
  },
  {
    kind: 'rect',
    label: 'Payment failed',
    rect: { x: -220, y: 40, width: 200, height: 120 },
    stroke: 'red',
  },
];

/** The arrows: three between shapes, one from a point of board into a shape. */
export const CHECKOUT_FLOW_CONNECTORS: { from: { shape: number } | { x: number; y: number }; to: { shape: number } | { x: number; y: number } }[] =
  [
    { from: { shape: 0 }, to: { shape: 1 } },
    { from: { shape: 1 }, to: { shape: 2 } },
    // The diamond's answer: the arrow that goes down to the failure.
    { from: { shape: 1 }, to: { shape: 3 } },
    // One end joined, one end a point of board: this is the arrow that does not follow
    // anything on one side, and the one that proves a free end stays where it was put.
    { from: { x: -560, y: 200 }, to: { shape: 0 } },
  ];

/** What a built flow is: the ids, in the order they were written. */
export interface CheckoutFlow {
  /** Shape ids, in the order of `CHECKOUT_FLOW_SHAPES`. */
  shapes: string[];
  /** Connector ids, in the order of `CHECKOUT_FLOW_CONNECTORS`. */
  connectors: string[];
}

/**
 * Put the flow on this page's board.
 *
 * The shapes first and the arrows after, because an arrow asks the document what its
 * objects look like when it is written and has to be answered with something. Returns
 * the ids; a test that wants them on *another* page waits with {@link waitForFlow}.
 */
export async function drawCheckoutFlow(page: Page): Promise<CheckoutFlow> {
  const shapes: string[] = [];
  for (const shape of CHECKOUT_FLOW_SHAPES) {
    shapes.push(await addShape(page, { ...shape, by: DANA }));
  }
  const connectors: string[] = [];
  for (const connector of CHECKOUT_FLOW_CONNECTORS) {
    connectors.push(await addConnector(page, connector.from, connector.to, DANA, shapes));
  }
  await waitForFlow(page, { shapes, connectors });
  return { shapes, connectors };
}

/**
 * Wait until this page holds the whole flow: these shapes and these arrows, drawn.
 * By id rather than by count, because a page that holds four shapes of some other
 * board would pass a count and is not holding this flow.
 */
export async function waitForFlow(page: Page, flow: CheckoutFlow): Promise<void> {
  await expect
    .poll(() => docShapes(page).then((list) => list.filter((one) => flow.shapes.includes(one.id)).length), {
      message: 'the fixture shapes have not arrived',
      timeout: EVENTUALLY.timeout,
    })
    .toBe(flow.shapes.length);
  await expect
    .poll(
      () => docConnectors(page).then((list) => list.filter((one) => flow.connectors.includes(one.id)).length),
      { message: 'the fixture arrows have not arrived', timeout: EVENTUALLY.timeout },
    )
    .toBe(flow.connectors.length);
  // And drawn, not only stored: a change that arrived is a change shown.
  await expect(shapeElements(page)).toHaveCount(CHECKOUT_FLOW_SHAPES.length);
  await expect(connectorElements(page)).toHaveCount(CHECKOUT_FLOW_CONNECTORS.length);
}

/**
 * The same flow, told from the outside: how many of each a board of this fixture holds.
 * A test that counts objects rather than ids can use these.
 */
export const FLOW_SHAPE_COUNT = CHECKOUT_FLOW_SHAPES.length;
export const FLOW_CONNECTOR_COUNT = CHECKOUT_FLOW_CONNECTORS.length;
