/**
 * Drawing arrows between things, and moving their ends afterwards (story 10, TC-18 to TC-21).
 *
 * An arrow is a claim about two objects, so these four tests are all about whether the board knows which two
 * objects it is talking about:
 *
 *   - TC-18 — before drawing anything, the person asks *where would an arrow join this?* The tool answers
 *     with four dots, one at the middle of each side, which are the only four places an attached end can
 *     ever be drawn. A tool that showed three dots, or dots at the corners, would be promising a join the
 *     arrow never makes.
 *   - TC-19 — while the arrow is being dragged, the dot it will use is marked. The marked dot is produced by
 *     the same function that produces the arrow's end, so the preview is the truth and not an invitation to
 *     aim twice.
 *   - TC-20 — an arrow is a thin line on a big board, and a click that selects what is beside it is a click
 *     that deleted somebody's neighbour. The tolerance is six *screen* pixels at every zoom, which is what
 *     makes an arrow as easy to select at ten per cent as at four hundred.
 *   - TC-21 — an end can be pulled to a new object, or off every object onto the board. Both are one write,
 *     and pulling the head back onto the object the tail already sits on is refused rather than silently
 *     drawing an arrow from a shape to itself.
 *
 * Each test frames the camera on the world origin, so screen and board are the same numbers and the arrow's
 * own arithmetic can be read straight off the screen: a dot at board 500,160 is a dot drawn at 500,160.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';

import {
  addConnector,
  addShape,
  activeTool,
  armConnectorTool,
  attachableRects,
  boardRects,
  centreOf,
  connectorById,
  connectorElement,
  connectors,
  dots,
  frameAtOrigin,
  hoverSheet,
  hitTestObject,
  moveWindow,
  nearestDot,
  pointerDown,
  pressConnector,
  renderBoard,
  resolve,
  setZoom,
  shapes,
  sweep,
  upWindow,
  rendered,
} from './helpers/tools';
import { outlinedIds } from './helpers/selection';
import { CONNECTOR_HIT_TOLERANCE_PX, CONNECTOR_STROKE_WIDTH_WORLD } from '../../src/shared/config';

/** A rectangle nobody can mistake for another one: 200 by 120 with its top-left at the point given. */
const A = { x: 100, y: 100, width: 200, height: 120 };
/** The same size, four hundred units to the right: an arrow between the two is horizontal and obvious. */
const B = { x: 500, y: 100, width: 200, height: 120 };
/** Below both, for the tests that need a third object to move an end onto. */
const C = { x: 300, y: 400, width: 200, height: 120 };

describe('the Connector tool (TC-18, TC-19)', () => {
  beforeEach(() => {
    renderBoard();
    frameAtOrigin();
  });

  it('TC-18: hovering an object shows a dot at the middle of each of its four sides', async () => {
    const a = addShape(A);
    const sheet = await armConnectorTool();

    // A point inside the top wedge, so the marked dot is not left to a tie to decide.
    hoverSheet({ x: 180, y: 120 });

    const shown = dots();
    expect(shown.map((dot) => dot.side).sort()).toEqual(['bottom', 'left', 'right', 'top']);
    // The four midpoints. Not the corners, not the centre: an attached end is only ever drawn at one of these
    // four, which is what lets a person aim at a side instead of at a shape.
    expect(Object.fromEntries(shown.map((dot) => [dot.side, dot.at]))).toEqual({
      top: { x: 200, y: 100 },
      right: { x: 300, y: 160 },
      bottom: { x: 200, y: 220 },
      left: { x: 100, y: 160 },
    });
    expect(shown.filter((dot) => dot.nearest).map((dot) => dot.side)).toEqual(['top']);
    // Nothing has been drawn, and nothing will be until a pointer travels somewhere.
    expect(connectors()).toHaveLength(0);
    expect(sheet).toBeInTheDocument();
    expect(a).toBeTruthy();
  });

  it('TC-18: the dot that moves is the side the pointer is nearest, not the side the shape faces', async () => {
    addShape(A);
    await armConnectorTool();

    // The same object, a pointer below its middle: of the four sides, the bottom is the one this point is
    // nearest, measured against the shape's own proportions.
    hoverSheet({ x: 200, y: 210 });
    expect(nearestDot()?.side).toBe('bottom');

    // And a pointer out to its right, near the middle height: the right side.
    hoverSheet({ x: 290, y: 160 });
    expect(nearestDot()?.side).toBe('right');
  });

  it('TC-18: over empty board the tool offers nothing, and takes nothing away', async () => {
    addShape(A);
    const sheet = await armConnectorTool();

    hoverSheet({ x: 900, y: 600 });
    expect(dots()).toHaveLength(0);

    // The board's own gesture still belongs to the board: a press on the sheet pans, and makes no arrow.
    expect(sheet).toBeInTheDocument();
    expect(connectors()).toHaveLength(0);
  });

  it('TC-19: dragging from one shape to another marks the dot the arrow will use and attaches both ends', async () => {
    const a = addShape(A);
    const b = addShape(B);
    const sheet = await armConnectorTool();

    // Press on A, travel to the left half of B: the arrow will leave A's right side and join B's left.
    pointerDown(sheet, ...xy(centreOf(A)));
    moveWindow({ x: 400, y: 160 });
    moveWindow({ x: 540, y: 160 });

    // The preview is being drawn and the target's four dots are up, one of them marked: this is the answer
    // to "where will it land?" given before the pointer stops moving.
    expect(screen.getByTestId('connector-preview')).toBeInTheDocument();
    const marked = nearestDot();
    expect(marked?.side).toBe('left');
    expect(marked?.at).toEqual({ x: 500, y: 160 });

    upWindow({ x: 540, y: 160 });

    await waitFor(() => expect(connectors()).toHaveLength(1));
    const arrow = connectors()[0]!;
    expect(arrow).toMatchObject({ type: 'connector' });
    expect(arrow.from).toMatchObject({ kind: 'attached', objectId: a });
    expect(arrow.to).toMatchObject({ kind: 'attached', objectId: b });
    // Drawn between the two sides that face each other, which is not a stored number on either end.
    expect(resolve(arrow)).toEqual({ from: { x: 300, y: 160 }, to: { x: 500, y: 160 } });

    // One write, and the preview is gone: the document is the answer now.
    expect(screen.queryByTestId('connector-preview')).toBeNull();
    await waitFor(() => expect(outlinedIds()).toEqual([arrow.id]));
    expect(activeTool()).toBe('select');
  });

  it('TC-19: an end dropped back on the object the arrow starts on is not attached to it', async () => {
    const a = addShape(A);
    addShape(B);
    const sheet = await armConnectorTool();

    // Out of A's middle and back onto A again. An arrow between one object and itself says nothing about the
    // board, so the far end is not attached to it — it is fixed to the board where the pointer stopped, which
    // is a thing the person can see and move.
    sweep(sheet, centreOf(A), { x: 150, y: 120 });

    await waitFor(() => expect(connectors()).toHaveLength(1));
    const arrow = connectors()[0]!;
    expect(arrow.from).toMatchObject({ kind: 'attached', objectId: a });
    expect(arrow.to.kind).toBe('free');
  });

  it('TC-19: a drag too short to be an arrow makes nothing and keeps the tool in hand', async () => {
    addShape(A);
    const sheet = await armConnectorTool();

    // Three units of travel between two ends that are on nothing, against a minimum arrow length the model
    // enforces. The tool asks the model, gets nothing back, and does not pretend otherwise: the tool stays
    // armed, and the undo history of five people is one step shorter than it would have been.
    sweep(sheet, { x: 900, y: 600 }, { x: 903, y: 600 }, 1);

    expect(connectors()).toHaveLength(0);
    // The person meant to draw an arrow and is still holding the tool that draws one.
    expect(activeTool()).toBe('connector');
    expect(screen.getByTestId('connector-tool')).toBeInTheDocument();
    expect(screen.queryByTestId('connector-preview')).toBeNull();
  });

  it('TC-19: an end let go over empty board is fixed there, and the other end keeps its object', async () => {
    const a = addShape(A);
    const sheet = await armConnectorTool();

    sweep(sheet, centreOf(A), { x: 860, y: 560 });

    await waitFor(() => expect(connectors()).toHaveLength(1));
    const arrow = connectors()[0]!;
    expect(arrow.from).toMatchObject({ kind: 'attached', objectId: a });
    expect(arrow.to).toMatchObject({ kind: 'free', x: 860, y: 560 });
  });

  it('TC-19: a press on the sheet does not move the shape underneath it', async () => {
    const a = addShape(A);
    const before = shapes().find((shape) => shape.id === a)!;
    const sheet = await armConnectorTool();

    // The same drag story 7 would use to move that shape, started at its centre.
    sweep(sheet, centreOf(before), { x: 400, y: 400 });

    const after = shapes().find((shape) => shape.id === a)!;
    expect(after).toMatchObject({ x: before.x, y: before.y });
    expect(connectors()).toHaveLength(1);
  });
});

describe('selecting an arrow (TC-20)', () => {
  beforeEach(() => {
    renderBoard();
    frameAtOrigin();
  });

  it('TC-20: five screen pixels from the line selects the arrow at 100%, seven does not', () => {
    const id = addConnector({ x: 100, y: 100 }, { x: 500, y: 100 });
    const arrow = connectorById(id);
    const rects = attachableRects([arrow]);

    // The board's own answer to "is this point on this object?", which is the question a browser's hit test
    // answers before it decides which element a click belongs to. jsdom lays nothing out, so a click aimed
    // at a point five pixels off the line has no element to land on: what can be tested here — and what the
    // product depends on — is the tolerance itself, in the units the browser would hand it.
    expect(hitTestObject(arrow, { x: 300, y: 105 }, { scale: 1, rects })).toBe(true);
    expect(hitTestObject(arrow, { x: 300, y: 107 }, { scale: 1, rects })).toBe(false);
    // Exactly the tolerance is still a hit: six screen pixels is the promise, not the nearest miss.
    expect(hitTestObject(arrow, { x: 300, y: 100 + CONNECTOR_HIT_TOLERANCE_PX }, { scale: 1, rects })).toBe(true);
  });

  it('TC-20: at 200% the same six screen pixels are three board units, and the aim is the same', () => {
    const id = addConnector({ x: 100, y: 100 }, { x: 500, y: 100 });
    const arrow = connectorById(id);
    const rects = attachableRects([arrow]);

    // Five and seven screen pixels, divided by the zoom: 2.5 and 3.5 board units, against a tolerance of
    // 6 / 2. An arrow is as easy to select here as it was at a hundred per cent, which is the whole point of
    // dividing by the zoom instead of leaving the number alone.
    expect(hitTestObject(arrow, { x: 300, y: 102.5 }, { scale: 2, rects })).toBe(true);
    expect(hitTestObject(arrow, { x: 300, y: 103.5 }, { scale: 2, rects })).toBe(false);
  });

  it('TC-20: a click inside the box around an arrow but far from its line is not a click on the arrow', () => {
    // A slanting arrow, so that its bounding box contains places the line never goes.
    const id = addConnector({ x: 100, y: 100 }, { x: 500, y: 300 });
    const arrow = connectorById(id);
    const rects = attachableRects([arrow]);

    expect(arrow).toMatchObject({ x: 100, y: 100, width: 400, height: 200 });
    // The bottom-left corner of that box, twenty units in from each edge: inside the box, far from the line.
    expect(hitTestObject(arrow, { x: 120, y: 280 }, { scale: 1, rects })).toBe(false);
    // And the middle of the line still is the arrow.
    expect(hitTestObject(arrow, { x: 300, y: 200 }, { scale: 1, rects })).toBe(true);
  });

  it('TC-20: the strip an arrow is clicked through is six screen pixels wide on either side, at any zoom', async () => {
    const id = addConnector({ x: 100, y: 100 }, { x: 500, y: 100 });
    pressConnector(id);
    expect(outlinedIds()).toEqual([id]);

    const strip = connectorElement(id).querySelector<HTMLElement>('[data-testid="connector-hit"]');
    if (strip === null) throw new Error('the arrow drew no click target');
    // At 100%: the stroke plus twice the tolerance, in board units.
    expect(parseFloat(strip.style.width)).toBe(400);
    expect(parseFloat(strip.style.height)).toBe(CONNECTOR_STROKE_WIDTH_WORLD + 2 * CONNECTOR_HIT_TOLERANCE_PX);

    // At 200% the board is twice as big, so the strip is half as many board units across and exactly as many
    // pointer-widths on the screen.
    setZoom(2);
    await rendered();
    const thick = connectorElement(id).querySelector<HTMLElement>('[data-testid="connector-hit"]');
    if (thick === null) throw new Error('the arrow drew no click target at 200%');
    expect(parseFloat(thick.style.height)).toBe(CONNECTOR_STROKE_WIDTH_WORLD + (2 * CONNECTOR_HIT_TOLERANCE_PX) / 2);
  });

  it('TC-20: a press on the strip selects the arrow and moves nothing', async () => {
    const a = addShape(A);
    const b = addShape(B);
    const id = addConnector(
      { kind: 'attached', objectId: a, fallback: { x: 300, y: 160 } },
      { kind: 'attached', objectId: b, fallback: { x: 500, y: 160 } },
    );
    const before = shapes().map((shape) => ({ x: shape.x, y: shape.y }));

    pressConnector(id);

    await waitFor(() => expect(outlinedIds()).toEqual([id]));
    expect(shapes().map((shape) => ({ x: shape.x, y: shape.y }))).toEqual(before);
  });

  it('TC-20: an arrow whose ends are both free is still an arrow that can be selected', () => {
    const id = addConnector({ x: 200, y: 200 }, { x: 400, y: 200 });
    const arrow = connectorById(id);
    expect(hitTestObject(arrow, { x: 300, y: 203 }, { scale: 1, rects: boardRects() })).toBe(true);
    expect(arrow.from.kind).toBe('free');
    expect(arrow.to.kind).toBe('free');
  });
});

describe('moving an arrow’s end (TC-21)', () => {
  beforeEach(() => {
    renderBoard();
    frameAtOrigin();
  });

  /** Press an end handle and carry it to a board point: the whole of a re-attach. */
  function dragEnd(id: string, end: 'from' | 'to', to: { x: number; y: number }): void {
    const handle = connectorElement(id).querySelector<HTMLElement>(`[data-testid="connector-handle-${end}"]`);
    if (handle === null) throw new Error(`the selected arrow offers no ${end} handle`);
    const start = resolve(connectorById(id))[end];
    pointerDown(handle, ...xy(start));
    for (const step of [0.4, 0.8, 1]) {
      moveWindow({ x: start.x + (to.x - start.x) * step, y: start.y + (to.y - start.y) * step });
    }
    upWindow(to);
  }

  it('TC-21: a selected arrow offers two handles, at its two ends', () => {
    const a = addShape(A);
    const b = addShape(B);
    const id = addConnector(
      { kind: 'attached', objectId: a, fallback: { x: 300, y: 160 } },
      { kind: 'attached', objectId: b, fallback: { x: 500, y: 160 } },
    );

    // Nothing offered while the arrow is not the selection: two arrows with handles would be two arrows
    // whose ends somebody is moving.
    expect(screen.queryByTestId('connector-handle-to')).toBeNull();

    pressConnector(id);
    expect(screen.getByTestId('connector-handle-from')).toBeInTheDocument();
    expect(screen.getByTestId('connector-handle-to')).toBeInTheDocument();
    expect(resolve(connectorById(id))).toEqual({ from: { x: 300, y: 160 }, to: { x: 500, y: 160 } });
    // Two handles, and they say which end each one is: pulling the tail and pointing the head are different
    // jobs, and a person who grabs the wrong one should be able to see it before they let go.
    expect(screen.getByTestId('connector-handle-from').dataset.end).toBe('from');
  });

  it('TC-21: carrying the head onto a third object attaches that end to it, in one write', async () => {
    const a = addShape(A);
    const b = addShape(B);
    const c = addShape(C);
    const id = addConnector(
      { kind: 'attached', objectId: a, fallback: { x: 300, y: 160 } },
      { kind: 'attached', objectId: b, fallback: { x: 500, y: 160 } },
    );
    pressConnector(id);

    // A point inside C's top wedge, so the side it joins is decided by the pointer and not by a tie.
    dragEnd(id, 'to', { x: 360, y: 420 });

    await waitFor(() => expect(connectorById(id).to).toMatchObject({ kind: 'attached', objectId: c }));
    // The tail was never touched, and the arrow is one undo step: the pointer's forty frames of travel were
    // one decision about where the head belongs.
    expect(connectorById(id).from).toMatchObject({ kind: 'attached', objectId: a });

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    await waitFor(() => expect(connectorById(id).to).toMatchObject({ kind: 'attached', objectId: b }));
  });

  it('TC-21: and carrying it onto empty board leaves it free at exactly that point', async () => {
    const a = addShape(A);
    const b = addShape(B);
    const id = addConnector(
      { kind: 'attached', objectId: a, fallback: { x: 300, y: 160 } },
      { kind: 'attached', objectId: b, fallback: { x: 500, y: 160 } },
    );
    pressConnector(id);

    dragEnd(id, 'to', { x: 760, y: 620 });

    await waitFor(() => expect(connectorById(id).to).toMatchObject({ kind: 'free', x: 760, y: 620 }));
    // The witness the story cares about: the arrow is drawn to the point the pointer stopped at, and an
    // attached end stays wherever its object is.
    expect(resolve(connectorById(id)).to).toEqual({ x: 760, y: 620 });
    expect(connectorElement(id).dataset.connectorTo).toBe('free');
  });

  it('TC-21: the end being dragged shows where it would land, before the pointer lets go', async () => {
    const a = addShape(A);
    const b = addShape(B);
    const c = addShape(C);
    const id = addConnector(
      { kind: 'attached', objectId: a, fallback: { x: 300, y: 160 } },
      { kind: 'attached', objectId: b, fallback: { x: 500, y: 160 } },
    );
    pressConnector(id);

    const handle = connectorElement(id).querySelector<HTMLElement>('[data-testid="connector-handle-to"]');
    if (handle === null) throw new Error('the selected arrow offers no head handle');
    pointerDown(handle, ...xy({ x: 500, y: 160 }));
    moveWindow({ x: 420, y: 300 });
    moveWindow({ x: 360, y: 420 });

    // The arrow is drawn with its head at the pointer while the tail stays where its object is — the arrow
    // pivots — and the dot marks the side it has taken: where the head will be let go, which is not where the
    // pointer is. On a shape the pointer is standing in the middle of, those are different places.
    const drawn = connectorElement(id);
    const head = drawn.querySelector<SVGCircleElement>('svg circle');
    expect([head?.getAttribute('cx'), head?.getAttribute('cy')]).toEqual(['400', '400']);
    // The side this point belongs to is the top of the third shape, and it is the shape's own proportions
    // that say so: the point is above its middle.
    // The line and its head are the arrow's own geometry, not something the board reaches in for, so they are
    // read by what they are rather than by a name they were given for the test's benefit.
    const line = drawn.querySelector<SVGLineElement>('svg line');
    // The head follows the pointer, the tail stays on the object it is attached to: the arrow pivots. The
    // line stops short of the pointer by the length of the arrowhead drawn at its tip, which is why the second
    // pair is near the pointer rather than on it.
    expect([line?.getAttribute('x1'), line?.getAttribute('y1')]).toEqual(['300', '160']);
    expect(Number(line?.getAttribute('x2'))).toBeCloseTo(360, -1);
    expect(Number(line?.getAttribute('y2'))).toBeCloseTo(420, -1);

    upWindow({ x: 360, y: 420 });
    await waitFor(() => expect(connectorById(id).to).toMatchObject({ kind: 'attached', objectId: c }));
  });

  it('TC-21: pulling the head back onto the object the tail sits on is refused, and the head stays put', async () => {
    const a = addShape(A);
    const b = addShape(B);
    const id = addConnector(
      { kind: 'attached', objectId: a, fallback: { x: 300, y: 160 } },
      { kind: 'attached', objectId: b, fallback: { x: 500, y: 160 } },
    );
    pressConnector(id);
    const before = connectorById(id);

    dragEnd(id, 'to', centreOf(A));

    // An arrow from a shape to itself says nothing about the board, and the model refuses it. What the
    // person sees is the handle snap back to where it was: the same answer, given twice — once in the
    // document, once on the screen.
    await waitFor(() => expect(connectorById(id).to).toEqual(before.to));
    expect(connectorById(id).to).toMatchObject({ kind: 'attached', objectId: b });
  });

  it('TC-21: a handle let go mid-air keeps the end where it was, because nothing was written', async () => {
    const a = addShape(A);
    const b = addShape(B);
    const id = addConnector(
      { kind: 'attached', objectId: a, fallback: { x: 300, y: 160 } },
      { kind: 'attached', objectId: b, fallback: { x: 500, y: 160 } },
    );
    pressConnector(id);
    const before = connectorById(id).to;

    const handle = connectorElement(id).querySelector<HTMLElement>('[data-testid="connector-handle-to"]');
    if (handle === null) throw new Error('the selected arrow offers no head handle');
    pointerDown(handle, ...xy({ x: 500, y: 160 }));
    moveWindow({ x: 640, y: 300 });
    fireEvent(window, new PointerEvent('pointercancel', { bubbles: true, clientX: 640, clientY: 300 }));

    // The arrow stops following the pointer, and it is where it was: nothing was ever written, so there is
    // nothing to put back. The arrow is still selected — a cancelled drag is not a reason to lose the
    // selection — so the handles are still there, at the ends they were at before.
    await waitFor(() => expect(connectorElement(id).querySelector('svg circle')).toBeNull());
    expect(connectorById(id).to).toEqual(before);
    expect(resolve(connectorById(id)).to).toEqual({ x: 500, y: 160 });
  });

  it('TC-21: moving an end is not moving the object it was attached to', async () => {
    const a = addShape(A);
    const b = addShape(B);
    const c = addShape(C);
    const id = addConnector(
      { kind: 'attached', objectId: a, fallback: { x: 300, y: 160 } },
      { kind: 'attached', objectId: b, fallback: { x: 500, y: 160 } },
    );
    const before = shapes().map((shape) => ({ id: shape.id, x: shape.x, y: shape.y }));
    pressConnector(id);

    dragEnd(id, 'to', { x: 360, y: 420 });

    expect(shapes().map((shape) => ({ id: shape.id, x: shape.x, y: shape.y }))).toEqual(before);
    expect(connectorById(id).to).toMatchObject({ kind: 'attached', objectId: c });
    expect(a).not.toBe(b);
  });
});

/** A pointer position as the two-argument press helper wants it. */
function xy(point: { x: number; y: number }): [number, number] {
  return [point.x, point.y];
}
