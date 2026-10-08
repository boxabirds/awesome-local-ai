import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Board } from '../../src/client/board/Board';
import { screenToWorld, worldToScreen } from '../../src/client/canvas/camera';
import { CONNECTOR_HIT_TOLERANCE_PX } from '../../src/shared/config';
import { deleteObjects, moveObjects } from '../../src/shared/board-model';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { getObjectType } from '../../src/client/objects/registry';
import { dispatchPointer, TEST_BOARD_ID } from './util';
import { getDoc, getSelection } from './stickyUtil';
import { toolState } from './textUtil';
import {
  camera,
  connectorHit,
  dotEls,
  dragOn,
  getConnectors,
  seedConnector,
  seedNote,
  seedShapes,
  setCamera,
  sideAnchorPoints,
  connectorLayer,
} from './shapeUtil';

/**
 * Story 10 — the Connector tool (connector.dots, connector.create_attached,
 * connector.follow, connector.end_hit, connector.reattach, connector.detach).
 *
 * An attached end is stored as "the side of that object that faces the other end" and
 * worked out again from where the objects are now, which is why moving an object redraws
 * its arrows without the move knowing anything about arrows.
 */

/** Where the board thinks a screen point is, in board units. */
function atScreen(point: { x: number; y: number }): { x: number; y: number } {
  return worldToScreen(camera(), point);
}

/** The four dots' positions as the board draws them, in screen pixels. */
function dotPositions(): {
  side: string;
  object: string | null;
  highlighted: boolean;
  x: number;
  y: number;
}[] {
  return dotEls().map((dot) => ({
    side: dot.getAttribute('data-side') ?? '',
    object: dot.getAttribute('data-object-id'),
    highlighted: dot.getAttribute('data-highlighted') === 'true',
    x: Number.parseFloat(dot.style.left),
    y: Number.parseFloat(dot.style.top),
  }));
}

describe('the Connector tool (connector.dots, connector.create_attached)', () => {
  // TC-18: hovering an object with the tool shows a dot on each of its four sides.
  it('TC-18 shows a dot at each side midpoint of the object under the pointer', () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    const id = seedNote({ x: 100, y: 60, width: 200, height: 120 });
    const layer = connectorLayer();
    expect(toolState()).toBe('connector');
    expect(dotEls()).toHaveLength(0); // until the pointer is over something

    const on = atScreen({ x: 200, y: 120 }); // the middle of the note
    dispatchPointer(layer, 'pointermove', { clientX: on.x, clientY: on.y });

    const dots = dotPositions();
    expect(dots).toHaveLength(4); // PRD connector.dots
    for (const { side, at } of sideAnchorPoints({ x: 100, y: 60, width: 200, height: 120 })) {
      const dot = dots.find((d) => d.side === side);
      expect(dot, `the ${side} dot`).toBeTruthy();
      expect(dot!.object).toBe(id);
      expect(dot!.x).toBeCloseTo(at.x, 6);
      expect(dot!.y).toBeCloseTo(at.y, 6);
    }
    // Hovering attaches nothing: the tool is still idle and the board unchanged.
    expect(getConnectors()).toHaveLength(0);
    expect(getSelection().selectedId).toBeNull();
    expect(toolState()).toBe('connector');
  });

  // TC-19: dragged from one object to another, it attaches at both ends, at the anchors
  // that face each other.
  it('TC-19 highlights the side it will use and attaches both ends', () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    const from = seedNote({ x: 0, y: 0, width: 200, height: 100 });
    const to = seedNote({ x: 400, y: 0, width: 200, height: 100 });
    const layer = connectorLayer();

    const start = atScreen({ x: 100, y: 50 }); // over the first note
    const end = atScreen({ x: 500, y: 50 }); // over the second

    dispatchPointer(layer, 'pointerdown', { clientX: start.x, clientY: start.y });
    dispatchPointer(layer, 'pointermove', { clientX: end.x, clientY: end.y });

    // Mid-drag the target's four dots are out, and one of them is the highlighted side.
    const dots = dotPositions();
    expect(dots).toHaveLength(4);
    expect(dots.every((d) => d.object === to)).toBe(true);
    const highlighted = dots.filter((d) => d.highlighted);
    expect(highlighted).toHaveLength(1);
    const left = sideAnchorPoints({ x: 400, y: 0, width: 200, height: 100 }).find(
      (s) => s.side === 'left',
    )!;
    expect(highlighted[0]!.side).toBe('left');
    expect(highlighted[0]!.x).toBeCloseTo(left.at.x, 6);
    expect(highlighted[0]!.y).toBeCloseTo(left.at.y, 6);

    dispatchPointer(layer, 'pointerup', { clientX: end.x, clientY: end.y });

    const connectors = getConnectors();
    expect(connectors).toHaveLength(1);
    const arrow = connectors[0]!;
    expect(arrow.from).toMatchObject({ kind: 'attached', objectId: from });
    expect(arrow.to).toMatchObject({ kind: 'attached', objectId: to });
    // Both ends sit on the anchors facing each other (PRD connector.create_attached).
    expect(arrow.ends.from).toEqual({ x: 200, y: 50 });
    expect(arrow.ends.to).toEqual({ x: 400, y: 50 });
    // The arrow is selected so it can be adjusted, and the board is back on Select.
    expect(getSelection().selectedId).toBe(arrow.id);
    expect(toolState()).toBe('select');
    // It is drawn as a line with an arrowhead at the far end.
    expect(screen.getByTestId('connector-line')).toBeTruthy();
    expect(screen.getByTestId('connector-arrowhead')).toBeTruthy();
  });

  // An end released over empty space is fixed at that point.
  it('fixes an end released over empty space to that point', () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    const from = seedNote({ x: 0, y: 0, width: 200, height: 100 });
    const layer = connectorLayer();
    const start = atScreen({ x: 100, y: 50 });
    const end = atScreen({ x: 500, y: 300 }); // empty board

    dragOn(layer, start, end);

    const arrow = getConnectors()[0]!;
    expect(arrow.from).toMatchObject({ kind: 'attached', objectId: from });
    expect(arrow.to.kind).toBe('free');
    const free = arrow.to.kind === 'free' ? arrow.to : null;
    expect(free).toEqual({ kind: 'free', ...screenToWorld(camera(), end) });
  });

  // Two drags the model refuses, and the tool stays ready for the next try.
  it('creates nothing when both ends would be the same object or the arrow is too short (negative)', () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    seedNote({ x: 0, y: 0, width: 200, height: 100 });
    const layer = connectorLayer();

    // Both ends inside the one note (PRD connector.create_attached).
    dragOn(layer, atScreen({ x: 50, y: 50 }), atScreen({ x: 150, y: 60 }));
    expect(getConnectors()).toHaveLength(0);
    expect(toolState()).toBe('connector');

    // A drag of one board unit is too short to be an arrow (CONNECTOR_MIN_LENGTH_WORLD).
    dragOn(layer, atScreen({ x: 300, y: 300 }), atScreen({ x: 301, y: 300 }));
    expect(getConnectors()).toHaveLength(0);
    expect(toolState()).toBe('connector');
  });
});

describe('where an arrow points (connector.follow, connector.end_hit, connector.reattach, connector.detach)', () => {
  // TC-19's other half: the arrow follows the object it was attached to, with no help
  // from the move, and switches to the side that now faces the other end.
  it('TC-19 follows a moved object, changing to the side that faces the other end', () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    const a = seedNote({ x: 0, y: 0, width: 200, height: 100 });
    const b = seedNote({ x: 400, y: 0, width: 200, height: 100 });
    const id = seedConnector({ from: { objectId: a }, to: { objectId: b } });
    expect(getConnectors().find((c) => c.id === id)!.ends).toEqual({
      from: { x: 200, y: 50 },
      to: { x: 400, y: 50 },
    });

    // Move the first note below the second: the arrows' ends move with the box, and the
    // sides they leave from are the ones facing the other object now.
    act(() => {
      // Somebody else's move, made straight on the document: nothing here knows the
      // arrow exists.
      moveObjects(getDoc(), new Map([[a, { x: 0, y: 300 }]]));
    });

    const after = getConnectors().find((c) => c.id === id)!;
    expect(after.ends).toEqual({ from: { x: 100, y: 300 }, to: { x: 500, y: 100 } });
    // The line and its arrowhead are drawn at those points.
    const line = screen.getByTestId('connector-line');
    expect(Number(line.getAttribute('x1'))).toBeCloseTo(100, 6);
    expect(Number(line.getAttribute('y1'))).toBeCloseTo(300, 6);
    expect(Number(line.getAttribute('x2'))).toBeCloseTo(500, 6);
    expect(Number(line.getAttribute('y2'))).toBeCloseTo(100, 6);
  });

  // TC-20: the pointer is forgiven six screen pixels either side, whatever the zoom.
  it('TC-20 is selectable within six screen pixels of the line at both zooms and not beyond', () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    const arrowId = seedConnector({ from: { x: 0, y: 0 }, to: { x: 400, y: 0 } });
    const arrow = getConnectors().find((c) => c.id === arrowId)!;
    const hitTest = getObjectType('connector')!.hitTest!;

    for (const zoom of [0.5, 2]) {
      // Six screen pixels are more board units the further out the board is.
      const near = { x: 200, y: 5 / zoom };
      const far = { x: 200, y: 7 / zoom };
      expect(distanceToPolyline([arrow.ends.from, arrow.ends.to], near), `zoom ${zoom} near`)
        .toBeLessThanOrEqual(CONNECTOR_HIT_TOLERANCE_PX / zoom);
      expect(distanceToPolyline([arrow.ends.from, arrow.ends.to], far), `zoom ${zoom} far`)
        .toBeGreaterThan(CONNECTOR_HIT_TOLERANCE_PX / zoom);
      expect(hitTest(arrow, near, zoom), `zoom ${zoom} at 5px`).toBe(true);
      expect(hitTest(arrow, far, zoom), `zoom ${zoom} at 7px`).toBe(false);

      // And the line the browser is asked to hit is exactly that wide on the screen.
      setCamera({ x: 0, y: 0, zoom });
      expect(Number(connectorHit().getAttribute('stroke-width'))).toBeCloseTo(
        (2 * CONNECTOR_HIT_TOLERANCE_PX) / zoom,
        6,
      );
    }

    // Clicking the line itself selects the arrow.
    setCamera({ x: 0, y: 0, zoom: 1 });
    dispatchPointer(connectorHit(), 'pointerdown', { clientX: 200, clientY: 0 });
    dispatchPointer(connectorHit(), 'pointerup', { clientX: 200, clientY: 0 });
    expect(getSelection().selectedId).toBe(arrowId);
  });

  // TC-21: dragging an end handle re-points that end and only that end.
  it('TC-21 drags an end onto another object, and off into empty space again', () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    const target = seedNote({ x: 400, y: 0, width: 200, height: 100 });
    const [a, c] = seedShapes([
      { x: 0, y: 0, width: 200, height: 100 },
      { x: 0, y: 300, width: 200, height: 100 },
    ]);
    const arrowId = seedConnector({ from: { objectId: a }, to: { objectId: c } });
    const before = getConnectors().find((k) => k.id === arrowId)!;
    expect(before.ends).toEqual({ from: { x: 100, y: 100 }, to: { x: 100, y: 300 } });

    // Selecting the arrow brings out its two end handles.
    dispatchPointer(connectorHit(), 'pointerdown', { clientX: 100, clientY: 200 });
    dispatchPointer(connectorHit(), 'pointerup', { clientX: 100, clientY: 200 });
    expect(getSelection().selectedId).toBe(arrowId);
    const handles = screen.getAllByTestId(/connector-handle-/);
    expect(handles).toHaveLength(2);
    expect(handles[0]!.getAttribute('data-end')).toBe('from');
    expect(handles[1]!.getAttribute('data-end')).toBe('to');

    // Drag the far end onto the note: that end points at the note, the other is untouched.
    const onto = atScreen({ x: 500, y: 50 });
    dragOn(handles[1]!, { x: 100, y: 300 }, onto);
    const attached = getConnectors().find((k) => k.id === arrowId)!;
    expect(attached.from).toMatchObject({ kind: 'attached', objectId: a });
    expect(attached.to).toMatchObject({ kind: 'attached', objectId: target });
    expect(attached.ends.to).toEqual({ x: 400, y: 50 });

    // Drag it back out to empty space and the end is free, at the point it was let go.
    const freeAt = atScreen({ x: 700, y: 250 });
    dragOn(handles[1]!, onto, freeAt);
    const freed = getConnectors().find((k) => k.id === arrowId)!;
    expect(freed.to).toEqual({ kind: 'free', x: 700, y: 250 });
    expect(freed.from).toMatchObject({ kind: 'attached', objectId: a });
  });

  // Releasing an end onto the object at the other end is refused, so the arrow never has
  // two ends on one object.
  it('keeps both ends off the same object when a handle is dropped on it (negative)', () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    const [a, c] = seedShapes([
      { x: 0, y: 0, width: 200, height: 100 },
      { x: 0, y: 300, width: 200, height: 100 },
    ]);
    const arrowId = seedConnector({ from: { objectId: a }, to: { objectId: c } });

    dispatchPointer(connectorHit(), 'pointerdown', { clientX: 100, clientY: 200 });
    dispatchPointer(connectorHit(), 'pointerup', { clientX: 100, clientY: 200 });
    const handles = screen.getAllByTestId(/connector-handle-/);
    // Drag the far end onto the object the near end is already attached to.
    dragOn(handles[1]!, { x: 100, y: 300 }, atScreen({ x: 100, y: 50 }));

    const after = getConnectors().find((k) => k.id === arrowId)!;
    expect(after.to).toMatchObject({ kind: 'attached', objectId: c }); // unchanged
    expect(after.from).toMatchObject({ kind: 'attached', objectId: a });
  });

  // AC-14 / TC-13 from the user's side: the arrow stays, its end fixed where it pointed.
  it('leaves the arrow when its object is deleted, with that end free where it was', () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    const [a] = seedShapes([{ x: 0, y: 0, width: 200, height: 100 }]);
    const arrowId = seedConnector({ from: { objectId: a }, to: { x: 300, y: 300 } });
    expect(screen.getAllByTestId('connector-object')).toHaveLength(1);

    act(() => {
      deleteObjects(getDoc(), [a]);
    });

    const arrows = getConnectors();
    expect(arrows).toHaveLength(1);
    const arrow = arrows[0]!;
    expect(arrow.id).toBe(arrowId);
    // The end that pointed at the shape is now fixed to the board where it pointed.
    expect(arrow.from).toEqual({ kind: 'free', x: 100, y: 100 });
    expect(screen.getAllByTestId('connector-object')).toHaveLength(1);
  });
});
