// An arrow that follows the things it joins (`connector.ui`, `connector.attach`,
// `connector.reattach`).
//
// An arrow is the one object on this board with no position of its own, so everything here
// is about where it is *drawn* rather than what is stored: the points are read back off the
// line on the screen and compared with the box of the object the end is attached to. That is
// the feature in one sentence - the stored numbers never change and the drawn ends move with
// the shapes - and it is exactly the thing a test of a geometry function cannot show.
//
// Two things the driver does that are worth naming: a drag with a drawing tool up goes to
// the tool's sheet, which is the element a browser hands the pointer to; a drag on a shape
// with the select tool up goes to the shape, because that is a move.
//
// Spec: spec/stories/010-draw-shapes-and-connect-them-with-arrows-that-foll/design.md
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, screen, within } from '@testing-library/react';
import {
  CONNECTOR_ARROWHEAD_SIZE_WORLD,
  CONNECTOR_DOT_RADIUS_PX,
  CONNECTOR_HIT_TOLERANCE_PX,
} from '../../src/shared/config';
import { objectBounds } from '../../src/shared/board-model';
import { getObjectType } from '../../src/client/objects/registry';
import { connectorHitWidthWorld } from '../../src/shared/objects/connector';
import type { ConnectorSnapshot } from '../../src/shared/objects/connector';
import type * as Y from 'yjs';
import type { Point } from '../../src/client/canvas/camera';
import { worldToScreen } from '../../src/client/canvas/camera';
import {
  attachedTo,
  camera,
  centreOf,
  connectorDots,
  connectorElement,
  connectorEnd,
  connectorIds,
  connectorObject,
  connectorPreview,
  connectorSheet,
  connectorToolActive,
  doc,
  drawConnector,
  drag,
  dragConnectorHandle,
  FakeWebsocketProvider,
  flush,
  makeConnector,
  makeShape,
  objectById,
  open,
  pressConnectorTool,
  pressEscape,
  selectedConnectorIds,
  selectToolActive,
  setCameraTo,
  shapeBox,
  shapeElement,
  shapeIds,
} from './helpers/shape-ui';

vi.mock('y-websocket', async () => {
  const module = await import('./helpers/fake-provider');
  return { WebsocketProvider: module.FakeWebsocketProvider };
});

const BOARD_ID = 'connector-ui-under-test';

beforeEach(() => {
  vi.useFakeTimers();
  FakeWebsocketProvider.reset();
  open(BOARD_ID);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Two shapes side by side with an arrow between them: what most of these tests start with. */
function scenery(): { left: string; right: string; arrow: string } {
  const left = makeShape({ x: -420, y: -220 });
  const right = makeShape({ x: 60, y: -220 });
  const arrow = makeConnector(
    { kind: 'attached', objectId: left },
    { kind: 'attached', objectId: right },
  );
  return { left, right, arrow };
}

describe('connector.ui', () => {
  // TC-18
  it('draws an arrow from the edge of one thing to the edge of the next', () => {
    const { left, right, arrow } = scenery();

    // Where it is drawn, read off the screen.
    const drawn = drawnEnds(arrow);
    expect(drawn.from).toEqual(rightEdge(left));
    expect(drawn.to).toEqual(leftEdge(right));

    // The head's point is the far end, and the line stops where the head's back edge is,
    // so the point stands at the end instead of the line running on into the shape.
    const line = within(connectorElement(arrow)).getByTestId('connector-line');
    expect({ x: Number(line.getAttribute('x2')), y: Number(line.getAttribute('y2')) }).toEqual({
      x: drawn.to.x - CONNECTOR_ARROWHEAD_SIZE_WORLD,
      y: drawn.to.y,
    });
    expect(within(connectorElement(arrow)).getByTestId('connector-arrowhead')).toBeTruthy();
  });

  // TC-19
  it('follows a shape that moves, without the arrow being rewritten', () => {
    const { right, arrow } = scenery();
    const before = drawnEnds(arrow);
    const stored = storedEnds(arrow);

    // A real drag of the shape the arrow points at, with the select tool up.
    drag(shapeElement(right), centreOf(right), { x: centreOf(right).x + 240, y: centreOf(right).y + 120 });

    const after = drawnEnds(arrow);
    expect(after.to).toEqual(leftEdge(right));
    expect(after.to).not.toEqual(before.to);
    // The end that points at the shape nobody touched has not moved.
    expect(after.from).toEqual(before.from);
    // ... and nothing was written to the arrow at all, because there is nothing it could
    // store that would have to change: it is drawn from what it is attached to, which is
    // why following costs no operations and needs no sync of its own.
    expect(storedEnds(arrow)).toBe(stored);
  });

  // The same thing from the other side: an arrow is tied to the nearest edge, not to centres.
  it('keeps each end on the edge nearest the other end', () => {
    const above = makeShape({ x: -100, y: -400 });
    const below = makeShape({ x: -100, y: 0 });
    const arrow = makeConnector(
      { kind: 'attached', objectId: above },
      { kind: 'attached', objectId: below },
    );

    // Straight down the screen: the bottom edge of the top one, the top edge of the bottom one.
    expect(drawnEnds(arrow).from).toEqual(bottomEdge(above));
    expect(drawnEnds(arrow).to).toEqual(topEdge(below));

    // Carry the lower shape up past the other, and the ends change sides on their own.
    drag(shapeElement(below), centreOf(below), { x: -100, y: -640 });
    expect(drawnEnds(arrow).from).toEqual(topEdge(above));
    expect(drawnEnds(arrow).to).toEqual(bottomEdge(below));
  });

  it('gives a free end the point it was left at, and no more', () => {
    const shape = makeShape({ x: -300, y: -200 });
    const away: Point = { x: 200, y: 60 };
    const arrow = makeConnector({ kind: 'attached', objectId: shape }, { kind: 'free', ...away });

    expect(connectorEnd(arrow, 'to')).toEqual({ kind: 'free', x: 200, y: 60 });
    expect(drawnEnds(arrow).to).toEqual(away);
    // The end that is attached still follows its shape; the one that is not, does not.
    const before = drawnEnds(arrow);
    drag(shapeElement(shape), centreOf(shape), { x: -300, y: 100 });
    const after = drawnEnds(arrow);
    expect(after.to).toEqual(away);
    expect(after.from).toEqual(rightEdge(shape));
    expect(after.from).not.toEqual(before.from);
  });

  it('leaves the arrow on the board with its end let go where the shape was', () => {
    const { left, right, arrow } = scenery();
    const where = drawnEnds(arrow);

    // Delete the way a person does it: select the shape, press Delete, and watch after.
    press(shapeElement(left), worldToScreen(camera(), centreOf(left)));
    pressDeleteKey();

    // An arrow is not something you lose by deleting what it pointed at: the end is put
    // down at the edge it was drawn from, and the arrow is drawn where it always was.
    expect(connectorIds()).toEqual([arrow]);
    expect(connectorEnd(arrow, 'from')).toMatchObject({ kind: 'free' });
    expect(objectById(left)).toBeUndefined();
    expect(drawnEnds(arrow)).toEqual(where);
    expect(screen.queryAllByTestId('connector-object')).toHaveLength(1);
    expect(objectById(right)).toBeTruthy();
    // Undo brings the shape back underneath it, in one step.
    pressBoardUndo();
    expect(objectById(left)).toBeTruthy();
  });
});

describe('connector.hover_points', () => {
  // TC-18
  it('TC-18 shows the four sides of the shape the pointer is over', () => {
    const shape = makeShape({ x: -420, y: -220 }, { width: 200, height: 120 });
    const updates = watchUpdates();
    pressConnectorTool();

    // Nothing is offered while the pointer is over bare board: the dots answer a question
    // nobody has asked yet.
    hoverSheet({ x: 400, y: 300 });
    expect(dots()).toEqual([]);

    hoverSheet(centreOf(shape));
    const box = boxOf(shape);
    expect(dots().map((dot) => dot.dataset.side)).toEqual(['top', 'right', 'bottom', 'left']);
    // Each one at the midpoint of a side, which is where an end would be tied.
    expect(dotScreen('top')).toEqual(onScreen({ x: box.x + box.width / 2, y: box.y }));
    expect(dotScreen('right')).toEqual(onScreen({ x: box.x + box.width, y: box.y + box.height / 2 }));
    expect(dotScreen('bottom')).toEqual(onScreen({ x: box.x + box.width / 2, y: box.y + box.height }));
    expect(dotScreen('left')).toEqual(onScreen({ x: box.x, y: box.y + box.height / 2 }));
    expect(dots().every((dot) => dot.getAttribute('r') === String(CONNECTOR_DOT_RADIUS_PX))).toBe(
      true,
    );
    // Merely hovering chooses nothing: there is no other end yet, so no side is nearer than
    // any other. And nothing is written by pointing.
    expect(litDots()).toEqual([]);
    expect(updates()).toBe(0);

    hoverSheet({ x: 400, y: 300 });
    expect(dots()).toEqual([]);
    expect(updates()).toBe(0);
  });

  // TC-19
  it('TC-19 lights the side the end would go to, and lets go into an arrow', () => {
    const left = makeShape({ x: -420, y: -220 });
    const right = makeShape({ x: 60, y: -220 });
    pressConnectorTool();

    dragSheetPartway(centreOf(left), { x: centreOf(right).x - 40, y: centreOf(right).y });

    // The pointer is over the second shape, so its four sides are shown, and the one this
    // arrow would really take — the side nearest the other end — is the one that is lit.
    expect(dots().map((dot) => dot.dataset.side)).toEqual(['top', 'right', 'bottom', 'left']);
    expect(litDots()).toEqual(['left']);
    expect(dotScreen('left')).toEqual(onScreen(leftEdge(right)));

    releaseSheet(centreOf(right));
    const arrow = onlyConnector();
    expect(attachedTo(arrow, 'from')).toBe(left);
    expect(attachedTo(arrow, 'to')).toBe(right);
    expect(connectorPreview()).toBeNull();
  });

  // The lit side is worked out and not guessed: it moves with the other end.
  it('TC-19 lights whichever side the other end is nearest to', () => {
    const right = makeShape({ x: 60, y: -220 });
    pressConnectorTool();

    // Aim from below the second shape: its bottom is now the near side.
    dragSheetPartway(
      { x: centreOf(right).x + 20, y: centreOf(right).y + 300 },
      { x: centreOf(right).x, y: centreOf(right).y },
    );
    expect(litDots()).toEqual(['bottom']);
    expect(dotScreen('bottom')).toEqual(onScreen(bottomEdge(right)));
    releaseSheet(centreOf(right));
    expect(connectorIds()).toHaveLength(1);
  });
});

describe('connector.orphaned', () => {
  // The end that outlived its object: still stored as attached, drawn where it was tied.
  it('draws an end whose object is gone at the point it was tied to', () => {
    const shape = makeShape({ x: 60, y: -220 });
    const arrow = makeConnector(
      { kind: 'attached', objectId: 'a-shape-that-is-not-here', fallback: { x: -220, y: -120 } },
      { kind: 'attached', objectId: shape },
    );

    // One end's object is missing and the arrow does not care: that end is drawn at the
    // point it remembers, the other at the edge of the shape that is still there.
    expect(connectorEnd(arrow, 'from')).toMatchObject({ kind: 'attached' });
    expect(objectById('a-shape-that-is-not-here')).toBeUndefined();
    const drawn = drawnEnds(arrow);
    expect(drawn.from).toEqual({ x: -220, y: -120 });
    expect(drawn.to).toEqual(leftEdge(shape));
  });
});

describe('connector.hit', () => {
  // TC-20
  it('TC-20 gives a 6 pixel target at half zoom, and the same 6 pixels at double', () => {
    const { arrow } = scenery();
    const spec = getObjectType('connector');
    if (!spec?.hitTest) throw new Error('an arrow has no hit rule');

    for (const zoom of [0.5, 1, 2]) {
      setCameraTo(zoom);
      const object = connectorObject(arrow);
      const middle = midpointOf(object);

      // Screen pixels, because that is what a person aims with: half a pixel inside the
      // tolerance is a hit, half a pixel outside it is not. The board hands the hit rule the
      // zoom it is drawing at, which is what makes six pixels six pixels at any zoom.
      const inside = below(middle, (CONNECTOR_HIT_TOLERANCE_PX - 0.5) / zoom);
      const outside = below(middle, (CONNECTOR_HIT_TOLERANCE_PX + 0.5) / zoom);
      expect(spec.hitTest(object, inside, zoom)).toBe(true);
      expect(spec.hitTest(object, outside, zoom)).toBe(false);

      // And the drawn target is that wide on the screen at every zoom: the sleeve is drawn
      // in board units, which is what keeps it 12 pixels across however far you are out.
      const sleeve = within(connectorElement(arrow)).getByTestId('connector-hit');
      const width = Number(sleeve.getAttribute('stroke-width'));
      expect(width * zoom).toBeCloseTo(CONNECTOR_HIT_TOLERANCE_PX * 2, 6);
      expect(width).toBeCloseTo(connectorHitWidthWorld(zoom), 6);
    }
  });

  it('is selected by a click on the line rather than by a click beside it', () => {
    const { arrow } = scenery();
    expect(selectedConnectorIds()).toEqual([]);

    clickOnLine(arrow);
    expect(selectedConnectorIds()).toEqual([arrow]);

    // A click well away from it is a click on the board, and the selection clears.
    clickOnBoard({ x: 400, y: 300 });
    expect(selectedConnectorIds()).toEqual([]);
  });

  it('TC-20 does not let a shape underneath it lose out', () => {
    // An arrow laid across a shape: the arrow is drawn over the shapes, but a click in the
    // middle of the shape is a click on the shape, because the target is thin on purpose.
    const shape = makeShape({ x: -200, y: -150 });
    const arrow = makeConnector({ kind: 'free', x: -420, y: -50 }, { kind: 'free', x: 220, y: -50 });
    expect(drawnEnds(arrow).from).toEqual({ x: -420, y: -50 });

    // A click in the middle of the shape: the shape takes it, and the arrow over it is not
    // selected. The target is 12 pixels across, which is the whole reason a click in the
    // middle of a 200 unit shape is not stolen by an arrow laid across it.
    press(shapeElement(shape), worldToScreen(camera(), centreOf(shape)));
    expect(shapeElement(shape).dataset.selected).toBe('true');
    expect(connectorElement(arrow).dataset.selected).toBe('false');
  });
});

describe('connector.attach', () => {
  // TC-21's tool half: an arrow that comes of a drag knows what it is joined to.
  it('TC-21 attaches both ends to whatever was under them', () => {
    const left = makeShape({ x: -420, y: -220 });
    const right = makeShape({ x: 60, y: -220 });

    const arrow = drawConnector(centreOf(left), centreOf(right));

    if (arrow === null) throw new Error('a drag between two shapes made no arrow');
    expect(attachedTo(arrow, 'from')).toBe(left);
    expect(attachedTo(arrow, 'to')).toBe(right);
    // An attached end keeps the object's id, plus the point it was attached at for the case
    // where that object is gone tomorrow: where the pointer happened to be is not stored.
    expect(connectorEnd(arrow, 'to')).toMatchObject({ kind: 'attached', objectId: right });
    // And it is drawn between the two shapes, not between the two pointer positions.
    expect(drawnEnds(arrow).from).toEqual(rightEdge(left));
    expect(drawnEnds(arrow).to).toEqual(leftEdge(right));
  });

  // A drag that starts and ends on one object is not an arrow.
  it('TC-21 makes nothing when both ends would be the same thing', () => {
    const shape = makeShape({ x: -300, y: -200 });

    expect(drawConnector({ x: -300, y: -200 }, { x: -200, y: -120 })).toBeNull();
    expect(connectorIds()).toHaveLength(0);
    // Nothing was made, so the tool is still up and the board is unchanged: a drag that
    // came to nothing is not a reason to send somebody back to the select tool.
    expect(connectorToolActive()).toBe(true);
    expect(shapeBox(shape)).toEqual({ x: -300, y: -200, width: 200, height: 200 });
    expect(shapeIds()).toHaveLength(1);

    pressEscape();
    expect(connectorToolActive()).toBe(false);
  });

  it('TC-21 leaves a free end where the drag was let go over empty board', () => {
    const shape = makeShape({ x: -300, y: -200 });
    const away = { x: 260, y: 120 };

    const arrow = drawConnector(centreOf(shape), away);
    if (arrow === null) throw new Error('a drag from a shape to empty board made no arrow');

    expect(attachedTo(arrow, 'from')).toBe(shape);
    expect(connectorEnd(arrow, 'to')).toEqual({ kind: 'free', x: away.x, y: away.y });
    expect(drawnEnds(arrow).to).toEqual(away);
    // The shape's own numbers are untouched: a drag that starts on a shape with the arrow
    // tool up is not a move, which is TC-28 again from the other side.
    expect(shapeBox(shape)).toEqual({ x: -300, y: -200, width: 200, height: 200 });
  });

  it('draws the arrow it is going to make before it makes it', () => {
    const left = makeShape({ x: -420, y: -220 });
    const right = makeShape({ x: 60, y: -220 });

    pressConnectorTool();
    dragSheetPartway(centreOf(left), centreOf(right));

    // The four sides of what the pointer can attach to, where they are on the screen.
    expect(connectorDots().map((dot: HTMLElement) => dot.dataset.side).sort()).toEqual(
      ['bottom', 'left', 'right', 'top'].sort(),
    );
    expect(connectorPreview()).not.toBeNull();
    // Nothing written to the document yet: the arrow is drawn before it exists.
    expect(connectorIds()).toHaveLength(0);

    releaseSheet(centreOf(right));
    expect(connectorIds()).toHaveLength(1);
    expect(connectorPreview()).toBeNull();
  });

  it('TC-21 puts the tool down after it has drawn one, and goes back on Escape', () => {
    const left = makeShape({ x: -420, y: -220 });
    const right = makeShape({ x: 60, y: -220 });
    const arrow = drawConnector(centreOf(left), centreOf(right));
    if (arrow === null) throw new Error('no arrow came of the drag');

    // Like every other tool: one arrow, then the select tool is back with the arrow chosen.
    expect(connectorToolActive()).toBe(false);
    expect(selectToolActive()).toBe(true);
    expect(selectedConnectorIds()).toEqual([arrow]);

    pressConnectorTool();
    pressEscape();
    expect(connectorToolActive()).toBe(false);
    expect(selectToolActive()).toBe(true);
  });
});

describe('connector.reattach', () => {
  // TC-21's handle half.
  it('TC-21 moves one end of an arrow onto another thing', () => {
    const { left, right, arrow } = scenery();
    const third = makeShape({ x: -180, y: 180 });
    clickOnLine(arrow);
    expect(selectedConnectorIds()).toEqual([arrow]);

    // Both ends are on the screen once the arrow is the selection.
    expect(handle(arrow, 'from')).toBeTruthy();
    expect(handle(arrow, 'to')).toBeTruthy();

    dragConnectorHandle(arrow, 'to', centreOf(third));

    expect(attachedTo(arrow, 'to')).toBe(third);
    expect(attachedTo(arrow, 'from')).toBe(left);
    expect(drawnEnds(arrow).to).toEqual(nearestEdgeOf(third, drawnEnds(arrow).from));

    // Undo puts the arrow back where it was, in one step.
    pressBoardUndo();
    expect(attachedTo(arrow, 'to')).toBe(right);
    expect(drawnEnds(arrow).to).toEqual(leftEdge(right));
  });

  // An end cannot be taken to the object the other end is already on: that is an arrow
  // pointing at itself, and it is refused rather than drawn as a dot.
  it('TC-21 refuses an end dragged onto the thing its other end is on', () => {
    const { left, right, arrow } = scenery();
    clickOnLine(arrow);

    dragConnectorHandle(arrow, 'to', centreOf(left));

    expect(attachedTo(arrow, 'to')).toBe(right);
    expect(connectorIds()).toHaveLength(1);
  });

  it('TC-21 puts an end on the board where it was let go, in one update', () => {
    const { left, right, arrow } = scenery();
    const third = makeShape({ x: -180, y: 120 });
    const updates = watchUpdates();

    clickOnLine(arrow);
    dragConnectorHandle(arrow, 'to', centreOf(third));
    expect(attachedTo(arrow, 'to')).toBe(third);
    const afterTheShape = updates();

    // Off the shape and onto bare board: the end is where the pointer was, to the unit,
    // because that is the only thing a free end can mean.
    dragConnectorHandle(arrow, 'to', { x: -600, y: 40 });
    expect(connectorEnd(arrow, 'to')).toMatchObject({ kind: 'free', x: -600, y: 40 });
    expect(drawnEnds(arrow).to).toEqual({ x: -600, y: 40 });
    expect(updates()).toBe(afterTheShape + 1);
    // The end that was never touched is still tied to the shape it was tied to.
    expect(attachedTo(arrow, 'from')).toBe(left);
    expect(right).toBeTruthy();
  });

  it('TC-21 lets an end go to empty board instead', () => {
    const { arrow } = scenery();
    clickOnLine(arrow);

    dragConnectorHandle(arrow, 'from', { x: 300, y: 300 });

    expect(connectorEnd(arrow, 'from')).toEqual({ kind: 'free', x: 300, y: 300 });
    expect(drawnEnds(arrow).from).toEqual({ x: 300, y: 300 });
  });

  it('hides its handles while the selection is not the arrow', () => {
    const { arrow } = scenery();
    expect(screen.queryAllByTestId('connector-handle-from')).toHaveLength(0);
    clickOnLine(arrow);
    expect(within(connectorElement(arrow)).queryAllByTestId('connector-handle-from')).toHaveLength(1);

    clickOnBoard({ x: 500, y: 320 });
    expect(screen.queryAllByTestId('connector-handle-from')).toHaveLength(0);
  });
});

// --- reading the screen ------------------------------------------------------

/** Where an arrow is drawn, read off the drawn target's own ends. */
function drawnEnds(id: string): { from: Point; to: Point } {
  const sleeve = within(connectorElement(id)).getByTestId('connector-hit');
  const ends = (sleeve.getAttribute('points') ?? '').trim().split(/\s+/);
  if (ends.length !== 2) throw new Error(`arrow "${id}" draws no line`);
  const point = (text: string): Point => {
    const [x, y] = text.split(',').map(Number);
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`"${text}" is not a point`);
    return { x: x as number, y: y as number };
  };
  return { from: point(ends[0] as string), to: point(ends[1] as string) };
}

const boxOf = (id: string): { x: number; y: number; width: number; height: number } => {
  const object = objectById(id);
  if (!object) throw new Error(`"${id}" is not on the board`);
  return objectBounds(object);
};

const rightEdge = (id: string): Point => ({ x: boxOf(id).x + boxOf(id).width, y: boxOf(id).y + boxOf(id).height / 2 });
const leftEdge = (id: string): Point => ({ x: boxOf(id).x, y: boxOf(id).y + boxOf(id).height / 2 });
const topEdge = (id: string): Point => ({ x: boxOf(id).x + boxOf(id).width / 2, y: boxOf(id).y });
const bottomEdge = (id: string): Point => ({ x: boxOf(id).x + boxOf(id).width / 2, y: boxOf(id).y + boxOf(id).height });

/** The edge of `id` nearest `other`: the side an arrow leaves that shape from. */
function nearestEdgeOf(id: string, other: Point): Point {
  const edges = [leftEdge(id), rightEdge(id), topEdge(id), bottomEdge(id)];
  return edges.reduce((best, edge) => (distance(edge, other) < distance(best, other) ? edge : best));
}

const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

/** The middle of an arrow's own box, in board units. */
function midpointOf(connector: ConnectorSnapshot): Point {
  const box = objectBounds(connector);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** A point `world` board units below a point. */
const below = (at: Point, world: number): Point => ({ x: at.x, y: at.y + world });

const handle = (id: string, end: 'from' | 'to'): HTMLElement =>
  within(connectorElement(id)).getByTestId(`connector-handle-${end}`) as HTMLElement;

/** Press the middle of the line, which is what aiming at an arrow looks like. */
function clickOnLine(id: string): void {
  const sleeve = within(connectorElement(id)).getByTestId('connector-hit');
  press(sleeve, worldToScreen(camera(), midpointOf(connectorObject(id))));
}

/** Press the board itself. */
function clickOnBoard(at: Point): void {
  press(screen.getByTestId('board-viewport'), worldToScreen(camera(), at));
}

function pointerEvent(type: 'pointerdown' | 'pointerup', at: { x: number; y: number }): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  return Object.assign(event, {
    clientX: at.x,
    clientY: at.y,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
    buttons: type === 'pointerdown' ? 1 : 0,
    pressure: type === 'pointerdown' ? 0.5 : 0,
  });
}

/** A drag on the Connector tool's sheet, left part way: no release. */
function dragSheetPartway(from: Point, to: Point): void {
  const sheet = connectorSheet();
  const start = worldToScreen(camera(), from);
  act(() => {
    sheet.dispatchEvent(pointerEvent('pointerdown', start));
  });
  flush();
  // The press is committed before the move is dispatched, because that is how a browser
  // sends them: one turn of the event loop each. A test that put both in one turn would be
  // reading the sheet's state from before the press and calling it the drag.
  act(() => {
    sheet.dispatchEvent(moveEvent(worldToScreen(camera(), to)));
  });
  flush();
}

function releaseSheet(to: Point): void {
  const sheet = connectorSheet();
  act(() => {
    sheet.dispatchEvent(pointerEvent('pointerup', worldToScreen(camera(), to)));
  });
  flush();
}

/** Move the pointer over the Connector tool's sheet without holding a button. */
function hoverSheet(at: Point): void {
  const sheet = connectorSheet();
  const spot = worldToScreen(camera(), at);
  const event = new Event('pointermove', { bubbles: true, cancelable: true });
  act(() => {
    sheet.dispatchEvent(
      Object.assign(event, {
        clientX: spot.x,
        clientY: spot.y,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
        button: -1,
        buttons: 0,
        pressure: 0,
      }),
    );
  });
  flush();
}

/** The connection points the sheet is showing, in the order the sides are drawn. */
const dots = (): HTMLElement[] =>
  Array.from(document.querySelectorAll('[data-testid^="connector-dot-"]')) as HTMLElement[];

/** The side whose dot says "here". */
const litDots = (): string[] =>
  dots()
    .filter((dot) => dot.dataset.active === 'true')
    .map((dot) => dot.dataset.side as string);

/** Where one of those dots is on the screen. */
function dotScreen(side: string): Point {
  const dot = dots().find((candidate) => candidate.dataset.side === side);
  if (!dot) throw new Error(`no dot is shown for the "${side}" side`);
  return { x: Number(dot.getAttribute('cx')), y: Number(dot.getAttribute('cy')) };
}

/** A point on the screen, from a point on the board: the screen the test is looking at. */
const onScreen = (at: Point): Point => worldToScreen(camera(), at);

/** Every write to the document from now on, counted. */
function watchUpdates(): () => number {
  let count = 0;
  doc().on('update', () => {
    count += 1;
  });
  return () => count;
}

/** The one arrow on the board, when a test asked for exactly one. */
function onlyConnector(): string {
  const ids = connectorIds();
  if (ids.length !== 1) throw new Error(`expected one arrow, found ${ids.length}`);
  return ids[0] as string;
}

function moveEvent(at: { x: number; y: number }): Event {
  const event = new Event('pointermove', { bubbles: true, cancelable: true });
  return Object.assign(event, {
    clientX: at.x,
    clientY: at.y,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
    buttons: 1,
    pressure: 0.5,
  });
}

/** The arrow's own numbers as the document holds them, not as they are drawn. */
function storedEnds(id: string): string {
  const map = doc().getMap<Y.Map<unknown>>('objects').get(id);
  if (!map) throw new Error(`"${id}" is not in the document`);
  return JSON.stringify([map.get('from'), map.get('to'), map.get('x'), map.get('y')]);
}

/** Press an element where a browser would have put the pointer. */
function press(element: Element, at: { x: number; y: number }): void {
  act(() => {
    element.dispatchEvent(pointerEvent('pointerdown', at));
    element.dispatchEvent(pointerEvent('pointerup', at));
  });
  flush();
}

/** The board's Delete key, with the selection holding what it holds. */
function pressDeleteKey(): void {
  act(() => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
  });
  flush();
}

/** The board's Undo shortcut, with nothing focused. */
function pressBoardUndo(): void {
  act(() => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
  });
  flush();
}
