// The checkout flow fixture, rendered: a whole board of shapes and arrows, which
// is the shape of thing a story-10 board is actually used for, and the board the
// fixture (design "Fixtures") exists to hand to tests.
//
// Two things are settled here that a hand-made pair of shapes cannot settle. One is
// that a board built by the model — four labelled shapes, three arrows stuck to
// them, one arrow with an end left in the air — comes out of a document the app
// renders as four shapes and four arrows, with the words in them. The other is that
// when one shape of that flow is dragged, every arrow of the flow goes with it to
// the point its shapes now face, while the end that was left in the air stays in
// the air where it was left.
import { act, cleanup, screen } from '@testing-library/react';
import * as Y from 'yjs';
import type { Doc } from 'yjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readConnector } from '../../src/shared/objects/connector';
import { nearestSide, rectCenter, sideAnchor } from '../../src/shared/geometry/connector-geometry';
import type { ConnectorSide } from '../../src/shared/config';
import type { Rect } from '../../src/shared/geometry';
import { deleteObjects } from '../../src/shared/board-model';
import {
  CHECKOUT_FLOW_SHAPES,
  LOOSE_END_POINT,
  checkoutFlowDoc,
  type CheckoutFlow,
  type CheckoutFlowShape,
} from '../fixtures/checkout-flow';
import { VIEWPORT, dragBy, flushFrame, renderBoard } from './helpers';

const CENTRE = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };

let doc: Doc;
let flow: CheckoutFlow;

/** A fixture shape as the board drew it, in board units. */
function box(name: CheckoutFlowShape): Rect {
  const b = CHECKOUT_FLOW_SHAPES[name];
  return { x: b.x, y: b.y, width: b.width, height: b.height };
}

/** The side of one shape that faces another, and the point in the middle of it. */
function anchorToward(shape: Rect, other: Rect): { side: ConnectorSide; at: { x: number; y: number } } {
  const side = nearestSide(shape, rectCenter(other));
  return { side, at: sideAnchor(shape, side) };
}

/** The middle of a shape, in screen pixels: where a hand would have caught it. */
function screenCentre(name: CheckoutFlowShape): { x: number; y: number } {
  const c = rectCenter(box(name));
  return { x: c.x + CENTRE.x, y: c.y + CENTRE.y };
}

function shapeEl(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-shape-id="${id}"]`);
  if (el === null) throw new Error(`shape ${id} is not rendered`);
  return el;
}

function arrowEls(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-connector-id]'));
}

/** Where an end of an arrow is drawn, in board units, as the page draws it. */
function endAt(id: string, end: 'from' | 'to'): { x: number; y: number; kind: string } {
  const el = document.querySelector<HTMLElement>(`[data-connector-id="${id}"]`);
  if (el === null) throw new Error(`arrow ${id} is not rendered`);
  return {
    x: Number(el.getAttribute(`data-${end}-x`)),
    y: Number(el.getAttribute(`data-${end}-y`)),
    kind: el.getAttribute(`data-${end}-kind`) ?? '',
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  doc = renderBoard();

  // The fixture arrives the way anybody else's work arrives on a board this person
  // is looking at: as a document update from elsewhere, applied and rendered.
  const built = checkoutFlowDoc();
  act(() => {
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(built.doc));
  });
  flow = built.flow;
  flushFrame();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('a board of shapes and arrows, rendered', () => {
  it('TC-23a: draws four labelled shapes and the four arrows of the flow', () => {
    expect(document.querySelectorAll('[data-shape-id]')).toHaveLength(4);
    expect(arrowEls()).toHaveLength(4);

    // The shapes are the kinds they were drawn as, and say what they were labelled.
    for (const name of Object.keys(CHECKOUT_FLOW_SHAPES) as CheckoutFlowShape[]) {
      const spec = CHECKOUT_FLOW_SHAPES[name];
      const el = shapeEl(flow[name]);
      expect(el.getAttribute('data-kind')).toBe(spec.kind);
      expect(el.textContent).toContain(spec.label);
    }
    expect(shapeEl(flow.start).getAttribute('data-kind')).toBe('rect');
    expect(shapeEl(flow.decision).getAttribute('data-kind')).toBe('diamond');
    expect(shapeEl(flow.ship).getAttribute('data-kind')).toBe('ellipse');

    // Three arrows join shapes at both ends; the fourth has one end in the air.
    for (const id of flow.arrows) {
      const ends = readConnector(doc, id);
      expect(ends).not.toBeNull();
      expect(ends!.from.kind).toBe('attached');
      expect(ends!.to.kind).toBe('attached');
      expect(endAt(id, 'from').kind).toBe('attached');
      expect(endAt(id, 'to').kind).toBe('attached');
    }
    expect(endAt(flow.looseEnd, 'from').kind).toBe('attached');
    expect(endAt(flow.looseEnd, 'to').kind).toBe('free');
    expect(endAt(flow.looseEnd, 'to')).toMatchObject({ x: LOOSE_END_POINT.x, y: LOOSE_END_POINT.y });
    // An arrow with both ends attached is not a broken arrow.
    expect(document.querySelector(`[data-connector-id="${flow.arrows[0]}"]`)!.getAttribute('data-detached')).toBe('false');
  });

  it('TC-23b: drags one shape of the flow and every arrow of it goes with the shape', () => {
    // The decision diamond is what everybody rearranges in a flow: it is picked up
    // and put somewhere else. An arrow with an end on it is dragged along; an arrow
    // with both ends elsewhere is not stirred.
    const drag = { dx: 120, dy: 200 };
    const arrowsTouchingDecision = flow.arrows.slice(1); // decision→ship and decision→waitlist
    const before = {
      into: endAt(flow.arrows[0]!, 'to'),
      ship: endAt(arrowsTouchingDecision[0]!, 'from'),
      waitlist: endAt(arrowsTouchingDecision[1]!, 'from'),
      loose: endAt(flow.arrows[0]!, 'from'),
      freeEnd: endAt(flow.looseEnd, 'to'),
    };

    dragBy(shapeEl(flow.decision), drag.dx, drag.dy, screenCentre('decision'));
    flushFrame();

    // The shape moved by exactly the drag.
    const now = { x: CHECKOUT_FLOW_SHAPES.decision.x + drag.dx, y: CHECKOUT_FLOW_SHAPES.decision.y + drag.dy };
    const nowBox: Rect = { x: now.x, y: now.y, width: CHECKOUT_FLOW_SHAPES.decision.width, height: CHECKOUT_FLOW_SHAPES.decision.height };
    const el = shapeEl(flow.decision);
    expect(el.style.left).toBe(`${nowBox.x}px`);

    // Both arrows drawn from it now start at the side of it that faces what they are
    // attached to, which is a different point on the board for each of them.
    const shipBox = box('ship');
    const waitlistBox = box('waitlist');
    expect(endAt(arrowsTouchingDecision[0]!, 'from')).toMatchObject(anchorToward(nowBox, shipBox).at);
    expect(endAt(arrowsTouchingDecision[1]!, 'from')).toMatchObject(anchorToward(nowBox, waitlistBox).at);

    // And the arrow pointing *at* it still ends on the diamond, on whichever side of
    // it the other shape is now on the far side of.
    const startBox = box('start');
    expect(endAt(flow.arrows[0]!, 'to')).toMatchObject(anchorToward(nowBox, startBox).at);
    // Every one of the three is still an arrow attached to a shape at that end.
    for (const id of flow.arrows) {
      expect(endAt(id, 'from').kind).toBe('attached');
      expect(endAt(id, 'to').kind).toBe('attached');
    }

    // The ends that belong to shapes nobody moved are exactly where they were, and so
    // is the one end that was left in the air: following a shape is not dragging the
    // world along with it.
    expect(endAt(flow.arrows[0]!, 'from')).toMatchObject({ x: before.loose.x, y: before.loose.y });
    expect(endAt(flow.looseEnd, 'to')).toMatchObject({ x: before.freeEnd.x, y: before.freeEnd.y });
    expect(Math.abs(before.into.x - endAt(flow.arrows[0]!, 'to').x)).toBeGreaterThan(1);

    // The whole flow is still drawn: four shapes, four arrows, nothing orphaned.
    expect(document.querySelectorAll('[data-shape-id]')).toHaveLength(4);
    expect(arrowEls()).toHaveLength(4);
    expect(document.querySelectorAll('[data-detached="true"]')).toHaveLength(0);
  });

  it('TC-23c: keeps the arrow when the shape it ends at is deleted, ending where that side was', () => {
    // Somebody clears the ship shape away. The arrow that ran into it is not cleared
    // with it: an arrow is a thing in its own right. And it does not jump — the end
    // that was stuck to the shape is put down as a point on the board, at the middle
    // of the side of the shape it was drawn to, which is where it was already drawn.
    const lastSide = anchorToward(box('ship'), box('decision'));
    const arrow = flow.arrows[1]!;
    const before = endAt(arrow, 'to');
    const beforeFrom = endAt(arrow, 'from');

    act(() => {
      deleteObjects(doc, [flow.ship]);
    });
    flushFrame();

    expect(document.querySelectorAll('[data-shape-id]')).toHaveLength(3);
    expect(arrowEls()).toHaveLength(4);
    const el = document.querySelector<HTMLElement>(`[data-connector-id="${arrow}"]`)!;
    expect(el).not.toBeNull();
    // The end is a point in the board now, at the point the arrow was being drawn to.
    expect(endAt(arrow, 'to')).toMatchObject({ x: lastSide.at.x, y: lastSide.at.y });
    expect(endAt(arrow, 'to').kind).toBe('free');
    expect(endAt(arrow, 'to')).toMatchObject({ x: before.x, y: before.y });
    // Nothing about that arrow is left pointing at something that is not there, which
    // is why it is drawn as an ordinary arrow rather than a stranded one: the board
    // puts such an end down as a point when the shape goes (design: "the transaction
    // that deletes an object also turns the ends attached to it into free points"),
    // and only an end that was never told — a delete that arrived from elsewhere while
    // somebody was drawing, which the browser tests settle — is left as an orphan.
    expect(el.getAttribute('data-detached')).toBe('false');
    // The end that is still stuck to the diamond is still stuck to it, and the diamond
    // has not been stirred by losing a neighbour.
    expect(endAt(arrow, 'from').kind).toBe('attached');
    expect(endAt(arrow, 'from')).toMatchObject({ x: beforeFrom.x, y: beforeFrom.y });
    expect(shapeEl(flow.decision).style.left).toBe(`${CHECKOUT_FLOW_SHAPES.decision.x}px`);
    // Two shapes of the flow lost a connection but the flow is still drawn.
    expect(screen.getAllByTestId('connector-object')).toHaveLength(4);
  });
});
