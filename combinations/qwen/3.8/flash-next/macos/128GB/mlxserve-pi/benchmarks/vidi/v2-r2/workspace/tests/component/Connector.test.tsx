// connector.tool / connector.object (ui-component): drawing an arrow between two
// things, hitting one with the pointer, and dragging an end somewhere else.
//
// An arrow is the board's first object that is not a box: it has no size of its own,
// it is drawn between two places that belong to other objects, and so it cannot be
// dragged, resized or typed into. What it does have is the one behaviour the rest of
// the board is built for - it follows. Both ends are read out of the document every
// time anything changes, which is why an arrow whose object moved by itself (another
// person dragged it) moves too, without a line of code written for the case.
//
// The two measurements that decide what these tests assert are both in screen pixels,
// and so both are divided by the zoom: six pixels either side of the line is what
// "on the arrow" means, and four side dots say where an end dropped would go.

import { describe, expect, it } from 'vitest';
import { act } from '@testing-library/react';
import type * as Y from 'yjs';
import { CONNECTOR_HIT_TOLERANCE_PX, CONNECTOR_MIN_LENGTH_WORLD } from '../../src/shared/config';
import { connectorSnapshot } from '../../src/shared/objects/connector';
import { centre, nearestSide } from '../../src/shared/geometry/connector-geometry';
import type { Point, Rect } from '../../src/shared/geometry';
import {
  clickBoard,
  clickOn,
  connectorAt,
  connectorCount,
  connectorDots,
  connectorDotsBox,
  connectorEndEl,
  doubleClickOn,
  connectorHit,
  connectorToolButton,
  connectorToolLayer,
  connectorToolPreviewEl,
  dotPoint,
  flushFrames,
  holdConnectorTool,
  highlightedDot,
  mode,
  newConnector,
  newShape,
  noteCount,
  pointerOnLayer,
  pressKey,
  renderBoard,
  screenOf,
  selectedConnectors,
  shapeAt,
  shapeBox,
  shapeElements,
  shapeToolbarElement,
  readCamera,
  textToolSelectButton,
  useBoardTestLifecycle,
  worldOfScreen,
} from './helpers';

const px = (value: string): number => Number.parseFloat(value);

/** The screen point at the middle of a shape's box. */
function middle(index: number): Point {
  return screenOf(centre(shapeBox(index)));
}

/** Where a dot stands on the screen, at its centre. */
function dotCentre(side: string): Point {
  const dot = connectorDots().find((el) => el.dataset.side === side);
  if (dot === undefined) throw new Error(`no ${side} dot shown`);
  return dotPoint(dot);
}

function connectorBoxAt(index: number): Rect {
  const style = connectorAt(index).style;
  return { x: px(style.left), y: px(style.top), width: px(style.width), height: px(style.height) };
}

/** The middle of an arrow's line, on the board. */
function mid(ends: { from: Point; to: Point }): Point {
  return { x: (ends.from.x + ends.to.x) / 2, y: (ends.from.y + ends.to.y) / 2 };
}

/** Set the camera the way a test hook does, and let the board paint it. */
function setCamera(x: number, y: number, zoom: number): void {
  act(() => {
    window.__vidi6?.setCamera?.(x, y, zoom);
  });
  flushFrames();
}

/**
 * A board point `screenPixels` screen pixels off the arrow's line, square to it, at
 * `fraction` along it: the point a click at that distance from the arrow is drawn at,
 * whatever the zoom. The tolerance is a screen measurement, so the board distance it
 * is worth depends on the zoom the click happens to be made at - which is exactly
 * what TC-20 is on about.
 */
function offLine(ends: { from: Point; to: Point }, fraction: number, screenPixels: number): Point {
  const zoom = readCamera().zoom;
  const { from, to } = ends;
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const on = { x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction };
  const world = screenPixels / zoom;
  // the normal to the line, times how far off it this click is
  return { x: on.x - ((to.y - from.y) / length) * world, y: on.y + ((to.x - from.x) / length) * world };
}

// --------------------------------------------------------------------------------
// the gestures an arrow takes
// --------------------------------------------------------------------------------

/** A press, moves and a release on the tool's layer, in screen points. */
function dragOnLayer(layer: Element | null, from: Point, to: Point): void {
  pointerOnLayer(layer, 'pointerdown', from);
  pointerOnLayer(layer, 'pointermove', { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 });
  pointerOnLayer(layer, 'pointermove', to);
  pointerOnLayer(layer, 'pointerup', to);
  flushFrames();
}

/**
 * A click on the arrow's own line, at a board point. A browser only ever sends a
 * pointer event to an arrow when the pointer is inside its click tolerance - that is
 * what the invisible thick line is drawn for - so a test sends it here and the
 * arrow's own measurement is what decides whether it was a click on the arrow.
 */
function clickOnLine(index: number, world: Point | null): void {
  if (world === null) throw new Error('clickOnLine: the arrow has no ends');
  const at = screenOf(world);
  const hit = connectorHit(index);
  pointerOnLayer(hit, 'pointerdown', at);
  pointerOnLayer(hit, 'pointerup', at);
  flushFrames();
}

/** A click on the middle of an arrow's line: the way a person selects an arrow. */
function selectArrow(index: number, ends: { from: Point; to: Point } | null): void {
  if (ends === null) throw new Error('selectArrow: the arrow has no ends');
  clickOnLine(index, mid(ends));
}

/** An end handle's centre on the board, in board units: the handle is a world child. */
function endCentre(end: 'from' | 'to'): Point {
  const el = connectorEndEl(end);
  if (el === null) throw new Error(`no ${end} handle on screen`);
  const box = connectorBoxAt(0);
  return {
    x: box.x + px(el.style.left) + px(el.style.width) / 2,
    y: box.y + px(el.style.top) + px(el.style.height) / 2,
  };
}

/** An end handle dragged to a screen point. */
function dragEnd(end: 'from' | 'to', to: Point): void {
  const from = screenOf(endCentre(end));
  pointerOnLayer(connectorEndEl(end), 'pointerdown', from);
  pointerOnLayer(connectorEndEl(end), 'pointermove', { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 });
  pointerOnLayer(connectorEndEl(end), 'pointermove', to);
  pointerOnLayer(connectorEndEl(end), 'pointerup', to);
  flushFrames();
}

describe('the Connector tool', () => {
  useBoardTestLifecycle();

  it('TC-18 L holds the tool and pointing at a shape shows the four sides an end can go on', () => {
    const { doc } = renderBoard();
    newShape(doc, { x: -150, y: -80 });
    flushFrames();
    expect(connectorToolLayer()).toBeNull();

    holdConnectorTool();
    const layer = connectorToolLayer();
    expect(layer).not.toBeNull();
    expect(connectorToolButton()?.getAttribute('aria-pressed')).toBe('true');
    // nothing is pointed at yet, because the pointer has not been over the board
    expect(connectorDotsBox()).toBeNull();

    pointerOnLayer(layer, 'pointermove', middle(0));
    expect(layer?.dataset.target).toBe(shapeAt(0).dataset.shapeId);
    expect(connectorDots()).toHaveLength(4);
    expect(connectorDots().map((dot) => String(dot.dataset.side))).toEqual([
      'top',
      'right',
      'bottom',
      'left',
    ]);

    // each dot stands on the midpoint of the side it names, which is where an end
    // attached to that side is drawn
    const box = shapeBox(0);
    const middleOf = centre(box);
    const anchors: Record<string, Point> = {
      top: { x: middleOf.x, y: box.y },
      right: { x: box.x + box.width, y: middleOf.y },
      bottom: { x: middleOf.x, y: box.y + box.height },
      left: { x: box.x, y: middleOf.y },
    };
    for (const side of ['top', 'right', 'bottom', 'left']) {
      const shown = dotCentre(side);
      const expected = screenOf(anchors[side] as Point);
      expect(shown.x).toBeCloseTo(expected.x, 2);
      expect(shown.y).toBeCloseTo(expected.y, 2);
    }

    // a pointer over empty board is pointed at nothing: no dots, no target
    pointerOnLayer(layer, 'pointermove', { x: 30, y: 30 });
    expect(connectorDotsBox()).toBeNull();

    // Escape lets the tool go, and the dots go with it
    pressKey('Escape');
    expect(connectorToolLayer()).toBeNull();
    expect(textToolSelectButton()?.getAttribute('aria-pressed')).toBe('true');
  });

  it('TC-19 a drag from one shape to another highlights the side it lands on and attaches both ends', () => {
    const { doc } = renderBoard();
    newShape(doc, { x: -260, y: -60 });
    newShape(doc, { x: 60, y: -60 });
    flushFrames();
    holdConnectorTool();
    const layer = connectorToolLayer();
    const a = shapeBox(0);
    const b = shapeBox(1);

    pointerOnLayer(layer, 'pointerdown', middle(0));
    pointerOnLayer(layer, 'pointermove', { x: middle(1).x - 60, y: middle(1).y });

    // while the end is in the air the arrow is drawn from where it started to the
    // pointer: a preview, and only a preview - nothing is on the board yet
    expect(connectorToolPreviewEl()).not.toBeNull();
    expect(connectorCount()).toBe(0);
    const lit = highlightedDot();
    expect(lit).not.toBeNull();
    expect(lit?.dataset.side).toBe('left');
    expect(lit?.dataset.side).toBe(nearestSide(b, centre(a)));

    pointerOnLayer(layer, 'pointerup', middle(1));
    flushFrames();

    expect(connectorCount()).toBe(1);
    const stored = connectorSnapshot(doc, String(connectorAt(0).dataset.connectorId));
    expect(stored?.from.kind).toBe('attached');
    expect(stored?.to.kind).toBe('attached');
    expect(stored?.from).toMatchObject({ kind: 'attached', objectId: shapeAt(0).dataset.shapeId });
    expect(stored?.to).toMatchObject({ kind: 'attached', objectId: shapeAt(1).dataset.shapeId });
    // drawn between the two sides that face each other
    expect(stored?.ends.from.x).toBeCloseTo(a.x + a.width, 2);
    expect(stored?.ends.to.x).toBeCloseTo(b.x, 2);
    // the arrow just drawn is the one selected, and the tool let go of itself
    expect(selectedConnectors()).toHaveLength(1);
    expect(connectorToolLayer()).toBeNull();
    expect(textToolSelectButton()?.getAttribute('aria-pressed')).toBe('true');
  });

  it('TC-19 an arrow follows the object one of its ends is attached to', () => {
    const { doc } = renderBoard();
    newShape(doc, { x: -260, y: -60 });
    const moved = newShape(doc, { x: 60, y: -60 });
    flushFrames();
    const arrow = newConnector(doc, String(shapeAt(0).dataset.shapeId), moved);
    flushFrames();
    const before = connectorSnapshot(doc, arrow)?.ends;
    if (before === null || before === undefined) throw new Error('the arrow is not on the board');

    // the object moves by itself - which is what a drag from another person looks
    // like from here. Nothing is remembered of where the arrow's ends were drawn.
    act(() => {
      const object = doc.getMap<Y.Map<unknown>>('objects').get(moved) as Y.Map<number>;
      object.set('x', (object.get('x') as number) + 120);
    });
    flushFrames();

    const after = connectorSnapshot(doc, arrow)?.ends;
    expect(after?.to.x).toBeCloseTo(before.to.x + 120, 2);
    expect(after?.from.x).toBeCloseTo(before.from.x, 2);
    // and what is drawn follows the answer: the far end of the arrow on the screen
    // is where the moved object's side now is, the near end where it always was
    expect(Number(connectorAt(0).dataset.arrowToX)).toBeCloseTo(after?.to.x ?? 0, 3);
    expect(Number(connectorAt(0).dataset.arrowFromX)).toBeCloseTo(before.from.x, 3);
    expect(connectorBoxAt(0).x).toBeCloseTo(before.from.x - (CONNECTOR_HIT_TOLERANCE_PX * 2) / readCamera().zoom, 2);
  });

  it('TC-19 nothing is drawn between one object and itself, or nearer than an arrow is drawn', () => {
    const { doc } = renderBoard();
    newShape(doc, { x: -200, y: -60 }, { width: 240, height: 160 });
    flushFrames();
    holdConnectorTool();
    const layer = connectorToolLayer();
    const box = shapeBox(0);

    // a drag that begins and ends on the same object is a mistaken drag, not an
    // arrow: an arrow between one object and itself has no direction to point in
    dragOnLayer(layer, screenOf({ x: box.x + 20, y: box.y + 20 }), screenOf({ x: box.x + 120, y: box.y + 100 }));
    expect(connectorCount()).toBe(0);
    expect(connectorToolLayer()).not.toBeNull();

    // and a drag too short to be an arrow draws nothing either
    const start = { x: 300, y: 300 };
    dragOnLayer(layer, start, {
      x: start.x + CONNECTOR_MIN_LENGTH_WORLD / 2 / readCamera().zoom,
      y: start.y,
    });
    expect(connectorCount()).toBe(0);

    // but the same drag, long enough, is an arrow with both ends fixed on the board
    const stop = { x: start.x + CONNECTOR_MIN_LENGTH_WORLD * 4, y: start.y };
    dragOnLayer(layer, start, stop);
    expect(connectorCount()).toBe(1);
    const stored = connectorSnapshot(doc, String(connectorAt(0).dataset.connectorId));
    expect(stored?.from.kind).toBe('free');
    expect(stored?.to.kind).toBe('free');
    expect(stored?.ends.to.x).toBeCloseTo(worldOfScreen(stop).x, 2);
    expect(stored?.ends.to.y).toBeCloseTo(worldOfScreen(stop).y, 2);
  });

  it('TC-20 an arrow is on it at six screen pixels and not on it at seven, at either zoom', () => {
    const { doc } = renderBoard();
    newShape(doc, { x: -300, y: -40 });
    const second = newShape(doc, { x: 40, y: -40 });
    flushFrames();
    const arrow = newConnector(doc, String(shapeAt(0).dataset.shapeId), second);
    flushFrames();

    // Six screen pixels either side of the line is what "on the arrow" means, and it
    // is a screen measurement: at 50% those six pixels are twelve board units, at
    // 200% three, so zooming in does not make an arrow easier to hit and zooming out
    // does not make it harder. Two things are asked at each zoom: that the arrow takes
    // the click for itself (it is the one selected, and the board was told nothing),
    // and that a click beyond the tolerance is not the arrow's at all - it goes on to
    // the board, which is what makes a miss a pan or a deselect rather than a dead
    // click inside an invisible box.
    for (const zoom of [0.5, 2]) {
      setCamera(-100, -100, zoom);
      expect(readCamera().zoom).toBe(zoom);
      const ends = connectorSnapshot(doc, arrow)?.ends;
      if (ends === null || ends === undefined) throw new Error('the arrow is not on the board');

      // What makes an arrow clickable is a line as thick as the tolerance, so that is
      // what the board draws: six pixels each side, in board units at this zoom.
      expect(Number(connectorHit(0).getAttribute('stroke-width'))).toBeCloseTo(
        (CONNECTOR_HIT_TOLERANCE_PX * 2) / zoom,
        6,
      );

      // Seven screen pixels off the line is not the arrow: the press is not its own,
      // and nothing is selected by it.
      clickBoard(40, 40);
      flushFrames();
      expect(selectedConnectors()).toHaveLength(0);
      clickOnLine(0, offLine(ends, 0.5, 7));
      expect(selectedConnectors()).toHaveLength(0);

      // Five is: the arrow takes the press, is the one selected, and the board does
      // not treat the press as a pan of its own - which is what makes an arrow
      // possible to click at all without the board moving under the pointer.
      clickOnLine(0, offLine(ends, 0.5, 5));
      expect(selectedConnectors()).toHaveLength(1);
      expect(mode()).toBe('idle');
      expect(readCamera()).toEqual({ x: -100, y: -100, zoom });
    }
  });

  it('TC-21 an end dragged onto a third object attaches to it; dropped on the board it is fixed there', () => {
    const { doc } = renderBoard();
    newShape(doc, { x: -420, y: -220 }, { width: 160, height: 120 });
    newShape(doc, { x: -140, y: -220 }, { width: 160, height: 120 });
    newShape(doc, { x: 140, y: -220 }, { width: 160, height: 120 });
    flushFrames();
    const ids = shapeElements().map((el) => String(el.dataset.shapeId));
    const arrow = newConnector(doc, ids[0] ?? '', ids[1] ?? '');
    flushFrames();

    // the handles an arrow offers are its two ends, and only its two ends: an arrow
    // has no size to drag, so the selection offers it nothing
    selectArrow(0, connectorSnapshot(doc, arrow)?.ends ?? null);
    expect(selectedConnectors()).toHaveLength(1);
    expect(connectorEndEl('from')).not.toBeNull();
    expect(connectorEndEl('to')).not.toBeNull();
    expect(document.querySelector('[data-testid^="resize-handle-"]')).toBeNull();

    // the far end, dragged onto the third shape, is attached to that shape
    dragEnd('to', middle(2));
    let stored = connectorSnapshot(doc, arrow);
    expect(stored?.to.kind).toBe('attached');
    expect(stored?.to).toMatchObject({ kind: 'attached', objectId: ids[2] });
    expect(stored?.ends.to.x).toBeCloseTo(shapeBox(2).x, 2);

    // and the same end, dropped on empty board, is a point on the board
    const free = { x: -20, y: 60 };
    dragEnd('to', screenOf(free));
    stored = connectorSnapshot(doc, arrow);
    expect(stored?.to).toMatchObject({ kind: 'free', x: free.x, y: free.y });
    expect(stored?.ends.to.x).toBeCloseTo(free.x, 1);
    expect(stored?.ends.to.y).toBeCloseTo(free.y, 1);
    // the end that was not dragged kept the side it faced
    expect(stored?.from).toMatchObject({ kind: 'attached', objectId: ids[0] });
  });

  it('TC-21 an end dragged onto the object the other end is on is refused and snaps back', () => {
    const { doc } = renderBoard();
    newShape(doc, { x: -300, y: -60 });
    const second = newShape(doc, { x: 60, y: -60 });
    flushFrames();
    const arrow = newConnector(doc, String(shapeAt(0).dataset.shapeId), second);
    flushFrames();
    const before = connectorSnapshot(doc, arrow)?.ends;

    selectArrow(0, before ?? null);
    dragEnd('to', middle(0));

    const after = connectorSnapshot(doc, arrow);
    expect(after?.to).toMatchObject({ kind: 'attached', objectId: second });
    expect(after?.ends.to.x).toBeCloseTo(before?.to.x ?? 0, 2);
    expect(after?.from).toMatchObject({ kind: 'attached', objectId: shapeAt(0).dataset.shapeId });
  });

  it('an arrow takes a double-click for itself and asks the board for nothing', () => {
    const { doc } = renderBoard();
    newShape(doc, { x: -300, y: -60 });
    const second = newShape(doc, { x: 60, y: -60 });
    flushFrames();
    const arrow = newConnector(doc, String(shapeAt(0).dataset.shapeId), second);
    flushFrames();
    const ends = connectorSnapshot(doc, arrow)?.ends;
    if (ends === null || ends === undefined) throw new Error('no arrow on the board');

    // A double-click on the board makes a sticky note; on an arrow it must not, and
    // the arrow has no text of its own to open an editor for. The two clicks of a
    // double-click are sent to the arrow's line, which is where a browser would send
    // them, and the second one is the dblclick the board listens for.
    const at = mid(ends);
    const hit = connectorHit(0);
    doubleClickOn(hit, screenOf(at).x, screenOf(at).y);
    flushFrames();

    expect(noteCount()).toBe(0);
    expect(selectedConnectors()).toHaveLength(1);
  });

  it('a shape and an arrow are never both worked on, so only one bar is on screen', () => {
    const { doc } = renderBoard();
    const a = newShape(doc, { x: -300, y: -60 });
    const b = newShape(doc, { x: 60, y: -60 });
    flushFrames();
    const arrow = newConnector(doc, a, b);
    flushFrames();

    // the shape's colours belong to the shape, and an arrow is not a shape: selecting
    // the arrow takes the bar away, because an arrow has no colours of its own to set
    clickOn(shapeAt(0), middle(0).x, middle(0).y);
    flushFrames();
    expect(shapeToolbarElement()).not.toBeNull();
    selectArrow(0, connectorSnapshot(doc, arrow)?.ends ?? null);
    flushFrames();
    expect(shapeToolbarElement()).toBeNull();
    expect(selectedConnectors()).toHaveLength(1);
    expect(connectorEndEl('to')).not.toBeNull();
  });
});
