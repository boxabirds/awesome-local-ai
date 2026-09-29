// Story 10, connector.ui (component): the four snap points, the drag that joins two
// objects, the click that selects an arrow, and the handle that re-points one end -
// in the real board, with the real Connector tool mounted over it and the real
// ConnectorObject drawing under it.
//
// Two things the tests lean on:
//  * the harness's toScreen/toWorld read the camera off the world layer, so every
//    coordinate comes from the board's own arithmetic rather than a number the test
//    guessed - and the drawn line's data-from-*/data-to-* attributes say where the
//    board thinks its ends are, which is where the handles are too;
//  * the hit-tolerance case (TC-20) asks the registry's hit test at two zooms,
//    because a jsdom document does no painting and therefore no pointer hit-testing.
//    A real click at a screen point is what the e2e suite does, and does.
import { describe, it, expect } from 'vitest';
import { screen, fireEvent, act } from '@testing-library/react';
import { renderBoard7, settle } from './story7TestUtils.tsx';
import { deleteObjects, moveObjects, objectsSnapshot } from '../../src/shared/board-model.ts';
import { createShape } from '../../src/shared/objects/shape.ts';
import { createConnector, getConnectorEnds, rectsById } from '../../src/shared/objects/connector.ts';
import type { ConnectorSnapshot, Endpoint } from '../../src/shared/objects/connector.ts';
import { sideAnchor, SIDES, type Side } from '../../src/shared/geometry/connector-geometry.ts';
import { getObjectType } from '../../src/client/objects/registry.tsx';
import {
  CONNECTOR_DOT_RADIUS_PX,
  CONNECTOR_HIT_TOLERANCE_PX,
  CONNECTOR_MIN_LENGTH_WORLD,
  type ShapeKind,
} from '../../src/shared/config.ts';

type Harness = ReturnType<typeof renderBoard7>;

const pressed = (el: HTMLElement): boolean => el.getAttribute('aria-pressed') === 'true';
const connectorButton = (): HTMLElement => screen.getByTestId('tool-connector');
const selectButton = (): HTMLElement => screen.getByTestId('tool-select');
const tool = (): HTMLElement => screen.getByTestId('connector-tool');
const dots = (): HTMLElement[] => screen.getAllByTestId('connector-dot');
const line = (id: string): HTMLElement => screen.getByTestId(`connector-line-${id}`);
const handle = (end: 'from' | 'to'): HTMLElement => screen.getByTestId(`connector-handle-${end}`);

/** Pointer options at the screen point of a world point. */
function at(h: Harness, x: number, y: number, pointerId = 31) {
  const s = h.toScreen({ x, y });
  return { clientX: s.x, clientY: s.y, button: 0, pointerId, bubbles: true, cancelable: true };
}

const attached = (objectId: string, fallback: { x: number; y: number }): Endpoint => ({ kind: 'attached', objectId, fallback });
const free = (x: number, y: number): Endpoint => ({ kind: 'free', x, y });

function seedShape(h: Harness, seed: { x: number; y: number; width?: number; height?: number; kind?: ShapeKind }): string {
  let id = '';
  act(() => {
    id = createShape(
      h.doc(),
      {
        kind: seed.kind ?? 'rect',
        rect: { x: seed.x, y: seed.y, width: seed.width ?? 200, height: seed.height ?? 200 },
        at: { x: 0, y: 0 },
        square: false,
      },
      'tester',
    )!;
  });
  return id;
}

function seedConnector(h: Harness, from: Endpoint, to: Endpoint): string {
  let id = '';
  act(() => {
    id = createConnector(h.doc(), from, to, 'tester')!;
  });
  return id;
}

function connectorOf(h: Harness, id: string): ConnectorSnapshot {
  const obj = objectsSnapshot(h.doc()).find((o) => o.id === id);
  if (!obj) throw new Error(`connector ${id} is not on the board`);
  return obj as ConnectorSnapshot;
}

/** Where the board is drawing one end of an arrow, in world units. */
function drawnEnd(id: string, end: 'from' | 'to'): { x: number; y: number } {
  const el = line(id);
  return { x: Number(el.getAttribute(`data-${end}-x`)), y: Number(el.getAttribute(`data-${end}-y`)) };
}

// The two shapes most connector tests use: A on the left, B on the right, 200
// units of empty board between them.
function twoShapes(h: Harness): { a: string; b: string } {
  return { a: seedShape(h, { x: 0, y: 0 }), b: seedShape(h, { x: 400, y: 0 }) };
}

describe('connector.ui (component)', () => {
  // TC-18: the Connector tool dots the four side midpoints of whatever the pointer
  // is over, at a constant screen size, and dots nothing when it is over nothing.
  it('TC-18 shows four snap points on the object under the pointer', async () => {
    const h = renderBoard7();
    const { a } = twoShapes(h);

    h.key('l');
    expect(pressed(connectorButton())).toBe(true);

    fireEvent.pointerMove(tool(), at(h, 100, 100)); // the middle of A
    const shown = dots();
    expect(shown).toHaveLength(4);
    const rect = rectsById(h.doc()).get(a)!;
    const wantSides = [...SIDES].sort();
    expect(shown.map((d) => d.getAttribute('data-object-id'))).toEqual([a, a, a, a]);
    expect(shown.map((d) => d.getAttribute('data-side')).sort()).toEqual(wantSides);
    for (const dot of shown) {
      expect(dot.style.width).toBe(`${CONNECTOR_DOT_RADIUS_PX * 2}px`);
      expect(dot.style.height).toBe(`${CONNECTOR_DOT_RADIUS_PX * 2}px`);
      expect(dot.style.borderRadius).toBe('50%');
      const want = h.toScreen(sideAnchor(rect, dot.getAttribute('data-side') as Side));
      expect(parseFloat(dot.style.left)).toBeCloseTo(want.x - CONNECTOR_DOT_RADIUS_PX, 1);
      expect(parseFloat(dot.style.top)).toBeCloseTo(want.y - CONNECTOR_DOT_RADIUS_PX, 1);
    }

    // Nothing hovered: nothing dotted.
    fireEvent.pointerMove(tool(), at(h, -5000, -5000));
    expect(screen.queryAllByTestId('connector-dot')).toHaveLength(0);
  });

  // TC-19: dragging from one object towards another lights the side the arrow would
  // leave, and release joins them - attached at both ends, selected, tool back to
  // Select, and the line drawn between the two facing sides.
  it('TC-19 drags from a shape over another, lights its nearest side and joins them', async () => {
    const h = renderBoard7();
    const { a, b } = twoShapes(h);

    h.key('l');
    fireEvent.pointerDown(tool(), at(h, 100, 100)); // in the middle of A
    fireEvent.pointerMove(tool(), at(h, 500, 100)); // over B

    const shown = dots();
    expect(shown).toHaveLength(4);
    for (const dot of shown) expect(dot.getAttribute('data-object-id')).toBe(b);
    const lit = shown.filter((d) => d.getAttribute('data-highlighted') === 'true');
    expect(lit).toHaveLength(1);
    expect(lit[0].getAttribute('data-side')).toBe('left'); // B's left side faces A
    expect(screen.getByTestId('connector-preview-line')).toBeTruthy();

    fireEvent.pointerUp(tool(), at(h, 500, 100));
    await settle();

    const connector = objectsSnapshot(h.doc()).find((o) => o.type === 'connector') as ConnectorSnapshot;
    expect(connector).toBeDefined();
    expect(connector.from).toMatchObject({ kind: 'attached', objectId: a });
    expect(connector.to).toMatchObject({ kind: 'attached', objectId: b });

    expect(Number(line(connector.id).getAttribute('data-from-x'))).toBeCloseTo(200, 3); // A's right edge
    expect(Number(line(connector.id).getAttribute('data-to-x'))).toBeCloseTo(400, 3); // B's left edge
    expect(screen.getByTestId(`connector-arrow-${connector.id}`)).toBeTruthy(); // it points

    // Selected, and the tool handed itself back.
    expect(h.selectedIds()).toEqual([connector.id]);
    expect(pressed(connectorButton())).toBe(false);
    expect(pressed(selectButton())).toBe(true);
  });

  // An arrow dropped back on the object it started from is not an arrow at all:
  // nothing is written, and the tool is still open to be tried again.
  it('creates nothing when the drag is released on its own starting object', async () => {
    const h = renderBoard7();
    twoShapes(h);

    h.key('l');
    fireEvent.pointerDown(tool(), at(h, 100, 100));
    fireEvent.pointerMove(tool(), at(h, 120, 120));
    fireEvent.pointerUp(tool(), at(h, 110, 110));
    await settle();

    expect(objectsSnapshot(h.doc()).some((o) => o.type === 'connector')).toBe(false);
    expect(pressed(connectorButton())).toBe(true);
  });

  // A few pixels of drag is a mistaken click, not an arrow (connector.no_accidental).
  it('creates nothing for a drag of a few pixels', async () => {
    const h = renderBoard7();
    twoShapes(h);

    h.key('l');
    fireEvent.pointerDown(tool(), at(h, 0, 0));
    const nudge = { ...at(h, 0, 0), clientX: h.toScreen({ x: 0, y: 0 }).x + 4, clientY: h.toScreen({ x: 0, y: 0 }).y + 4 };
    fireEvent.pointerMove(tool(), nudge);
    fireEvent.pointerUp(tool(), nudge);
    await settle();

    expect(objectsSnapshot(h.doc()).some((o) => o.type === 'connector')).toBe(false);
    expect(pressed(connectorButton())).toBe(true);
  });

  // A drag that begins and ends on empty board is an arrow pinned to two board
  // points (connector.create_free) - the same shape as an arrow whose target is gone.
  it('pins both ends to the board when the drag starts and ends on empty space', async () => {
    const h = renderBoard7();

    h.key('l');
    fireEvent.pointerDown(tool(), at(h, 0, 600));
    fireEvent.pointerMove(tool(), at(h, 300, 600));
    fireEvent.pointerUp(tool(), at(h, 300, 600));
    await settle();

    const connector = objectsSnapshot(h.doc()).find((o) => o.type === 'connector') as ConnectorSnapshot;
    expect(connector.from.kind).toBe('free');
    expect(connector.to.kind).toBe('free');
    expect(Number(line(connector.id).getAttribute('data-from-x'))).toBeCloseTo(0, 3);
    expect(Number(line(connector.id).getAttribute('data-to-y'))).toBeCloseTo(600, 3);
  });

  // TC-20: what a person can hit is a fixed distance from the line at any zoom -
  // 6 screen pixels, which is 12 world units at 50% and 3 world units at 200%.
  it('TC-20 is hit by a click near its line and not by one far from it, at 50% and at 200%', async () => {
    const h = renderBoard7();
    const id = seedConnector(h, free(100, 100), free(500, 100));
    const spec = getObjectType('connector')!;

    for (const zoom of [0.5, 2]) {
      // The same screen distance, converted once by the test and once by the board.
      expect(spec.hitTest(connectorOf(h, id), { x: 300, y: 100 + 5 / zoom }, { zoom })).toBe(true);
      expect(spec.hitTest(connectorOf(h, id), { x: 300, y: 100 + 7 / zoom }, { zoom })).toBe(false);
    }

    // The click target is drawn as wide as the rule. Its width is the tolerance
    // DIVIDED BY THE ZOOM rather than a `vector-effect: non-scaling-stroke` stroke,
    // because a browser hit-tests the SCALED stroke: measured in Chromium at 200%,
    // the non-scaling version was clickable 12 px either side of the line while the
    // model's tolerance was 6, so the pixel and the board disagreed about what a
    // click near an arrow means. Scaled by hand the two always agree: the width
    // times the zoom is twice the tolerance, whatever the zoom.
    const hit = screen.getByTestId(`connector-hit-${id}`);
    const hitWidth = Number(hit.getAttribute('stroke-width') ?? hit.getAttribute('strokeWidth'));
    expect(hitWidth * h.cam().zoom).toBeCloseTo(CONNECTOR_HIT_TOLERANCE_PX * 2, 6);
    expect(hit.getAttribute('vector-effect')).toBeNull();
    // The line a person actually SEES does keep a constant screen width.
    expect(line(id).getAttribute('vector-effect')).toBe('non-scaling-stroke');

    // And a press on that line is what selects the arrow.
    fireEvent.pointerDown(hit, at(h, 300, 100));
    await settle();
    expect(h.selectedIds()).toEqual([id]);
  });

  // A press inside the arrow's box but far from its line must not select it: the box
  // is mostly empty space, and a click there belongs to whatever is under it.
  it('is not selected by a click inside its box but away from its line', async () => {
    const h = renderBoard7();
    const id = seedConnector(h, free(0, 0), free(600, 600));
    const spec = getObjectType('connector')!;

    // The box's opposite corner: inside the bounding box, 424 units from the line.
    expect(spec.hitTest(connectorOf(h, id), { x: 600, y: 0 }, { zoom: 1 })).toBe(false);
  });

  // TC-21: the selected arrow's end handles re-point one end and leave the other.
  it('TC-21 re-points an end onto another object and lets it go on empty space', async () => {
    const h = renderBoard7();
    const a = seedShape(h, { x: 0, y: 0 });
    const b = seedShape(h, { x: 400, y: 0 });
    const c = seedShape(h, { x: 200, y: 400 });
    const id = seedConnector(h, attached(a, { x: 200, y: 100 }), attached(b, { x: 400, y: 100 }));

    // Select the arrow by pressing its line.
    fireEvent.pointerDown(screen.getByTestId(`connector-hit-${id}`), at(h, 300, 100));
    await settle();
    expect(h.selectedIds()).toEqual([id]);
    expect(screen.getByTestId('connector-handle-from')).toBeTruthy();
    expect(screen.getByTestId('connector-handle-to')).toBeTruthy();

    // The arrow's box takes no clicks at all, so an arrow laid across a shape never
    // steals that shape's click - which means a handle has to ask for its own
    // pointer events back, or a real pointer falls through it onto the line
    // underneath and the end cannot be dragged at all. jsdom fires events straight at
    // an element whatever its pointer-events says, so only the browser scenario
    // could have found this; the assertion is here so it stays found.
    expect(screen.getByTestId(`connector-${id}`).style.pointerEvents).toBe('none');
    expect(screen.getByTestId('connector-handle-to').style.pointerEvents).toBe('auto');

    // Drag the arrow's end onto C: while it is over C the handle says so.
    const start = drawnEnd(id, 'to');
    fireEvent.pointerDown(handle('to'), at(h, start.x, start.y, 32));
    fireEvent.pointerMove(handle('to'), at(h, 300, 450, 32)); // over C
    expect(screen.getByTestId('connector-handle-to').getAttribute('data-target')).toBe(c);
    fireEvent.pointerUp(handle('to'), at(h, 300, 450, 32));
    await settle();

    let ends = getConnectorEnds(h.doc(), id)!;
    expect(ends.from).toMatchObject({ kind: 'attached', objectId: a }); // the other end did not move
    expect(ends.to).toMatchObject({ kind: 'attached', objectId: c });
    // And the arrow leaves C's top, the side facing A.
    expect(Number(line(id).getAttribute('data-to-y'))).toBeCloseTo(400, 3);

    // Now let it go on empty board: the end stays where it was released.
    const start2 = drawnEnd(id, 'to');
    fireEvent.pointerDown(handle('to'), at(h, start2.x, start2.y, 33));
    fireEvent.pointerMove(handle('to'), at(h, 900, 700, 33));
    expect(screen.getByTestId('connector-handle-to').getAttribute('data-target')).toBe('');
    fireEvent.pointerUp(handle('to'), at(h, 900, 700, 33));
    await settle();

    ends = getConnectorEnds(h.doc(), id)!;
    const released = ends.to;
    expect(released.kind).toBe('free');
    if (released.kind === 'free') {
      expect(released.x).toBeCloseTo(900, 1);
      expect(released.y).toBeCloseTo(700, 1);
    }
    expect(ends.from).toMatchObject({ kind: 'attached', objectId: a });
  });

  // An end dropped on the object the OTHER end holds is refused by the model and
  // snaps back: the arrow is still there, still pointing where it pointed.
  it('snaps an end back when it is dropped on the object at the other end', async () => {
    const h = renderBoard7();
    const a = seedShape(h, { x: 0, y: 0 });
    const b = seedShape(h, { x: 800, y: 0 });
    const id = seedConnector(h, attached(a, { x: 200, y: 100 }), attached(b, { x: 800, y: 100 }));
    const endsBefore = getConnectorEnds(h.doc(), id)!;

    fireEvent.pointerDown(screen.getByTestId(`connector-hit-${id}`), at(h, 500, 100));
    await settle();

    const start = drawnEnd(id, 'to');
    fireEvent.pointerDown(handle('to'), at(h, start.x, start.y, 34));
    fireEvent.pointerMove(handle('to'), at(h, 100, 100, 34)); // onto A, which holds the other end
    fireEvent.pointerUp(handle('to'), at(h, 100, 100, 34));
    await settle();

    // The model refused it, so the end is where it always was and the arrow is intact.
    expect(getConnectorEnds(h.doc(), id)).toEqual(endsBefore);
    expect(screen.getByTestId(`connector-line-${id}`)).toBeTruthy();
  });

  // connector.follow in the DOM: the stored ends are never rewritten when a shape
  // moves - the line is drawn from where the shapes are now.
  it('follows a shape that moved without its stored ends changing', async () => {
    const h = renderBoard7();
    const a = seedShape(h, { x: 0, y: -800 });
    const b = seedShape(h, { x: 400, y: 0 });
    const id = seedConnector(h, attached(a, { x: 200, y: -700 }), attached(b, { x: 400, y: 100 }));
    const endsBefore = getConnectorEnds(h.doc(), id)!;

    // A dragged shape is a moveObjects of the kind story 7's gesture makes.
    act(() => {
      moveObjects(h.doc(), new Map([[b, { x: 400, y: 400, width: 200, height: 200 }]]));
    });
    await settle();

    expect(Number(line(id).getAttribute('data-to-y'))).toBeCloseTo(400, 3); // B's top, now
    expect(getConnectorEnds(h.doc(), id)).toEqual(endsBefore); // nothing was written
  });

  // connector.target_deleted in the DOM: deleting an object keeps its arrows, with
  // the end left exactly where the object's side was.
  it('keeps the arrow and drops its end where the deleted shape was', async () => {
    const h = renderBoard7();
    const a = seedShape(h, { x: 0, y: 0 });
    const b = seedShape(h, { x: 400, y: 0 });
    const id = seedConnector(h, attached(a, { x: 200, y: 100 }), attached(b, { x: 400, y: 100 }));

    act(() => {
      expect(deleteObjects(h.doc(), [b])).toBe(1);
    });
    await settle();

    const ends = getConnectorEnds(h.doc(), id)!;
    expect(ends.to.kind).toBe('free');
    expect(ends.to).toMatchObject({ x: 400, y: 100 }); // B's facing side, kept as a point
    expect(Number(line(id).getAttribute('data-to-x'))).toBeCloseTo(400, 3);
    expect(h.selectedIds()).toEqual([]); // and nothing of the arrow was selected
  });

  // The minimum is the minimum: an arrow a hair under CONNECTOR_MIN_LENGTH_WORLD is
  // refused, one exactly that long is created.
  it('refuses an arrow shorter than the minimum and takes one exactly as long', async () => {
    const h = renderBoard7();
    let tooShort: string | null = 'not called';
    let exact: string | null = 'not called';
    act(() => {
      tooShort = createConnector(h.doc(), free(0, 0), free(CONNECTOR_MIN_LENGTH_WORLD - 0.1, 0), 'tester');
      exact = createConnector(h.doc(), free(0, 0), free(CONNECTOR_MIN_LENGTH_WORLD, 0), 'tester');
    });

    expect(tooShort).toBeNull();
    expect(typeof exact).toBe('string');
    expect(exact).not.toBeNull();
  });
});
