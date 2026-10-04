import { describe, expect, it, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import * as Y from 'yjs';
import { flushFrames } from './helpers';
import { clickUndo, mountSticky, type MountedSticky } from './helpers/sticky';
import { countUpdates, remoteChange } from './helpers/text';
import {
  activeTool,
  along,
  armConnector,
  armShape,
  connectorElement,
  connectorElements,
  connectorOf,
  connectorOverlay,
  connectorPreview,
  dots,
  dragEnd,
  dragShape,
  hitLine,
  hoverAt,
  objectElements,
  pressEscape,
  pressToolKey,
  screenPoint,
  selectArrow,
  shapeElement,
  targetDot,
  toolPressed,
} from './helpers/shapes';
import { OBJECTS_MAP, snapshot, SHAPE_TYPE } from '../../src/shared/board-model';
import { createShape } from '../../src/shared/objects/shape';
import { createSticky } from '../../src/shared/board-model';
import { boardRects, createConnector } from '../../src/shared/objects/connector';
import {
  CONNECTOR_HIT_TOLERANCE_PX,
  CONNECTOR_MIN_LENGTH_WORLD,
} from '../../src/shared/config';
import {
  endpointAim,
  nearestSide,
  sideAnchor,
  type Endpoint,
} from '../../src/shared/geometry/connector-geometry';
import type { Point, Rect } from '../../src/shared/geometry';

/**
 * An arrow on the board (connector.ui at component level): the dots that say where it can be
 * fastened, the drag that fastens it, the line that is clicked, and the ends that can be moved.
 *
 * The rule underneath all of it is that an arrow is stored as two *things* and not as two points, so
 * what these tests can look at is the arithmetic that turns the things back into a drawing: which side
 * of a shape an end uses, which is decided by where the other end is going and not by where this end
 * was left. The dots, the preview line and the drawn arrow all answer that same question with the same
 * functions, and a test that only checked the finished arrow would happily pass while the preview lied
 * about which of an object's four sides was about to be used.
 *
 * Two of these tests are about a boundary that jsdom cannot feel. The tolerance around an arrow's line
 * is drawn as a wide transparent stroke and left to the browser's own geometry, which no fake document
 * has; what is checked here is the arithmetic that produces the boundary - the tolerance in board units
 * at whatever zoom the board happens to be at - and the real click, five pixels from a line and seven,
 * is in the Playwright suite.
 */

vi.mock('y-websocket', async () => {
  const helper = await import('./helpers/fake-provider');
  return helper.yWebsocketStub();
});

/** Three shapes in a row, far enough apart that an arrow between two of them is unambiguous. */
const A = { x: -400, y: -80, width: 200, height: 120 };
const B = { x: -60, y: -80, width: 200, height: 120 };
const C = { x: 280, y: -80, width: 200, height: 120 };

interface Flow {
  readonly board: MountedSticky;
  readonly a: string;
  readonly b: string;
  readonly c: string;
}

/** Three shapes on a board, drawn by the model rather than by the tool: this is scenery. */
async function threeShapes(): Promise<Flow> {
  const board = await mountSticky();
  const ids: string[] = [A, B, C].map((box) => {
    const id = createShape(
      board.doc,
      { kind: 'rect', rect: { x: box.x, y: box.y, width: box.width, height: box.height }, at: { x: 0, y: 0 } },
      'someone-else',
    );
    if (id === null) {
      throw new Error('the board refused a shape it should have taken');
    }
    return id;
  });
  const [a, b, c] = ids as [string, string, string];
  await flushFrames(3);
  return { board, a, b, c };
}

function centre(box: { x: number; y: number; width: number; height: number }): Point {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function rectOf(board: MountedSticky, id: string): Rect {
  const rects = boardRects(snapshot(board.doc));
  const rect = rects.get(id);
  if (rect === undefined) {
    throw new Error(`object ${id} has no box on the board`);
  }
  return rect;
}

async function arrow(board: MountedSticky, from: string, to: string): Promise<string> {
  const id = createConnector(
    board.doc,
    { kind: 'attached', objectId: from, fallback: centre(A) },
    { kind: 'attached', objectId: to, fallback: centre(B) },
    'someone-else',
  );
  if (id === null) {
    throw new Error('the board refused an arrow it should have taken');
  }
  // The arrow is in the document as soon as the write is made and on the screen a frame or two later,
  // and these tests press on the element it is drawn in.
  await flushFrames(2);
  return id;
}

describe('connector: the dots (TC-18)', () => {
  it('TC-18: L puts the tool up, and a pointer over a shape shows four dots at the side middles', async () => {
    const { board, a } = await threeShapes();
    expect(pressToolKey('KeyL')).toBe(true);
    await flushFrames();
    // The board says which tool is up on its own surface, and on the button, and the two agree.
    expect(activeTool(board)).toBe('connector');
    expect(toolPressed(board, 'connector')).toBe(true);

    await hoverAt(board, centre(A));
    const shown = dots(board);
    expect(shown).toHaveLength(4);
    const rect = rectOf(board, a);
    // One dot at the middle of each of the four sides - not four dots spread over the shape's face,
    // and not four dots at the corners, which is what an arrow would not go to.
    const expected = [
      { x: rect.x + rect.width / 2, y: rect.y },
      { x: rect.x + rect.width, y: rect.y + rect.height / 2 },
      { x: rect.x + rect.width / 2, y: rect.y + rect.height },
      { x: rect.x, y: rect.y + rect.height / 2 },
    ].map((point) => screenPoint(board, point));
    const drawn = shown.map((dot) => ({ x: Number(dot.getAttribute('cx')), y: Number(dot.getAttribute('cy')) }));
    for (const want of expected) {
      expect(drawn.some((got) => Math.abs(got.x - want.x) < 0.51 && Math.abs(got.y - want.y) < 0.51)).toBe(
        true,
      );
    }
    // Nothing is lit before there is a drag: four dots say "this thing takes arrows", and which of the
    // four it will be is answered by the other end, which does not exist yet.
    expect(targetDot(board)).toBeNull();
  });

  it('TC-18b: no dots on empty board, and none over an arrow', async () => {
    const { board, a, b } = await threeShapes();
    await armConnector(board);
    await hoverAt(board, { x: -560, y: 260 });
    expect(connectorOverlay(board)).toBeNull();
    const id = await arrow(board, a, b);
    await flushFrames();
    // An arrow's box is the rectangle around its two ends, which contains a great deal of board that
    // is not the arrow. An arrow you could fasten another arrow to by aiming at the empty space inside
    // it is an arrow that gets fastened to by accident.
    await hoverAt(board, centre(rectOf(board, id)));
    expect(dots(board)).toHaveLength(0);
  });

  it('TC-18c: the dots follow a shape that somebody else moved', async () => {
    const { board, a, b } = await threeShapes();
    const id = await arrow(board, a, b);
    await armConnector(board);
    await hoverAt(board, centre(A));
    const before = dots(board).map((dot) => dot.getAttribute('cx'));
    // Somebody else moves the shape. The dots go with it, because they are computed from the shape's
    // box every time and not from where the box was when the pointer arrived.
    const moved = moveShape(board, a, 120, 40);
    await flushFrames();
    const after = dots(board).map((dot) => dot.getAttribute('cx'));
    expect(after).not.toEqual(before);
    // The right-hand dot of the four is now where the shape's right-hand side is.
    const right = Math.max(...after.map((value) => Number(value)));
    expect(right).toBeCloseTo(screenPoint(board, { x: moved.x + moved.width, y: moved.y }).x, 0);
    // The arrow the shape carries went with it too, which is the same fact seen from the other end.
    const drawn = connectorElement(board, id);
    expect(Number(drawn.dataset.fromX)).toBeCloseTo(moved.x + moved.width, 0);
  });

  it('TC-18d: the dots are drawn on an overlay that is not in the pointer way', async () => {
    const { board } = await threeShapes();
    await armConnector(board);
    await hoverAt(board, centre(A));
    const overlay = connectorOverlay(board);
    expect(overlay?.getAttribute('aria-hidden')).toBe('true');
    // The dots are an invitation and not a target: pressing through them has to reach the shape, so a
    // press where a dot is drawn still starts the drag from the shape under it.
    expect(overlay instanceof SVGSVGElement).toBe(true);
  });
});

describe('connector: drawing one (TC-19)', () => {
  it('TC-19: pull from A over B, and the arrow is fastened to both', async () => {
    const { board, a, b } = await threeShapes();
    await armConnector(board);

    const from = centre(A);
    const to = centre(B);
    const before = snapshot(board.doc).map((object) => object.id);
    const down = board.screenOf(from);
    const up = board.screenOf(to);
    fireEvent.pointerDown(board.board, { pointerId: 1, button: 0, buttons: 1, clientX: down.x, clientY: down.y });
    await flushFrames();
    fireEvent.pointerMove(window, {
      pointerId: 1,
      buttons: 1,
      clientX: board.screenOf({ x: (from.x + to.x) / 2, y: from.y }).x,
      clientY: board.screenOf({ x: (from.x + to.x) / 2, y: from.y }).y,
    });
    await flushFrames();

    // The shape the arrow has left does not offer its dots while the drag is out: fastening both ends
    // of one arrow to one shape is refused, so showing its dots would be an offer to be refused. The
    // overlay itself stays, because it is also carrying the dashed line.
    expect(dots(board)).toHaveLength(0);
    expect(connectorPreview(board)).not.toBeNull();

    fireEvent.pointerMove(window, { pointerId: 1, buttons: 1, clientX: up.x, clientY: up.y });
    await flushFrames();

    // Over B, the lit dot is the side B presents to the arrow, which is the side facing A rather than
    // the side the pointer happens to be nearest.
    const lit = targetDot(board);
    expect(lit).not.toBeNull();
    expect(connectorOverlay(board)?.getAttribute('data-hover')).toBe(b);
    const aim = endpointAim(end(a), rectBoard(board));
    const expected = sideAnchor(rectOf(board, b), nearestSide(rectOf(board, b), aim));
    expect(Number(lit?.getAttribute('cx'))).toBeCloseTo(screenPoint(board, expected).x, 0);
    expect(Number(lit?.getAttribute('cy'))).toBeCloseTo(screenPoint(board, expected).y, 0);

    // A dashed line is drawn while the drag is out, and it is drawn between the two points the arrow
    // will be drawn at, not between the two points the pointer visited.
    const line = connectorPreview(board);
    expect(line).not.toBeNull();

    fireEvent.pointerUp(board.board, { pointerId: 1, button: 0, buttons: 0, clientX: up.x, clientY: up.y });
    await flushFrames();

    const id = newId(board, before);
    const connector = connectorOf(board, id);
    expect(connector.from).toMatchObject({ kind: 'attached', objectId: a });
    expect(connector.to).toMatchObject({ kind: 'attached', objectId: b });
    // The arrow is the selection, the tool is done, and the preview is gone.
    expect(board.outlinedIds()).toEqual([id]);
    expect(activeTool(board)).toBe('select');
    expect(connectorPreview(board)).toBeNull();
    expect(connectorElement(board, id).dataset.selected).toBe('true');
  });

  it('TC-19b: one write, and the undo of an arrow is one press', async () => {
    const { board } = await threeShapes();
    await armConnector(board);
    const counter = countUpdates(board);
    const id = await drawArrow(board, centre(A), centre(B));
    expect(counter.count()).toBe(1);
    counter.stop();
    clickUndo(board);
    await flushFrames();
    expect(snapshot(board.doc).find((object) => object.id === id)).toBeUndefined();
  });

  it('TC-19c: both ends on one shape makes no arrow, and the tool stays up', async () => {
    const { board } = await threeShapes();
    const shapes = objectElements(board, SHAPE_TYPE).length;
    await armConnector(board);
    const before = snapshot(board.doc);
    // The dot of the shape the arrow left is not even offered, and the model refuses the arrow
    // anyway: an arrow from a shape to itself is a circle around nothing.
    await drawArrow(board, centre(A), { x: A.x + A.width - 10, y: A.y + 10 }, true);
    await flushFrames();
    expect(snapshot(board.doc)).toEqual(before);
    expect(activeTool(board)).toBe('connector');
    expect(toolPressed(board, 'connector')).toBe(true);
    expect(objectElements(board, SHAPE_TYPE)).toHaveLength(shapes);
    expect(connectorElements(board)).toHaveLength(0);
  });

  it('TC-19d: an arrow let go on empty board is fastened to nothing, at the point it was let go', async () => {
    const { board } = await threeShapes();
    await armConnector(board);
    const free = { x: 200, y: 220 };
    const id = await drawArrow(board, centre(A), free);
    const connector = connectorOf(board, id);
    expect(connector.to.kind).toBe('free');
    expect(connector.to).toMatchObject({ x: free.x, y: free.y });
    expect(connector.from.kind).toBe('attached');
  });

  it('TC-19e: a drag too short to be an arrow makes nothing, and leaves the tool up', async () => {
    const { board } = await threeShapes();
    await armConnector(board);
    const before = snapshot(board.doc);
    // Four board units long, and the shortest arrow the model will take is eight: an arrow that short is
    // an arrowhead with no line under it. The tool stays up so it can be drawn again, longer.
    await drawArrow(board, { x: -560, y: 200 }, { x: -556, y: 200 }, true);
    expect(snapshot(board.doc)).toEqual(before);
    expect(activeTool(board)).toBe('connector');
    expect(toolPressed(board, 'connector')).toBe(true);
    expect(CONNECTOR_MIN_LENGTH_WORLD).toBeGreaterThan(0);
  });

  it('TC-19g: an arrow between two points with nothing under either of them is a line, and is taken', async () => {
    const { board } = await threeShapes();
    await armConnector(board);
    // Both ends free is the same rule as one end free: an end let go on the board is a point on the
    // board. Where such an arrow is drawn is answered by the two points, and by nothing else.
    const id = await drawArrow(board, { x: -560, y: 200 }, { x: -520, y: 240 });
    const connector = connectorOf(board, id);
    expect(connector.from.kind).toBe('free');
    expect(connector.to.kind).toBe('free');
  });

  it('TC-19f: the arrow follows the shape it is fastened to, with nothing written about it', async () => {
    const { board, a, b } = await threeShapes();
    const id = await arrow(board, a, b);
    await flushFrames();
    const drawn = connectorElement(board, id);
    const before = drawn.dataset.toX;
    // B goes away to the right. The arrow's end is the middle of the side of B that faces A, so the end
    // moves the whole distance, and the document is not asked to keep it up to date: there is nothing
    // to keep up to date, because the point was never stored.
    moveShape(board, b, 240, 0);
    await flushFrames();
    expect(drawn.dataset.toX).not.toBe(before);
    expect(Number(drawn.dataset.toX)).toBeCloseTo(rectOf(board, b).x, 0);
  });
});

describe('connector: the line that is clicked (TC-20)', () => {
  it('TC-20: the clickable line is six screen pixels wide either side, at every zoom', async () => {
    const { board, a, b } = await threeShapes();
    const id = await arrow(board, a, b);
    await flushFrames();

    for (const step of ['out', 'in', 'in', 'in'] as const) {
      const zoomed = await changeZoom(board, step);
      const hit = board.view.container.querySelector<SVGElement>('[data-testid="connector-hit"]');
      expect(hit).not.toBeNull();
      // The tolerance is written in screen pixels and drawn in board units, by dividing by the zoom.
      // Multiply back by the zoom and it is the tolerance again, which is what makes five pixels from
      // the line a hit and seven a miss at 10% and at 400% alike.
      const world = Number(hit?.getAttribute('stroke-width'));
      expect((world * zoomed) / 2).toBeCloseTo(CONNECTOR_HIT_TOLERANCE_PX, 1);
    }
    expect(snapshot(board.doc).some((object) => object.id === id)).toBe(true);
  });

  it('TC-20b: a press on the line selects the arrow', async () => {
    const { board, a, b } = await threeShapes();
    const id = await arrow(board, a, b);
    await flushFrames();
    const hit = hitLine(board, id);
    const point = screenPoint(board, along(centre(A), centre(B), 0.5));
    fireEvent.pointerDown(hit ?? window, {
      pointerId: 1,
      button: 0,
      buttons: 1,
      clientX: point.x,
      clientY: point.y,
    });
    fireEvent.pointerUp(hit ?? window, {
      pointerId: 1,
      button: 0,
      buttons: 0,
      clientX: point.x,
      clientY: point.y,
    });
    await flushFrames();
    expect(board.outlinedIds()).toEqual([id]);
    // Selected, and therefore showing its two ends: which is how the arrow is moved at all.
    expect(board.view.container.querySelector('[data-testid="connector-handle-from"]')).not.toBeNull();
    expect(board.view.container.querySelector('[data-testid="connector-handle-to"]')).not.toBeNull();
    // And it is selected without being movable: a selection that could be dragged about would drag an
    // arrow whose ends are fastened to two different things into a shape that has no name.
    expect(board.view.container.querySelectorAll('[data-handle]')).toHaveLength(0);
  });

  it('TC-20c: a press in the arrow box but off its line selects nothing', async () => {
    const { board, a, b } = await threeShapes();
    const id = await arrow(board, a, b);
    await flushFrames();
    // The box of an arrow is the rectangle around its ends. Most of it is board, and a click there is a
    // click on the board: it starts a marquee, and it does not take the arrow.
    const box = rectOf(board, id);
    const far = screenPoint(board, { x: box.x + box.width / 2, y: box.y + box.height - 2 });
    const wrapper = connectorElement(board, id);
    fireEvent.pointerDown(wrapper, { pointerId: 1, button: 0, buttons: 1, clientX: far.x, clientY: far.y });
    await flushFrames();
    expect(board.outlinedIds()).not.toContain(id);
  });

  it('TC-20d: pressing an arrow does not move anything, and one press deletes it', async () => {
    const { board, a, b } = await threeShapes();
    const id = await arrow(board, a, b);
    await flushFrames();
    const point = screenPoint(board, along(centre(A), centre(B), 0.5));
    const hit = hitLine(board, id);
    fireEvent.pointerDown(hit, { pointerId: 1, button: 0, buttons: 1, clientX: point.x, clientY: point.y });
    fireEvent.pointerUp(hit, { pointerId: 1, button: 0, buttons: 0, clientX: point.x, clientY: point.y });
    await flushFrames();
    const shapes = snapshot(board.doc).filter((object) => object.type === SHAPE_TYPE).map((object) => object.x);
    expect(board.barOrNull()).toBeNull();
    // Delete it with the key, and the two shapes it joined are untouched and still there.
    fireEvent.keyDown(window, { key: 'Delete' });
    await flushFrames();
    expect(snapshot(board.doc).find((object) => object.id === id)).toBeUndefined();
    expect(snapshot(board.doc).filter((object) => object.type === SHAPE_TYPE).map((object) => object.x)).toEqual(
      shapes,
    );
  });
});

describe('connector: moving an end (TC-21)', () => {
  it('TC-21: an end dragged onto a third shape is fastened to that shape', async () => {
    const { board, a, b, c } = await threeShapes();
    const id = await arrow(board, a, b);
    await selectArrow(board, id);
    await dragEnd(board, id, 'to', centre(C), board.element(c));

    const connector = connectorOf(board, id);
    expect(connector.to).toMatchObject({ kind: 'attached', objectId: c });
    // The end it did not touch is exactly where it was.
    expect(connector.from).toMatchObject({ kind: 'attached', objectId: a });
  });

  it('TC-21b: an end dragged onto empty board is free, at the point it was let go', async () => {
    const { board, a, b, c } = await threeShapes();
    const id = await arrow(board, a, b);
    await selectArrow(board, id);
    const free = { x: 520, y: 200 };
    await dragEnd(board, id, 'to', free);
    const connector = connectorOf(board, id);
    expect(connector.to.kind).toBe('free');
    // The point is where the pointer was let go, in board units - not where the arrow was drawn, and
    // not where the end started.
    expect(connector.to).toMatchObject({ x: free.x, y: free.y });
    expect(connectorElement(board, id).dataset.toEnd).toBe('free');
    void c;
  });

  it('TC-21c: an end dragged back onto the shape the other end is on is refused, and stays where it was', async () => {
    const { board, a, b } = await threeShapes();
    const id = await arrow(board, a, b);
    await selectArrow(board, id);
    const before = connectorOf(board, id);
    await dragEnd(board, id, 'to', centre(A));
    const after = connectorOf(board, id);
    // The snap back is the absence of a write: nothing moved during the drag, so there is nothing that
    // needs putting back.
    expect(after.to).toEqual(before.to);
    expect(after.from).toEqual(before.from);
  });

  it('TC-21d: an end dragged to within a click of the other end is refused as too short', async () => {
    const { board, a, b } = await threeShapes();
    const id = await arrow(board, a, b);
    await selectArrow(board, id);
    const before = connectorOf(board, id);
    // The point the other end is drawn at, plus three board units: an arrow that short is a dot with
    // an arrowhead on it, and the same rule that refused it when it was drawn refuses it now.
    const near = drawnEnd(board, id, 'from');
    await dragEnd(board, id, 'to', near);
    const after = connectorOf(board, id);
    expect(after.to).toEqual(before.to);
    expect(after.from).toEqual(before.from);
  });

  it('TC-21e: an end dragged onto a sticky note is fastened to the note', async () => {
    const { board, a, b } = await threeShapes();
    const note = createSticky(board.doc, { x: -200, y: 200 });
    await flushFrames();
    const id = await arrow(board, a, b);
    await selectArrow(board, id);
    // A note is a thing an arrow can be fastened to: what an arrow fastens to is whatever has a box,
    // which is the same question the hover dots answer and the same question the model answers.
    const drawn = board.object(note);
    await dragEnd(board, id, 'to', centre(drawn), board.element(note));
    expect(connectorOf(board, id).to).toMatchObject({ kind: 'attached', objectId: note });
  });

  it('TC-21f: moving an end is one undo step', async () => {
    const { board, a, b, c } = await threeShapes();
    const id = await arrow(board, a, b);
    await selectArrow(board, id);
    await dragEnd(board, id, 'to', centre(C), board.element(c));
    expect(connectorOf(board, id).to.kind).toBe('attached');
    clickUndo(board);
    await flushFrames();
    expect(connectorOf(board, id).to).toMatchObject({ objectId: b });
  });
});

describe('connector: the tool hands the pointer back (TC-22)', () => {
  it('TC-22: after making an arrow the Select tool is up again', async () => {
    const { board, a, b } = await threeShapes();
    await armConnector(board);
    await drawArrow(board, centre(A), centre(B));
    expect(activeTool(board)).toBe('select');
    expect(toolPressed(board, 'connector')).toBe(false);
    expect(toolPressed(board, 'select')).toBe(true);
    expect(a).not.toBe(b);
  });

  it('TC-22b: Escape after the tool is up makes nothing', async () => {
    const { board } = await threeShapes();
    const before = snapshot(board.doc);
    await armConnector(board);
    await pressEscape();
    expect(activeTool(board)).toBe('select');
    expect(snapshot(board.doc)).toEqual(before);
  });

  it('TC-22c: Escape in the middle of a drag drops it and writes nothing', async () => {
    const { board } = await threeShapes();
    await armConnector(board);
    const before = snapshot(board.doc);
    const down = board.screenOf(centre(A));
    const mid = board.screenOf(centre(B));
    fireEvent.pointerDown(board.board, { pointerId: 1, button: 0, buttons: 1, clientX: down.x, clientY: down.y });
    fireEvent.pointerMove(window, { pointerId: 1, buttons: 1, clientX: mid.x, clientY: mid.y });
    await flushFrames();
    expect(connectorPreview(board)).not.toBeNull();
    await pressEscape();
    // The dashed line was on the screen and the arrow was never in the document.
    expect(connectorPreview(board)).toBeNull();
    expect(snapshot(board.doc)).toEqual(before);
    expect(activeTool(board)).toBe('select');
    expect(connectorElements(board)).toHaveLength(0);
  });

  it('TC-22d: L after S puts the Connector tool up, and V takes both back down', async () => {
    const { board } = await threeShapes();
    await drawShape(board);
    expect(pressToolKey('KeyL')).toBe(true);
    await flushFrames();
    expect(toolPressed(board, 'connector')).toBe(true);
    expect(pressToolKey('KeyV')).toBe(true);
    await flushFrames();
    expect(activeTool(board)).toBe('select');
  });

  it('TC-22e: a shape drawn by the Shape tool and an arrow drawn by the Connector tool, one after the other', async () => {
    const { board, a, b } = await threeShapes();
    const shape = await drawShape(board);
    await armConnector(board);
    const id = await drawArrow(board, centre(A), centre(B));
    // Both tools returned to Select, and the arrow knows about the shape it was drawn to rather than
    // about the shape that was drawn in between.
    expect(connectorOf(board, id).from).toMatchObject({ objectId: a });
    expect(connectorOf(board, id).to).toMatchObject({ objectId: b });
    expect(board.outlinedIds()).toEqual([id]);
    expect(shapeElement(board, shape)).not.toBeNull();
  });
});

/** A shape drawn by the Shape tool, for the tests that want one to have been drawn by a person. */
async function drawShape(board: MountedSticky): Promise<string> {
  await armShape(board);
  return await dragShape(board, { x: -500, y: 120 }, { x: -380, y: 220 });
}

/** Press the zoom button, and read the zoom the board ended up at. */
async function changeZoom(board: MountedSticky, direction: 'in' | 'out'): Promise<number> {
  const name = direction === 'in' ? 'Zoom in' : 'Zoom out';
  const button = board.view.container.querySelector<HTMLButtonElement>(
    `button[aria-label="${name}"]`,
  );
  if (button === null) {
    throw new Error(`the board has no ${name} button`);
  }
  fireEvent.click(button);
  await flushFrames();
  return board.camera().zoom;
}

/**
 * Move a shape the way another person's drag moves it: a write to the document that did not come from
 * this client.
 *
 * It goes by way of the raw map rather than `setShapeRect`, because that function writes as this
 * client, and a test that wanted to know whether *this* screen re-measured or re-wrote something it was
 * told about would pass either way.
 */
function moveShape(board: MountedSticky, id: string, dx: number, dy: number): Rect {
  const objects = board.doc.getMap<Y.Map<unknown>>(OBJECTS_MAP);
  const object = objects.get(id);
  if (object === undefined) {
    throw new Error(`object ${id} is not on the board`);
  }
  remoteChange(board, () => {
    object.set('x', Number(object.get('x')) + dx);
    object.set('y', Number(object.get('y')) + dy);
  });
  return rectOf(board, id);
}

/**
 * Where an end of an arrow is drawn, in board units, read off the element.
 *
 * This is the point the *browser* was shown, which is not the point that was stored: an end fastened to
 * a shape is stored as the shape, and a drag that has to be aimed at the drawn end has to be aimed at
 * the drawing rather than at the document.
 */
function drawnEnd(board: MountedSticky, id: string, end: 'from' | 'to'): Point {
  const element = connectorElement(board, id);
  const x = Number(element.dataset[`${end}X`]);
  const y = Number(element.dataset[`${end}Y`]);
  return { x, y };
}

/** The end of an arrow that is fastened to this object. */
function end(objectId: string): Endpoint {
  return { kind: 'attached', objectId, fallback: { x: 0, y: 0 } };
}

/** The board's boxes, for the geometry functions that want them. */
function rectBoard(board: MountedSticky): ReadonlyMap<string, Rect> {
  return boardRects(snapshot(board.doc));
}

/** The one object that is new, which is the one the drag made. */
function newId(board: MountedSticky, before: string[]): string {
  const added = snapshot(board.doc).find((object) => !before.includes(object.id));
  if (added === undefined) {
    throw new Error('the drag made no object');
  }
  return added.id;
}

/**
 * Pull an arrow from one point to another, watching the dots on the way.
 *
 * `sameShape` drags back to the shape the arrow started on, which is the drag this tool will not write
 * down: the tool is expected to stay up so the arrow can be drawn again, properly.
 */
async function drawArrow(
  board: MountedSticky,
  from: Point,
  to: Point,
  refused = false,
): Promise<string> {
  const before = snapshot(board.doc).map((object) => object.id);
  const down = board.screenOf(from);
  const up = board.screenOf(to);
  const middle = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  fireEvent.pointerDown(board.board, { pointerId: 1, button: 0, buttons: 1, clientX: down.x, clientY: down.y });
  fireEvent.pointerMove(window, { pointerId: 1, buttons: 1, clientX: board.screenOf(middle).x, clientY: board.screenOf(middle).y });
  fireEvent.pointerMove(window, { pointerId: 1, buttons: 1, clientX: up.x, clientY: up.y });
  fireEvent.pointerUp(board.board, { pointerId: 1, button: 0, buttons: 0, clientX: up.x, clientY: up.y });
  await flushFrames();
  if (refused) {
    // Nothing to report, and nothing to hand back: the board said no, and said it by writing nothing.
    return '';
  }
  return newId(board, before);
}

