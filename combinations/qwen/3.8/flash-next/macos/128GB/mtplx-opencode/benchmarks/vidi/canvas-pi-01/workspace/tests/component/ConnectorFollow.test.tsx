/**
 * Story 10 · task 14/15 — the promise the whole connector design rests on,
 * checked against a real two-document sync: **an arrow follows what it points
 * at, with no writes of its own.**
 *
 * The fixture (four labelled shapes, three attached arrows, one free arrow) is
 * built with the same model calls a person's gestures would make, then the
 * *board* is driven: a shape is moved past its neighbour, a remote peer moves a
 * shape through a real `Y.Doc` update under a non-local origin, a shape is
 * deleted. Each time, what matters is what the arrow is now drawn as — which
 * sides its ends landed on, and whether it survived at all. jsdom lays nothing
 * out, so the geometry is read from the resolved ends the render is given, not
 * from pixels; the pixel-level version of the same story is
 * `tests/e2e/connectors.spec.ts`.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { BoardShell } from '../../src/client/App';
import { deleteObjects, moveObjects, snapshot } from '../../src/shared/board-model';
import { makeCheckoutDoc } from '../fixtures/checkout-flow';
import { createPeer } from '../unit/peer';

const VIEWPORT = { width: 800, height: 600 };

beforeEach(() => {
  cleanup();
});

/** The two drawn ends of one arrow, read from what the component was given. */
function endsOf(doc: Y.Doc, id: string) {
  const snap = snapshot(doc).find((obj) => obj.id === id);
  return snap?.ends ?? null;
}

/**
 * Move one object with story 7's generic API. `moveObject` (singular) is the
 * story-2 sticky-only helper and refuses anything else, so a shape has to go
 * through the map form.
 */
function move(doc: Y.Doc, id: string, x: number, y: number): boolean {
  return moveObjects(doc, new Map([[id, { x, y }]])) === 1;
}

function dataOf(id: string) {
  return (screen.getByTestId(`connector-${id}`) as HTMLElement).dataset as DOMStringMap;
}

describe('Arrows follow the objects they point at', () => {
  // The starting state: every attached arrow draws, and its ends sit on the
  // facing sides of the two shapes.
  it('the checkout fixture renders four shapes and four arrows', () => {
    const board = makeCheckoutDoc();
    render(<BoardShell viewport={VIEWPORT} doc={board.doc} />);

    expect(screen.getAllByTestId('shape-geometry')).toHaveLength(4);
    expect(screen.getAllByTestId('connector-line')).toHaveLength(4);
    expect(dataOf(board.connectors.toDecide).to).toBe(`attached:${board.shapes.decide}`);
    expect(dataOf(board.connectors.toWait).to).toBe(`attached:${board.shapes.wait}`);
    expect(dataOf(board.connectors.free).from).toBe(`attached:${board.shapes.ship}`);
    expect(dataOf(board.connectors.free).to).toBe('free');
  });

  // Moving a shape past its neighbour flips which side each end touches — and
  // writes nothing, because the geometry is derived.
  it('an arrow changes sides when its shape is moved past the other one', () => {
    const board = makeCheckoutDoc();
    const before = endsOf(board.doc, board.connectors.toWait)!;
    expect(before.from.x).toBeLessThan(before.to.x);

    render(<BoardShell viewport={VIEWPORT} doc={board.doc} />);
    const updates: number[] = [];
    board.doc.on('update', (_update: Uint8Array, origin: unknown) => {
      if (origin !== undefined) updates.push(1);
    });

    // Drag the backorder ellipse to the far left of the decision diamond.
    act(() => {
      expect(move(board.doc, board.shapes.wait, -600, -140)).toBe(true);
    });

    const after = endsOf(board.doc, board.connectors.toWait)!;
    // Now the arrow runs the other way: it leaves the diamond's *left* side and
    // lands on the ellipse's *right* side, so it starts right of where it ends.
    expect(after.from.x).toBeGreaterThan(after.to.x);
    expect(after.from.x).toBeLessThan(before.from.x);
    // One transaction (the move). The arrows themselves were never rewritten.
    expect(updates).toHaveLength(1);
  });

  // A remote person's move reaches this board as one Yjs update and repaints
  // every arrow that was pointing at what they moved.
  it('a remote move repaints attached arrows on this screen', () => {
    const board = makeCheckoutDoc();
    const peer = createPeer(board.doc);
    render(<BoardShell viewport={VIEWPORT} doc={board.doc} />);

    const before = endsOf(board.doc, board.connectors.toShip)!;

    // Dana, on another machine, drags "Ship now" above the diamond.
    act(() => {
      peer.change(board.doc, (remote) => {
        move(remote, board.shapes.ship, -400, -320);
      });
    });

    const after = endsOf(board.doc, board.connectors.toShip)!;
    expect(after).not.toEqual(before);
    // Still attached: the end is on a side of the shape, not at a free point.
    expect(dataOf(board.connectors.toShip).to).toBe(`attached:${board.shapes.ship}`);
  });

  // Deleting what an arrow points at leaves the arrow behind, with a free end
  // where that shape's side used to be (PRD connector.target_deleted).
  it('a deleted shape leaves its arrows behind with free ends', () => {
    const board = makeCheckoutDoc();
    const before = endsOf(board.doc, board.connectors.toShip)!;
    render(<BoardShell viewport={VIEWPORT} doc={board.doc} />);

    act(() => {
      expect(deleteObjects(board.doc, [board.shapes.ship])).toBe(1);
    });

    // The arrow is still drawn …
    const el = screen.getByTestId(`connector-${board.connectors.toShip}`) as HTMLElement;
    expect(el.getAttribute('data-to')).toBe('free');
    // … its end sits where the shape's side was, not at its centre …
    const after = endsOf(board.doc, board.connectors.toShip)!;
    expect(Math.abs(after.to.x - before.to.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.to.y - before.to.y)).toBeLessThanOrEqual(1);
    // … and the arrow that started at the deleted shape kept its other end.
    expect(dataOf(board.connectors.free).to).toBe('free');
    expect(endsOf(board.doc, board.connectors.free)).not.toBeNull();
  });
});
