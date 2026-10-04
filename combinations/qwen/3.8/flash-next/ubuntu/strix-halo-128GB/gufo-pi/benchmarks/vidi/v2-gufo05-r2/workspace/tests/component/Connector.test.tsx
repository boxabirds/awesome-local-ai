/**
 * Story 10, `connector.ui`: the arrow in the hand, the arrow on the board, and the
 * line that is not where its box is.
 *
 * These run on the real board because every number here is a conversion: the dots the
 * tool shows must sit on the side anchors of the object under the pointer, a click must
 * be judged by its distance from the line rather than by the box around a diagonal, and a
 * dragged handle must end up attached to whatever was under it when the hand let go.
 */

import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type * as Y from 'yjs';

import { CONNECTOR_HIT_TOLERANCE_PX } from '../../src/shared/config';
import { connectorPoints } from '../../src/shared/objects/connector';
import { nearestSide, sideAnchor } from '../../src/shared/geometry/connector-geometry';
import {
  arrowsOf,
  boardEl,
  boxOf,
  centre,
  connectorToolLayer,
  dotEl,
  dots,
  dragScreen,
  dragWorld,
  fireKey,
  firePointer,
  flushFrames,
  handleEl,
  hitLineEl,
  objectCount,
  objectEl,
  pickConnectorTool,
  rectsOf,
  renderStory10,
  seedArrow,
  seedFreeArrow,
  seedShape,
  selectionIds,
  setCamera,
  toScreen,
} from './story10Harness';

afterEach(() => cleanup());

/** Press and release at one board point: a click on whatever is there. */
function clickWorld(el: Element, at: { x: number; y: number }): void {
  const p = toScreen(at);
  firePointer(el, 'pointerdown', p.x, p.y);
  firePointer(el, 'pointerup', p.x, p.y);
  flushFrames();
}

/** Move the pointer over an object without pressing: the tool previews its sides. */
function hover(doc: Y.Doc, id: string): void {
  const at = toScreen(centre(boxOf(doc, id)));
  firePointer(connectorToolLayer(), 'pointermove', at.x, at.y);
  flushFrames();
}

/** Let go of the current drag at a board point. */
function releaseAt(at: { x: number; y: number }): void {
  const p = toScreen(at);
  firePointer(connectorToolLayer(), 'pointerup', p.x, p.y);
  flushFrames();
}

function pressed(name: string): boolean {
  return screen.getByRole('button', { name }).getAttribute('aria-pressed') === 'true';
}

describe('connector.ui — the tool shows where an end would attach', () => {
  it('TC-18: hovering an object puts a dot on each of its four sides', () => {
    const doc = renderStory10();
    const a = seedShape(doc, 'rect', { x: 0, y: 0, width: 200, height: 120 });
    pickConnectorTool();
    hover(doc, a);

    const rect = boxOf(doc, a);
    expect(dots()).toHaveLength(4);
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      const on = toScreen(sideAnchor(rect, side));
      const dot = dotEl(side)!;
      expect(Number(dot.getAttribute('cx'))).toBeCloseTo(on.x, 3);
      expect(Number(dot.getAttribute('cy'))).toBeCloseTo(on.y, 3);
    }
  });

  it('TC-18b: the dot nearest the pointer is the end that would be made', () => {
    const doc = renderStory10();
    const a = seedShape(doc, 'rect', { x: 0, y: 0, width: 200, height: 120 });
    const b = seedShape(doc, 'ellipse', { x: 500, y: 0, width: 200, height: 120 });
    pickConnectorTool();

    // Start the arrow at A, then hover B: its left side faces A, and it is the active one.
    dragWorld(connectorToolLayer(), centre(boxOf(doc, a)), centre(boxOf(doc, b)), {
      release: false,
    });
    expect(nearestSide(boxOf(doc, b), centre(boxOf(doc, a)))).toBe('left');
    expect(dotEl('left')!.getAttribute('data-active')).toBe('true');
    expect(dotEl('right')!.getAttribute('data-active')).toBe('false');
  });

  it('TC-28: a drag that starts on an object with the Connector tool moves nothing', () => {
    const doc = renderStory10();
    const a = seedShape(doc, 'rect', { x: 0, y: 0, width: 200, height: 120 });
    const before = boxOf(doc, a);
    pickConnectorTool();

    dragWorld(connectorToolLayer(), centre(before), { x: 400, y: 300 }, { release: false });
    expect(boxOf(doc, a)).toEqual(before);
    expect(objectCount(doc)).toBe(1);
  });
});

describe('connector.ui — drawing an arrow', () => {
  it('TC-19: a drag from A to B attaches both ends', () => {
    const doc = renderStory10();
    const a = seedShape(doc, 'rect', { x: 0, y: 0, width: 200, height: 120 });
    const b = seedShape(doc, 'ellipse', { x: 400, y: 0, width: 200, height: 120 });
    pickConnectorTool();

    dragWorld(connectorToolLayer(), centre(boxOf(doc, a)), centre(boxOf(doc, b)), {
      release: false,
    });
    releaseAt(centre(boxOf(doc, b)));

    const arrows = arrowsOf(doc);
    expect(arrows).toHaveLength(1);
    expect(arrows[0]!.from).toMatchObject({ kind: 'attached', objectId: a });
    expect(arrows[0]!.to).toMatchObject({ kind: 'attached', objectId: b });
    // The tool went back to Select, and the new arrow is the selection.
    expect(pressed('Connector (L)')).toBe(false);
    expect(selectionIds()).toEqual([arrows[0]!.id]);
  });

  it('TC-19b: a free end where the hand left it; nothing at all when it began in empty space', () => {
    const doc = renderStory10();
    const a = seedShape(doc, 'rect', { x: 0, y: 0, width: 200, height: 120 });
    pickConnectorTool();

    dragWorld(connectorToolLayer(), centre(boxOf(doc, a)), { x: 700, y: 400 });
    const arrows = arrowsOf(doc);
    expect(arrows).toHaveLength(1);
    expect(arrows[0]!.from).toMatchObject({ kind: 'attached', objectId: a });
    expect(arrows[0]!.to.kind).toBe('free');
    // An arrow was made, so the hand went back to Select, as it does for a shape.
    expect(pressed('Connector (L)')).toBe(false);

    // Pick the tool up again: a drag that begins over empty board is refused, and a
    // refused drag leaves the tool in the hand, because you were still trying to draw.
    pickConnectorTool();
    const before = objectCount(doc);
    dragWorld(connectorToolLayer(), { x: -400, y: -400 }, { x: -300, y: -300 });
    expect(objectCount(doc)).toBe(before);
    expect(pressed('Connector (L)')).toBe(true);
  });

  it('TC-19c: a target keeps the arrow when the pointer wanders off it mid-drag', () => {
    const doc = renderStory10();
    const a = seedShape(doc, 'rect', { x: 0, y: 0, width: 200, height: 120 });
    const b = seedShape(doc, 'ellipse', { x: 400, y: 0, width: 200, height: 120 });
    pickConnectorTool();

    dragWorld(connectorToolLayer(), centre(boxOf(doc, a)), centre(boxOf(doc, b)), {
      release: false,
    });
    // Out past the edge of the window, releasing there: the last thing the hand was
    // pointing at wins, rather than the arrow being dropped as a loose line.
    firePointer(connectorToolLayer(), 'pointermove', -400, -400);
    flushFrames();
    firePointer(connectorToolLayer(), 'pointerup', -400, -400);
    flushFrames();

    expect(arrowsOf(doc)).toHaveLength(1);
    expect(arrowsOf(doc)[0]!.to).toMatchObject({ kind: 'attached', objectId: b });
  });
});

describe('connector.ui — clicking an arrow', () => {
  it('TC-20: within the tolerance of the line it selects, outside it does not, at any zoom', () => {
    const doc = renderStory10();
    const arrow = seedFreeArrow(doc, { x: 0, y: 0 }, { x: 200, y: 0 });
    const line = hitLineEl(arrow)!;

    for (const zoom of [1, 0.5, 2]) {
      setCamera(zoom, { x: -100, y: -60 });

      // One pixel inside the tolerance (in screen pixels): the arrow is picked.
      clickWorld(line, { x: 100, y: 0 + (CONNECTOR_HIT_TOLERANCE_PX - 1) / zoom });
      expect(selectionIds()).toEqual([arrow]);

      // Clear, then one pixel outside it: nothing is.
      clickWorld(boardEl(), { x: -300, y: -300 });
      expect(selectionIds()).toEqual([]);
      clickWorld(line, { x: 100, y: 0 + (CONNECTOR_HIT_TOLERANCE_PX + 1) / zoom });
      expect(selectionIds()).toEqual([]);
    }
  });

  it('TC-20b: the middle of an arrow’s box, far from its line, is left alone', () => {
    const doc = renderStory10();
    const arrow = seedFreeArrow(doc, { x: 0, y: 0 }, { x: 200, y: 200 });
    // The box of a diagonal arrow is a square around it; its centre is ~70 units from
    // the line, which is far outside the tolerance at any zoom.
    clickWorld(boardEl(), centre(boxOf(doc, arrow)));
    expect(selectionIds()).toEqual([]);

    clickWorld(hitLineEl(arrow)!, { x: 100, y: 100 });
    expect(selectionIds()).toEqual([arrow]);
  });
});

describe('connector.ui — re-attaching an end', () => {
  it('TC-21: a dragged end follows its object, and refuses the object at the other end', () => {
    const doc = renderStory10();
    const a = seedShape(doc, 'rect', { x: 0, y: 0, width: 200, height: 120 });
    const b = seedShape(doc, 'ellipse', { x: 400, y: 0, width: 200, height: 120 });
    const c = seedShape(doc, 'diamond', { x: 0, y: 400, width: 200, height: 200 });
    const arrow = seedArrow(doc, a, b);

    // The line runs from A's right side to B's left side, both at y = 60.
    clickWorld(hitLineEl(arrow)!, { x: 300, y: 60 });
    expect(selectionIds()).toEqual([arrow]);
    expect(handleEl('from')).not.toBeNull();
    expect(handleEl('to')).not.toBeNull();

    // Drag the head onto another object: it hangs from that one now.
    dragScreen(handleEl('to')!, toScreen(centre(boxOf(doc, b))), toScreen(centre(boxOf(doc, c))));
    expect(endOf(doc, arrow, 'to')).toMatchObject({ kind: 'attached', objectId: c });

    // Drag it onto empty board: a free end.
    const empty = { x: 900, y: 500 };
    dragScreen(handleEl('to')!, toScreen(centre(boxOf(doc, c))), toScreen(empty));
    expect(endOf(doc, arrow, 'to').kind).toBe('free');

    // And the object at the other end is refused: the arrow stays exactly as it was.
    const settled = arrowsOf(doc).find((entry) => entry.id === arrow)!;
    dragScreen(handleEl('to')!, toScreen(empty), toScreen(centre(boxOf(doc, a))));
    expect(arrowsOf(doc).find((entry) => entry.id === arrow)).toEqual(settled);
  });

  it('TC-21b: moving an object carries the arrow that hangs off it', () => {
    const doc = renderStory10();
    const a = seedShape(doc, 'rect', { x: 0, y: 0, width: 200, height: 120 });
    const b = seedShape(doc, 'ellipse', { x: 400, y: 0, width: 200, height: 120 });
    seedArrow(doc, a, b);
    const before = connectorPoints(arrowsOf(doc)[0]!, rectsOf(doc));

    // Select the shape with a click, then drag it: story 7's move, unchanged.
    fireKey('v');
    clickWorld(objectEl(a), centre(boxOf(doc, a)));
    dragWorld(objectEl(a), centre(boxOf(doc, a)), { x: 500, y: 300 });

    const after = connectorPoints(arrowsOf(doc)[0]!, rectsOf(doc));
    const boxA = boxOf(doc, a);
    const boxB = boxOf(doc, b);
    // Both ends are where their objects say they are: A's faces B, and B's faces A.
    expect(after[0]).toEqual(sideAnchor(boxA, nearestSide(boxA, centre(boxB))));
    expect(after[1]).toEqual(sideAnchor(boxB, nearestSide(boxB, centre(boxA))));
    expect(after[0]).not.toEqual(before[0]);
  });
});

function endOf(doc: Y.Doc, id: string, which: 'from' | 'to') {
  const arrow = arrowsOf(doc).find((entry) => entry.id === id);
  if (!arrow) throw new Error(`arrow ${id} is not on the board`);
  return arrow[which];
}
