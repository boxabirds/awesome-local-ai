/**
 * Connecting two things with an arrow (`tests/component/Connector.test.tsx`).
 *
 * `connector.ui` from the pointer's side: the four dots that say where an arrow can
 * join, the drag that picks one of them, the arrow that then belongs to both objects
 * rather than to the pixels it was drawn on, and the handle that moves an end to
 * another object. The document is the judge in every case, because an arrow that is
 * right on this screen and wrong in the document is wrong.
 *
 * One case cannot be done the way a browser would do it, and says so where it stands:
 * whether a click six pixels from a line counts as hitting the line is decided by the
 * browser's own hit-testing of a stroke as wide as the tolerance, and jsdom lays out
 * nothing. What is checked there is the number the DOM carries and the hit test the
 * board itself runs, which are the same rule in the two places it is used.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  clickBoard,
  clickTool,
  connectorData,
  connectorDots,
  connectorEnds,
  connectorHandleElements,
  connectorHitElement,
  connectorPreview,
  connectors,
  dragConnectorHandleToEnd,
  highlightedDot,
  pointerDown,
  pointerMove,
  pointerUp,
  pressedTool,
  renderBoard,
  screenOf,
  selectedObjectIds,
  setZoom,
  shapeData,
  shapeId,
  shapeScreenCentre,
  shapes,
  toolSurface,
  toolSurfaceExists,
  worldOfScreen,
} from './helpers.js';

import { CONNECTOR_HIT_TOLERANCE_PX } from '../../src/shared/config.js';
import { objectBounds } from '../../src/shared/board-model.js';
import type { Point } from '../../src/shared/geometry.js';
import type { ShapeSnap } from '../../src/shared/objects/shape.js';
import { sideMiddles } from '../../src/shared/geometry/connector-geometry.js';
import { connectorHitTest } from '../../src/client/objects/registry.js';

beforeEach(() => {
  renderBoard();
});

/** Draw a shape with the Shape tool, entering the tool first if it is not up. */
function draw(from: { x: number; y: number }, to: { x: number; y: number }): void {
  if (pressedTool() !== 'shape') clickTool('shape');
  pointerDown(from, toolSurface('shape'));
  pointerMove({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, toolSurface('shape'));
  pointerUp(to, toolSurface('shape'));
}

/** The three shapes the story's example connects: A on the left, B right, C below. */
function threeShapes(): string[] {
  draw({ x: 200, y: 300 }, { x: 320, y: 400 });
  draw({ x: 600, y: 300 }, { x: 760, y: 420 });
  draw({ x: 880, y: 500 }, { x: 1000, y: 600 });
  return [shapeId(0), shapeId(1), shapeId(2)];
}

/** The connector tool, up and ready. */
function connectorTool(): void {
  clickTool('connector');
  expect(pressedTool()).toBe('connector');
}

/** The centre of a dot, in screen pixels, as the tool placed it. */
function dotCentre(dot: HTMLElement): { x: number; y: number } {
  const radius = parseFloat(dot.style.width) / 2;
  return { x: parseFloat(dot.style.left) + radius, y: parseFloat(dot.style.top) + radius };
}

describe('connector.ui: the dots that say where an arrow joins', () => {
  it('TC-18 shows four dots at the side midpoints of the shape being hovered', () => {
    const [a] = threeShapes();
    connectorTool();

    pointerMove(shapeScreenCentre(0), toolSurface('connector'));

    const dots = connectorDots(a!);
    expect(dots).toHaveLength(4);
    const rect = objectBounds(shapeData(0));
    const middles = sideMiddles(rect);
    expect(middles.map((middle) => middle.side).sort()).toEqual(['bottom', 'left', 'right', 'top']);
    // Every dot sits on a side midpoint of that shape, and on no other point: the
    // four places an arrow can join are the four sides, not the four corners.
    for (const dot of dots) {
      const centre = dotCentre(dot);
      const matched = middles.filter((middle) => {
        const at = screenOf(middle);
        return Math.abs(at.x - centre.x) < 0.5 && Math.abs(at.y - centre.y) < 0.5;
      });
      expect(matched).toHaveLength(1);
    }
    // One shape's dots at a time: the board does not show twelve dots and hope.
    expect(connectorDots()).toHaveLength(4);
    expect(highlightedDot(a!)).toBeNull();
  });

  it('TC-18b shows nothing over empty board, so the dots mean an object', () => {
    threeShapes();
    connectorTool();

    // A point of board with no shape under it.
    pointerMove({ x: 60, y: 700 }, toolSurface('connector'));

    expect(connectorDots()).toHaveLength(0);
  });

  it('TC-19 highlights the side the arrow will use, and joins the two shapes', () => {
    const [a, b] = threeShapes();
    connectorTool();

    // From A's centre into B, near the edge the arrow comes to.
    pointerDown(shapeScreenCentre(0), toolSurface('connector'));
    const into = screenOf({
      x: objectBounds(shapeData(1)).x + 20,
      y: objectBounds(shapeData(1)).y + objectBounds(shapeData(1)).height / 2,
    });
    pointerMove(into, toolSurface('connector'));

    // B's four dots are out, and exactly one is the one the arrow will join.
    expect(connectorDots(b!)).toHaveLength(4);
    expect(connectorDots(a!)).toHaveLength(0);
    const chosen = highlightedDot(b!);
    expect(chosen).not.toBeNull();
    const left = sideMiddles(objectBounds(shapeData(1))).find((middle) => middle.side === 'left')!;
    expect(dotCentre(chosen!)).toEqual(screenOf(left));
    // The arrow being drawn is a preview: nothing in the document yet.
    expect(connectors()).toHaveLength(0);
    expect(connectorPreview()).not.toBeNull();

    pointerUp(shapeScreenCentre(1), toolSurface('connector'));

    const arrow = connectorData(0);
    expect(arrow.from).toMatchObject({ kind: 'attached', objectId: a });
    expect(arrow.to).toMatchObject({ kind: 'attached', objectId: b });
    // The new arrow is the selection, and the pointer is back to Select.
    expect(selectedObjectIds()).toEqual([arrow.id]);
    expect(pressedTool()).toBe('select');
    expect(toolSurfaceExists('connector')).toBe(false);
  });

  it('TC-19b refuses an arrow from a shape to itself, and leaves the tool where it was', () => {
    threeShapes();
    const selection = selectedObjectIds();
    connectorTool();

    // The same shape at both ends: an arrow that goes nowhere.
    pointerDown(shapeScreenCentre(0), toolSurface('connector'));
    pointerUp({ x: shapeScreenCentre(0).x + 20, y: shapeScreenCentre(0).y + 10 }, toolSurface('connector'));

    expect(connectors()).toHaveLength(0);
    // Nothing was created, so the selection did not move and the tool is still up:
    // the person is still holding the arrow they were drawing.
    expect(pressedTool()).toBe('connector');
    expect(selectedObjectIds()).toEqual(selection);
  });

  it('TC-19c leaves a free end in the board where it was let go', () => {
    const [a] = threeShapes();
    connectorTool();

    const release = { x: 520, y: 640 };
    pointerDown(shapeScreenCentre(0), toolSurface('connector'));
    pointerUp(release, toolSurface('connector'));

    const arrow = connectorData(0);
    expect(arrow.from).toMatchObject({ kind: 'attached', objectId: a });
    expect(arrow.to.kind).toBe('free');
    if (arrow.to.kind === 'free') {
      expect(arrow.to.x).toBeCloseTo(worldOfScreen(release).x, 3);
      expect(arrow.to.y).toBeCloseTo(worldOfScreen(release).y, 3);
    }
  });
});

describe('connector.ui: how close a click has to come to an arrow', () => {
  /**
   * An arrow between two points of bare board, so the arrow is drawn where the drag
   * went and not where two objects happen to face each other.
   */
  function drawFreeArrow(): string {
    connectorTool();
    pointerDown({ x: 300, y: 300 }, toolSurface('connector'));
    pointerMove({ x: 500, y: 420 }, toolSurface('connector'));
    pointerUp({ x: 700, y: 540 }, toolSurface('connector'));
    return connectorData(0).id;
  }

  /**
   * A board point `pixels` screen pixels away from the arrow's line, at right angles
   * to it. Screen pixels is the unit the rule is written in, so the test converts to
   * board units the only way that is honest about it: divided by the zoom.
   */
  function offsetFromLine(zoom: number, pixels: number): { x: number; y: number } {
    const ends = connectorEnds(0);
    const dx = ends.to.x - ends.from.x;
    const dy = ends.to.y - ends.from.y;
    const length = Math.hypot(dx, dy);
    // A perpendicular of `pixels / zoom` board units is `pixels` on the screen.
    const reach = pixels / zoom;
    return {
      x: (ends.from.x + ends.to.x) / 2 - (dy / length) * reach,
      y: (ends.from.y + ends.to.y) / 2 + (dx / length) * reach,
    };
  }

  for (const zoom of [0.5, 2]) {
    it(`TC-20 selects an arrow clicked 5 px from its line at ${zoom * 100}% and not one at 7 px`, () => {
      setZoom(zoom);
      const id = drawFreeArrow();

      // The board's own hit test: the tolerance is in screen pixels, so it is the
      // same distance at 50% as at 200%, in pixels.
      expect(connectorHitTest(connectorData(0), offsetFromLine(zoom, 5), zoom)).toBe(true);
      expect(connectorHitTest(connectorData(0), offsetFromLine(zoom, 7), zoom)).toBe(false);
      expect(connectorHitTest(connectorData(0), connectorEnds(0).to, zoom)).toBe(true);

      // The same rule as the DOM carries it: the stroke that answers the pointer is
      // twice the tolerance wide in board units, which is 12 pixels on the screen at
      // every zoom - a hit area that grew with the board would be a different rule.
      const stroke = Number(connectorHitElement(0).getAttribute('stroke-width'));
      expect(stroke).toBeCloseTo((2 * CONNECTOR_HIT_TOLERANCE_PX) / zoom, 6);

      // And the click that lands on the line selects the arrow.
      clickBoard();
      expect(selectedObjectIds()).toEqual([]);
      const on = screenOf(connectorEnds(0).to);
      pointerDown(on, connectorHitElement(0));
      pointerUp(on, connectorHitElement(0));
      expect(selectedObjectIds()).toEqual([id]);
    });
  }
});

describe('connector.ui: moving one end of an arrow somewhere else', () => {
  it('TC-21 takes an end to the shape it is dropped on, and to no shape at all when dropped on board', () => {
    threeShapes();
    const [a, b, c] = [shapeId(0), shapeId(1), shapeId(2)];
    // An arrow from A to B, which the tool leaves selected.
    connectorTool();
    pointerDown(shapeScreenCentre(1), toolSurface('connector'));
    pointerUp(shapeScreenCentre(2), toolSurface('connector'));
    // The arrow just drawn runs B to C; the two drags below move its far end.
    const arrow = connectorData(0);
    expect(arrow.from).toMatchObject({ kind: 'attached', objectId: b });
    expect(arrow.to).toMatchObject({ kind: 'attached', objectId: c });

    // Drop the far end on A: it joins A.
    dragConnectorHandleToEnd('to', shapeScreenCentre(0));
    expect(connectorData(0).to).toMatchObject({ kind: 'attached', objectId: a });
    // The arrow is still the thing that is selected, so its handles are still out.
    expect(selectedObjectIds()).toEqual([arrow.id]);
    expect(connectorHandleElements()).toHaveLength(2);

    // Drop the same end on bare board: it is fixed to that point and stays there.
    const release = { x: 420, y: 220 };
    dragConnectorHandleToEnd('to', release);
    const moved = connectorData(0).to;
    expect(moved.kind).toBe('free');
    if (moved.kind === 'free') {
      expect(moved.x).toBeCloseTo(worldOfScreen(release).x, 3);
      expect(moved.y).toBeCloseTo(worldOfScreen(release).y, 3);
    }
    // The end that was not dragged was not touched.
    expect(connectorData(0).from).toMatchObject({ kind: 'attached', objectId: b });
  });

  it('TC-21b refuses to join an arrow to the object its other end is on', () => {
    threeShapes();
    connectorTool();
    pointerDown(shapeScreenCentre(1), toolSurface('connector'));
    pointerUp(shapeScreenCentre(2), toolSurface('connector'));
    const before = connectorData(0);

    // Drag the far end onto the object the near end is already attached to: the
    // handle goes back where it came from and the arrow is as it was.
    dragConnectorHandleToEnd('to', shapeScreenCentre(1));

    const after = connectorData(0);
    expect(after.from).toEqual(before.from);
    expect(after.to).toEqual(before.to);
  });

  it('TC-21c moves with the shapes it joins and is not itself written to', () => {
    threeShapes();
    const b = shapeId(1);
    const c = shapeId(2);
    connectorTool();
    pointerDown(shapeScreenCentre(1), toolSurface('connector'));
    pointerUp(shapeScreenCentre(2), toolSurface('connector'));
    const arrow = connectorData(0);
    // The arrow is drawn between the two shapes' facing sides.
    const before = connectorEnds(0);
    const bBefore = objectBounds(shapeWithId(b)).y;

    // Move B by dragging it with the Select tool, which is what a person does: the
    // arrow is not selected, the shape is grabbed.
    const element = shapeElementOf(b);
    const at = screenOf({
      x: objectBounds(shapeWithId(b)).x + 10,
      y: objectBounds(shapeWithId(b)).y + 10,
    });
    // First the press that selects it, then the drag that moves it: the two gestures
    // a person performs without thinking about them.
    pointerDown(at, element);
    pointerUp(at, element);
    pointerDown(at, element);
    pointerMove({ x: at.x, y: at.y - 200 }, element);
    pointerUp({ x: at.x, y: at.y - 200 }, element);

    // B moved 200 px up. The arrow's ends are where its two objects now are, and not
    // where they were: the end that leaves B is on a side of B, and since B is now
    // above C rather than beside it, the side it faces is a different one. That is
    // what "follows when moved" is made of - and the arrow's own record was not
    // written to at any point, because an arrow has no position of its own.
    expect(objectBounds(shapeWithId(b)).y).toBeCloseTo(bBefore - 200, 3);
    const after = connectorEnds(0);
    expect(onSideOf(after.from, shapeWithId(b))).toBe(true);
    expect(onSideOf(after.to, shapeWithId(c))).toBe(true);
    expect(after).not.toEqual(before);
    expect(connectorData(0).from).toEqual(arrow.from);
    expect(connectorData(0).to).toEqual(arrow.to);
    expect(connectorData(0).z).toBe(arrow.z);
  });
});

/** Is this point one of the side midpoints of this shape, where an attached end sits? */
function onSideOf(point: Point, shape: ShapeSnap): boolean {
  return sideMiddles(objectBounds(shape)).some(
    (middle) => Math.abs(middle.x - point.x) < 1e-9 && Math.abs(middle.y - point.y) < 1e-9,
  );
}

/** A shape by its id, because moving an object puts it in front of the others. */
function shapeWithId(id: string): ShapeSnap {
  const shape = shapes().find((candidate) => candidate.id === id);
  if (!shape) throw new Error(`shape ${id} is not on the board`);
  return shape;
}

/** The element a shape is drawn in, by its id. */
function shapeElementOf(id: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-testid="shape-object"][data-object-id="${id}"]`);
  if (!element) throw new Error(`shape ${id} is not drawn`);
  return element;
}
