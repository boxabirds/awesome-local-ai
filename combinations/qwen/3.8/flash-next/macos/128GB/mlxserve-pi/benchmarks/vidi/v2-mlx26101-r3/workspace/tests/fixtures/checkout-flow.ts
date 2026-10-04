import * as Y from 'yjs';
import { LOCAL_ORIGIN, snapshot } from '../../src/shared/board-model';
import {
  createShape,
  getShapeLabel,
} from '../../src/shared/objects/shape';
import { createConnector } from '../../src/shared/objects/connector';
import type { ShapeKind } from '../../src/shared/config';
import type { Endpoint } from '../../src/shared/geometry/connector-geometry';

/**
 * A board with a flow on it, built by the same functions the product uses.
 *
 * Story 10's end-to-end tests need a board that already has shapes and arrows on it: a test about an
 * arrow following a shape that somebody else moved cannot be about an arrow the test itself drew two
 * milliseconds earlier, and a test about a board that lost a shape would spend most of its time
 * drawing shapes. This is that board, and it is built with `createShape`, the label's `Y.Text` and
 * `createConnector` rather than poured in as bytes, because a fixture that writes the board the way
 * the client writes it is a fixture that goes through the room, into storage, and back out again.
 *
 * The flow is a real one, from a real retro: what happens when a card is declined at checkout. Four
 * shapes of three kinds, three arrows between them, and one arrow with a free end - because a flow
 * nobody has finished drawing is the common case, and because the free end is the case that has to
 * survive the deletion of a shape next to it.
 *
 * Nothing here asserts. It hands back ids, which are given to the objects when they are made and are
 * not chosen here, and a test compares what a page draws against them.
 */

/** The four shapes, named by what they are for rather than by their order. */
export type FlowShapeName = 'cart' | 'declined' | 'reason' | 'receipt';

/** The four arrows, named by what they join. */
export type FlowConnectorName = 'toAsk' | 'approved' | 'declinedAgain' | 'unfinished';

/** A shape as the fixture lays it out: where it is, what kind it is, what it says. */
export interface FlowShapeSeed {
  readonly name: FlowShapeName;
  readonly kind: ShapeKind;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly label: string;
}

/** An arrow as the fixture lays it out. One of them is fastened to nothing at one end. */
export interface FlowConnectorSeed {
  readonly name: FlowConnectorName;
  readonly from: FlowShapeName;
  /** Another shape, or a point on the board: the arrow that has not been finished. */
  readonly to: FlowShapeName | { x: number; y: number };
}

/**
 * The shapes, laid out where the default view of the board can see all four.
 *
 * The board opens on the world's origin at the middle of a 1280x800 viewport, so these sit within
 * roughly a screen of it: a test that had to move the camera before it could see the fixture would be
 * a test that measured the camera. Three kinds are used because the sides an arrow fastens to are the
 * sides of the *box*, and a diamond and an ellipse have to be shown taking an arrow on their boundary
 * rather than on their outline.
 */
export const CHECKOUT_FLOW_SHAPES: readonly FlowShapeSeed[] = [
  {
    name: 'cart',
    kind: 'rect',
    x: -560,
    y: -200,
    width: 200,
    height: 120,
    label: 'Cart has three items',
  },
  {
    name: 'declined',
    kind: 'diamond',
    x: -240,
    y: -200,
    width: 200,
    height: 120,
    label: 'Was the card declined?',
  },
  {
    name: 'reason',
    kind: 'ellipse',
    x: 120,
    y: -200,
    width: 200,
    height: 120,
    label: 'Show the reason on the same screen',
  },
  {
    name: 'receipt',
    kind: 'rect',
    x: -240,
    y: 40,
    width: 200,
    height: 120,
    label: 'Email the receipt within a minute',
  },
];

/** Where the unfinished arrow's free end is left, in board units. */
export const UNFINISHED_END = { x: 200, y: 280 };

/** Three arrows between the shapes, and one that stops short of anywhere. */
export const CHECKOUT_FLOW_CONNECTORS: readonly FlowConnectorSeed[] = [
  { name: 'toAsk', from: 'cart', to: 'declined' },
  { name: 'approved', from: 'declined', to: 'reason' },
  { name: 'declinedAgain', from: 'declined', to: 'receipt' },
  { name: 'unfinished', from: 'receipt', to: UNFINISHED_END },
];

/** The objects of the flow, by name. */
export interface FlowIds {
  readonly shapes: Record<FlowShapeName, string>;
  readonly connectors: Record<FlowConnectorName, string>;
}

/** One edit of the fixture: what one person's action would have written. */
export interface FlowEdit {
  /** What this edit puts on the board, for the message of the wait that uses it. */
  readonly what: string;
  apply(doc: Y.Doc): void;
}

/** The centre of a shape of the fixture, which is where an arrow is fastened to it. */
export function shapeCentre(name: FlowShapeName): { x: number; y: number } {
  const seed = CHECKOUT_FLOW_SHAPES.find((candidate) => candidate.name === name);
  if (seed === undefined) {
    throw new Error(`the flow has no shape called ${name}`);
  }
  return { x: seed.x + seed.width / 2, y: seed.y + seed.height / 2 };
}

/** The box of a shape of the fixture. */
export function shapeBox(name: FlowShapeName): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const seed = CHECKOUT_FLOW_SHAPES.find((candidate) => candidate.name === name);
  if (seed === undefined) {
    throw new Error(`the flow has no shape called ${name}`);
  }
  return { x: seed.x, y: seed.y, width: seed.width, height: seed.height };
}

/**
 * The fixture as separate edits, in the order a person would have made them.
 *
 * One edit per object, shape and label together, arrow by arrow: a fixture written as one big
 * transaction would be a board that arrived in the room's log as a single row, which no board that a
 * person made ever is - and story 4's tests are about what happens when a row goes missing.
 *
 * The ids the edits give the objects go into `ids`, which is why this takes one rather than returning
 * a list of objects it could not have named in advance: an object's id is decided when it is made. A
 * test that seeds a board from outside the browser runs these same edits over a socket and then reads
 * the ids back out of the same object, which is how it learns which arrow is which.
 */
export function checkoutFlowEdits(ids: FlowIds = emptyFlowIds()): FlowEdit[] {
  const edits: FlowEdit[] = [];
  for (const seed of CHECKOUT_FLOW_SHAPES) {
    edits.push({
      what: `${seed.kind} ${seed.name}`,
      apply: (doc) => {
        // Shape and label in one transaction, the way a drawn shape with a word in it arrives: one
        // update, so a board that was left half-drawn is a shape with no label rather than a shape
        // with half a label.
        Y.transact(
          doc,
          () => {
            const id = createShape(
              doc,
              {
                kind: seed.kind,
                rect: { x: seed.x, y: seed.y, width: seed.width, height: seed.height },
                at: { x: seed.x, y: seed.y },
              },
              WRITER,
            );
            if (id === null) {
              throw new Error(`the board refused the fixture's ${seed.name} shape`);
            }
            ids.shapes[seed.name] = id;
            getShapeLabel(doc, id)?.insert(0, seed.label);
          },
          LOCAL_ORIGIN,
        );
      },
    });
  }
  for (const seed of CHECKOUT_FLOW_CONNECTORS) {
    edits.push({
      what: `arrow ${seed.name}`,
      apply: (doc) => {
        const from = ids.shapes[seed.from];
        if (from === undefined) {
          throw new Error(`the arrow ${seed.name} was asked to run before its shape was made`);
        }
        // Where the far end goes: another shape's side, or a point on the board.
        let to: Endpoint;
        if (typeof seed.to === 'string') {
          const target = ids.shapes[seed.to];
          if (target === undefined) {
            throw new Error(`the arrow ${seed.name} was asked to end before its shape was made`);
          }
          to = { kind: 'attached', objectId: target, fallback: shapeCentre(seed.to) };
        } else {
          // The unfinished one: fastened to the receipt at one end and to a point on the board at the
          // other, which is what an arrow someone stopped drawing looks like.
          to = { kind: 'free', x: seed.to.x, y: seed.to.y };
        }
        const id = createConnector(
          doc,
          { kind: 'attached', objectId: from, fallback: shapeCentre(seed.from) },
          to,
          WRITER,
        );
        if (id === null) {
          throw new Error(`the board refused the fixture's ${seed.name} arrow`);
        }
        ids.connectors[seed.name] = id;
      },
    });
  }
  return edits;
}

/** Who the fixture is said to be: the person who drew this board before the test arrived. */
const WRITER = 'retro-facilitator';

/** An empty set of names, for the caller that has not run any of the edits yet. */
export function emptyFlowIds(): FlowIds {
  return { shapes: {} as Record<FlowShapeName, string>, connectors: {} as Record<FlowConnectorName, string> };
}

/**
 * Put the whole flow on a document, and say what the board called the objects.
 *
 * The ids come from the board, which is why this returns them rather than taking them: a test that
 * invented ids would be comparing a page against a list of strings that had nothing to do with what
 * the page was drawing.
 */
export function buildCheckoutFlow(doc: Y.Doc): FlowIds {
  const ids = emptyFlowIds();
  for (const edit of checkoutFlowEdits(ids)) {
    edit.apply(doc);
  }
  // Every name has to have been filled in: a flow with a shape missing is not the fixture, and would
  // leave the next test pressing on a board where it expected an arrow.
  for (const [name, id] of Object.entries(ids.shapes) as [FlowShapeName, string][]) {
    if (id === undefined || id === '') {
      throw new Error(`the fixture made no ${name} shape`);
    }
  }
  for (const [name, id] of Object.entries(ids.connectors) as [FlowConnectorName, string][]) {
    if (id === undefined || id === '') {
      throw new Error(`the fixture made no ${name} arrow`);
    }
  }
  return ids;
}

/** Whose edits these are, for a test that wants to know who drew the board it arrived on. */
export const FLOW_WRITER = WRITER;

/** The flow as the board has it: every object on it, in draw order. */
export function flowObjects(doc: Y.Doc) {
  return snapshot(doc);
}
