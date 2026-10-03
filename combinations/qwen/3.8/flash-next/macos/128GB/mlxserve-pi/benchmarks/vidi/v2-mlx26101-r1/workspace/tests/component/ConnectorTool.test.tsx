// connector.ui component tests (story 10, TC-18 to TC-21).
//
// The Connector tool is the one tool in this app whose whole job is a *relationship*: press
// on a thing, drag to another thing, let go, and the two are joined — and then they stay
// joined, which is what the arrow is for. So these tests are mostly about where the pointer
// is and what the document says afterwards:
//
//  * the dots that say "press here" are on the midpoints of an object's four sides, in
//    screen coordinates, measured from the document rather than from the DOM (TC-18);
//  * the dot an arrow would use fills in while the pointer is over it, and letting go there
//    writes an arrow joined to that object (TC-19);
//  * what a person has to hit is the arrow and not a hairline: six screen pixels either
//    side, at every zoom, which is why the tolerance is divided by the zoom (TC-20);
//  * an end of an arrow can be moved, onto another object or out onto empty board, and the
//    arrow says which of the two it is by how it is joined (TC-21).
//
// Screen points are converted with the board's own camera instead of hardcoded numbers: the
// board starts with world 0,0 in the middle of the window, and a test that assumed 0,0 was
// in the corner would be a test of the viewport size.

import { describe, expect, it } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { screenToWorld, worldToScreen, type Camera } from '../../src/client/canvas/camera';
import { getObjectType } from '../../src/client/objects/registry';
import { deleteObject, objectSnapshots } from '../../src/shared/board-model';
import { createShape } from '../../src/shared/objects/shape';
import type { ShapeSnap } from '../../src/shared/objects/shape';
import {
  createConnector,
  endpointObjectId,
  type ConnectorSnap,
} from '../../src/shared/objects/connector';
import { sideAnchors, type Point } from '../../src/shared/geometry';
import {
  CONNECTOR_DOT_RADIUS_PX,
  CONNECTOR_HIT_TOLERANCE_PX,
  CONNECTOR_SIDES,
  CONNECTOR_STROKE_WIDTH_WORLD,
} from '../../src/shared/config';
import {
  boardDoc,
  clickConnector,
  clickObject,
  connectorHandleEl,
  objectEl,
  readCamera,
  renderBoard,
  toolClick,
  toolDrag,
  toolLayer,
  windowKey,
} from './helpers';

function shapes(): ShapeSnap[] {
  return objectSnapshots(boardDoc()).filter((o): o is ShapeSnap => o.type === 'shape');
}

function connectors(): ConnectorSnap[] {
  return objectSnapshots(boardDoc()).filter(
    (o): o is ConnectorSnap => o.type === 'connector',
  );
}

function connector(id: string): ConnectorSnap {
  const found = connectors().find((c) => c.id === id);
  if (!found) throw new Error(`connector ${id} is not on the board`);
  return found;
}

/** The world point a screen point falls on. */
const under = (p: Point): Point => screenToWorld(readCamera(), p);

/** Draw a shape whose centre is at a *screen* point. */
function drawShapeAt(sx: number, sy: number): string {
  const world = under({ x: sx, y: sy });
  let id: string | null = null;
  act(() => {
    id = createShape(boardDoc(), { at: world }, 'local-tab');
  });
  if (id === null) throw new Error('the model refused to create it');
  return id;
}

/** Join two objects with an arrow through the model, and let the board render it. */
function join(from: string, to: string): string {
  const a = shapes().find((s) => s.id === from);
  const b = shapes().find((s) => s.id === to);
  if (!a || !b) throw new Error('both ends have to be shapes');
  let id: string | null = null;
  act(() => {
    id = createConnector(
      boardDoc(),
      { kind: 'attached', objectId: from, fallback: { x: a.x, y: a.y } },
      { kind: 'attached', objectId: to, fallback: { x: b.x, y: b.y } },
      'local-tab',
    );
  });
  if (id === null) throw new Error('the model refused to join them');
  return id;
}

/** Fire a pointer event at a screen point, with the board rendering afterwards. */
function pointerAt(el: Element | Window, type: string, x: number, y: number): void {
  act(() => {
    fireEvent(
      el as Element,
      new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }),
    );
  });
}

/** The dots the tool is showing, in the order they were measured. */
function dots(): Array<{ id: string | null; side: string; x: number; y: number }> {
  return screen.queryAllByTestId('connector-dot').map((el) => ({
    id: el.getAttribute('data-object-id'),
    side: el.getAttribute('data-side') ?? '',
    // The style is a CSS length, and the centre of the dot is one radius out from it.
    x: parseFloat(el.style.left) + CONNECTOR_DOT_RADIUS_PX,
    y: parseFloat(el.style.top) + CONNECTOR_DOT_RADIUS_PX,
  }));
}

/** Which dot the tool says an arrow would use. */
function highlightedDot(): { id: string | null; side: string } | null {
  const el = screen.queryAllByTestId('connector-dot').find(
    (d) => d.getAttribute('data-highlighted') === 'true',
  );
  return el ? { id: el.getAttribute('data-object-id'), side: el.getAttribute('data-side') ?? '' } : null;
}

/**
 * A press on a tool layer, a move, and a look at what the tool says before it lets go —
 * which is the only way to test a preview: it exists in the air and nowhere else.
 */
function hoverAndCheck(
  layer: HTMLElement,
  from: [number, number],
  at: [number, number],
): void {
  pointerAt(layer, 'pointerdown', from[0], from[1]);
  pointerAt(window, 'pointermove', at[0], at[1]);
}

describe('connector.ui', () => {
  // TC-18: hold the Connector tool and every object on the board offers its four sides.
  // The dots are at the midpoints of those sides, in screen pixels, at the zoom the board
  // is at — which is what makes a dot the same size to aim at at 25% as at 400%.
  it('TC-18 shows four dots at the midpoints of an object sides while the tool is held', () => {
    renderBoard();
    const id = drawShapeAt(300, 300);
    expect(screen.queryByTestId('connector-dot')).toBeNull();

    windowKey('l');
    // The pointer has to be over the board for the tool to know where to look.
    pointerAt(toolLayer('connector-tool-layer'), 'pointermove', 300, 300);

    const shown = dots();
    // Four per object: this board has one shape, so four dots and no more.
    expect(shown).toHaveLength(4);
    expect(new Set(shown.map((d) => d.side))).toEqual(new Set(CONNECTOR_SIDES));

    const cam: Camera = readCamera();
    const shape = shapes().find((s) => s.id === id)!;
    const anchors = sideAnchors({ x: shape.x, y: shape.y, width: shape.width, height: shape.height });
    for (const dot of shown) {
      const expected = worldToScreen(cam, anchors[dot.side as keyof typeof anchors]);
      expect(dot.x).toBeCloseTo(expected.x, 6);
      expect(dot.y).toBeCloseTo(expected.y, 6);
    }
    // An arrow's ends are handles, not dots: only the shape is offering sides.
    expect(shown.every((d) => d.id === id)).toBe(true);
  });

  // TC-19: the dot an arrow would use fills in, and letting go there writes the arrow —
  // joined to that object, not to the point the pointer happened to be on.
  it('TC-19 highlights the nearest dot under the pointer and joins what it was released over', () => {
    renderBoard();
    const a = drawShapeAt(200, 300);
    const b = drawShapeAt(600, 300);
    windowKey('l');
    const layer = toolLayer('connector-tool-layer');

    // Press on A's right-hand dot: the arrow starts from a side, not from the middle.
    const cam = readCamera();
    const shapeA = shapes().find((s) => s.id === a)!;
    const right = worldToScreen(cam, {
      x: shapeA.x + shapeA.width,
      y: shapeA.y + shapeA.height / 2,
    });
    // B's own left dot: the dot an arrow would use, which is what fills in.
    const shapeB = shapes().find((s) => s.id === b)!;
    const near = worldToScreen(cam, { x: shapeB.x, y: shapeB.y + shapeB.height / 2 });

    hoverAndCheck(layer, [right.x, right.y], [near.x, near.y]);

    expect(highlightedDot()).toEqual({ id: b, side: 'left' });
    // The arrow being drawn is on screen, and it is attached at the head.
    const preview = screen.getByTestId('connector-preview');
    expect(preview.getAttribute('data-attached')).toBe('true');

    pointerAt(window, 'pointerup', near.x, near.y);

    const created = connectors();
    expect(created).toHaveLength(1);
    expect(created[0].from).toMatchObject({ kind: 'attached', objectId: a });
    expect(created[0].to).toMatchObject({ kind: 'attached', objectId: b });
    // The tool is put down and the new arrow is what is selected (tools.return_to_select).
    expect(screen.getByRole('button', { name: 'Select (V)' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.queryByTestId('connector-preview')).toBeNull();
    void screen.getByTestId(`connector-${created[0].id}`);
  });

  // Letting go over empty board writes nothing: an arrow needs a thing at both ends, and
  // the tool stays where it was so the person can try again (connector.empty).
  it('TC-19b releases over empty board, creates nothing and keeps the tool held', () => {
    renderBoard();
    const a = drawShapeAt(200, 300);
    windowKey('l');
    const layer = toolLayer('connector-tool-layer');
    const cam = readCamera();
    const shapeA = shapes().find((s) => s.id === a)!;
    const right = worldToScreen(cam, { x: shapeA.x + shapeA.width, y: shapeA.y + shapeA.height / 2 });

    hoverAndCheck(layer, [right.x, right.y], [right.x + 200, right.y]);
    expect(highlightedDot()).toBeNull();
    expect(screen.getByTestId('connector-preview').getAttribute('data-attached')).toBe('false');
    pointerAt(window, 'pointerup', right.x + 200, right.y);

    expect(connectors()).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Connector (L)' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  // An arrow that would join one object to itself is refused, and the tool says so by
  // writing nothing rather than by explaining itself (connector.no_self).
  it('TC-19c does not join an object to itself', () => {
    renderBoard();
    const a = drawShapeAt(300, 300);
    windowKey('l');
    const layer = toolLayer('connector-tool-layer');
    const cam = readCamera();
    const box = shapes().find((s) => s.id === a)!;
    const top = worldToScreen(cam, { x: box.x + box.width / 2, y: box.y });
    const bottom = worldToScreen(cam, { x: box.x + box.width / 2, y: box.y + box.height });

    toolDrag(layer, [top.x, top.y], [bottom.x, bottom.y]);
    expect(connectors()).toHaveLength(0);
  });

  // TC-20: what a person has to hit is the arrow and not a hairline. Six screen pixels
  // either side, whatever the zoom — so at 50% five screen pixels of distance still selects
  // and seven do not, and the same is true at 200%. The screen distances are turned into
  // board units by the same rule the board uses.
  it('TC-20 selects an arrow within six screen pixels of its line at any zoom', () => {
    renderBoard();
    const spec = getObjectType('connector');
    if (!spec) throw new Error('connector is not registered');

    const a = drawShapeAt(200, 300);
    const b = drawShapeAt(700, 300);
    const id = join(a, b);
    const snap = connector(id);
    const line = snap.endpoints;
    const middle: Point = {
      x: (line.from.x + line.to.x) / 2,
      y: (line.from.y + line.to.y) / 2,
    };

    for (const zoom of [0.5, 2]) {
      // A screen offset of `px` pixels is px / zoom board units at this zoom.
      const near = { x: middle.x, y: middle.y + 5 / zoom };
      const far = { x: middle.x, y: middle.y + 7 / zoom };
      expect(spec.hitTest(snap, near, zoom)).toBe(true);
      expect(spec.hitTest(snap, far, zoom)).toBe(false);
      // And the tolerance is a screen allowance, so the numbers are different in board
      // units at the two zooms — the boundary moves with the zoom, not with the board.
      expect(CONNECTOR_HIT_TOLERANCE_PX / zoom).toBeGreaterThan(0);
    }

    // Most of an arrow's box is empty board, and most of that is not part of the arrow: a
    // click in the corner of the box it covers does not select it (connector.select). The
    // two objects are at different heights so the arrow is a diagonal, whose box has room
    // in it that the arrow does not cover.
    const high = drawShapeAt(200, 150);
    const low = drawShapeAt(700, 500);
    const diagonal = connector(join(high, low));
    expect(
      spec.hitTest(diagonal, { x: diagonal.x + diagonal.width - 1, y: diagonal.y + 1 }, 1),
    ).toBe(false);
    expect(
      spec.hitTest(
        diagonal,
        {
          x: (diagonal.endpoints.from.x + diagonal.endpoints.to.x) / 2,
          y: (diagonal.endpoints.from.y + diagonal.endpoints.to.y) / 2,
        },
        1,
      ),
    ).toBe(true);
  });

  // With the Select tool, a press on the arrow's line selects it through the object's own
  // hit target, which is drawn the same six screen pixels wide (connector.select).
  it('TC-20b the arrow draws a hit target that is six screen pixels wide either side', () => {
    renderBoard();
    const a = drawShapeAt(200, 300);
    const b = drawShapeAt(700, 300);
    const id = join(a, b);
    const hit = screen.getByTestId(`connector-hit-${id}`);
    const cam = readCamera();
    // The line's own width plus the screen allowance on both sides, in board units at the
    // board's zoom: the drawn target and the rule in registry.tsx are the same allowance.
    const expected = (CONNECTOR_HIT_TOLERANCE_PX * 2 + CONNECTOR_STROKE_WIDTH_WORLD) / cam.zoom;
    expect(Number(hit.getAttribute('stroke-width'))).toBeCloseTo(expected, 6);
  });

  // TC-21: an end of an arrow can be moved. Onto another object and it is joined to that
  // object; out onto empty board and it is a point on the board, at the place the pointer
  // was let go. Both are the same gesture and the arrow says which one it is by how it is
  // joined, not by anything it remembers about the gesture.
  it('TC-21 drags an end onto another object and it joins that object', () => {
    renderBoard();
    const a = drawShapeAt(200, 200);
    const b = drawShapeAt(200, 600);
    const c = drawShapeAt(650, 200);
    const id = join(a, b);
    // An arrow's ends are handles on a selected arrow, so it is selected first — by its
    // line, because its box is empty board (connector.select).
    clickConnector(id);

    // Hold the Connector tool and press where the arrow's far end is drawn: the tool
    // recognises the handle of a selected arrow before it starts a new arrow, so the ends
    // of an arrow are reachable while its tool is held.
    windowKey('l');
    const layer = toolLayer('connector-tool-layer');
    const cam = readCamera();
    const endB = worldToScreen(cam, connector(id).endpoints.to);
    const shapeC = shapes().find((s) => s.id === c)!;
    const onC = worldToScreen(cam, { x: shapeC.x + 8, y: shapeC.y + shapeC.height / 2 });

    toolDrag(layer, [endB.x, endB.y], [onC.x, onC.y]);

    const after = connector(id);
    expect(after.to).toMatchObject({ kind: 'attached', objectId: c });
    // The end that was not touched is exactly where it was.
    expect(after.from).toMatchObject({ kind: 'attached', objectId: a });
  });

  // The same handle with the Select tool held: the object draws the handle and hands the
  // press to the tool that owns it, so an end can be moved without ever changing tools
  // (connector.handles).
  it('TC-21b moves an end from the handle itself while Select is held', () => {
    renderBoard();
    const a = drawShapeAt(200, 200);
    const b = drawShapeAt(200, 600);
    const c = drawShapeAt(650, 200);
    const id = join(a, b);

    // Select the arrow first: handles belong to a selected arrow (connector.handles).
    clickConnector(id);
    const handle = connectorHandleEl(id, 'to');
    const shapeC = shapes().find((s) => s.id === c)!;
    const cam = readCamera();
    const onC = worldToScreen(cam, { x: shapeC.x + 8, y: shapeC.y + shapeC.height / 2 });

    pointerAt(handle, 'pointerdown', 0, 0);
    pointerAt(window, 'pointermove', onC.x, onC.y);
    pointerAt(window, 'pointerup', onC.x, onC.y);

    expect(connector(id).to).toMatchObject({ kind: 'attached', objectId: c });
  });

  // TC-21's other half: released over empty board, the end becomes a point on the board at
  // the place it was released — not the nearest object, not the object it was pointing at
  // before, just a point (connector.drag_free).
  it('TC-21c releases an end over empty board as a point where it was let go', () => {
    renderBoard();
    const a = drawShapeAt(200, 200);
    const b = drawShapeAt(200, 600);
    const id = join(a, b);
    clickConnector(id);

    windowKey('l');
    const layer = toolLayer('connector-tool-layer');
    const cam = readCamera();
    const endB = worldToScreen(cam, connector(id).endpoints.to);
    const release: [number, number] = [endB.x + 260, endB.y + 40];

    toolDrag(layer, [endB.x, endB.y], release);

    const to = connector(id).to;
    expect(to.kind).toBe('free');
    if (to.kind !== 'free') throw new Error('the end should be free');
    const want = under({ x: release[0], y: release[1] });
    expect(to.x).toBeCloseTo(want.x, 6);
    expect(to.y).toBeCloseTo(want.y, 6);
  });

  // An end that is dragged onto the object the other end is joined to is refused by the
  // model, and the tool puts the end back where the drag started rather than leaving an
  // An end is never joined to the object the other end is already joined to. The model
  // refuses such an arrow, so the tool does not even offer that object while the end is
  // travelling: released over it, the end stays a point on the board where the pointer was
  // let go, and the arrow is never stored with one object at both ends. One Ctrl+Z puts the
  // whole drag back, because a person made it as one movement (connector.no_self, undo.step).
  it('TC-21d never joins an arrow to one object twice, and undoes the drag in one step', () => {
    renderBoard();
    const a = drawShapeAt(200, 200);
    const b = drawShapeAt(600, 200);
    const id = join(a, b);
    const before = connector(id).to;
    clickConnector(id);

    windowKey('l');
    const layer = toolLayer('connector-tool-layer');
    const cam = readCamera();
    const endB = worldToScreen(cam, connector(id).endpoints.to);
    const endA = worldToScreen(cam, connector(id).endpoints.from);

    toolDrag(layer, [endB.x, endB.y], [endA.x, endA.y]);

    expect(endpointObjectId(connector(id).to)).not.toBe(a);
    expect(connectors()).toHaveLength(1);
    expect(endpointObjectId(connector(id).from)).toBe(a);

    // The end of the arrow is where the drag left it, and one undo returns it to where the
    // drag started: the whole drag is one step.
    windowKey('z', { ctrlKey: true });
    expect(connector(id).to).toEqual(before);
  });

  // The follow rule, tested where it is actually seen: the arrow is not stored as a line,
  // so moving the object it points at moves the end. This is the one behaviour this whole
  // story exists for (connector.follows).
  it('TC-21e moves the object and the arrow end moves with it', () => {
    renderBoard();
    const a = drawShapeAt(200, 200);
    const b = drawShapeAt(600, 200);
    const id = join(a, b);
    const before = connector(id).endpoints;

    // Move B with the board's own gesture: press it, drag down, release.
    clickObject(b);
    pointerAt(objectEl(b), 'pointerdown', 0, 0);
    pointerAt(window, 'pointermove', 0, 120);
    pointerAt(window, 'pointerup', 0, 120);

    const moved = shapes().find((s) => s.id === b)!;
    expect(moved.y).toBeGreaterThan(before.to.y - 1);
    const after = connector(id).endpoints;
    // The end that points at B is no longer where it was: it is on B's side again.
    expect(after.to.y).not.toBeCloseTo(before.to.y, 6);
    // The end that points at A has not moved at all.
    expect(after.from).toEqual(before.from);
  });

  // A click on empty board while the tool is held creates nothing and clears the selection,
  // because that is what a click on empty board has always meant here.
  it('TC-21f a press on empty board with the tool held writes nothing', () => {
    renderBoard();
    drawShapeAt(200, 200);
    windowKey('l');
    toolClick(toolLayer('connector-tool-layer'), [40, 40]);
    expect(connectors()).toHaveLength(0);
    expect(screen.queryByTestId('connector-preview')).toBeNull();
  });

  // A press held over a dot is a promise about a moment that has not happened yet, and the
  // moment can have changed underneath it: while the pointer is sitting on B's dot, the other
  // tab deletes B. The release is answered from the document as it is when the pointer lets
  // go, not as it was when the pointer last moved, so the end becomes a point on the board at
  // that place rather than a join to an object that has left the board. An arrow may outlive
  // the object it was pointed at, but it never claims to be joined to it (connector.no_target).
  it('TC-21g releases an end over an object the other tab deleted during the drag', () => {
    renderBoard();
    const a = drawShapeAt(200, 200);
    const b = drawShapeAt(600, 200);
    windowKey('l');
    const layer = toolLayer('connector-tool-layer');
    const cam = readCamera();
    const dotOn = (id: string, side: 'top' | 'right' | 'bottom' | 'left'): Point => {
      const shape = shapes().find((s) => s.id === id);
      if (!shape) throw new Error('the shape is gone');
      const anchor = sideAnchors({
        x: shape.x,
        y: shape.y,
        width: shape.width,
        height: shape.height,
      })[side];
      return worldToScreen(cam, anchor);
    };

    // A press on A's dot, travelled to B's dot, and held there.
    const start = dotOn(a, 'right');
    const finish = dotOn(b, 'left');
    pointerAt(layer, 'pointerdown', start.x, start.y);
    pointerAt(window, 'pointermove', finish.x, finish.y);
    expect(highlightedDot()).toEqual({ id: b, side: 'left' });

    // The other person deletes B while this press is still held. What is on the screen is what
    // the last measurement found, and the measurement follows the pointer: the next move is
    // measured from the document as it is now, and B is not in it.
    act(() => {
      deleteObject(boardDoc(), b);
    });
    pointerAt(window, 'pointermove', finish.x, finish.y);
    expect(screen.queryAllByTestId('connector-dot')).toHaveLength(4);

    // Letting go there writes an arrow whose end is a point on the board, and that point is
    // the place the pointer was let go.
    pointerAt(window, 'pointerup', finish.x, finish.y);
    const list = connectors();
    expect(list).toHaveLength(1);
    const made = list[0]!;
    expect(endpointObjectId(made.from), 'the end that left A is joined to A').toBe(a);
    expect(made.to.kind, 'the end that reached for B is a point on the board').toBe('free');
    if (made.to.kind === 'free') {
      const at = under(finish);
      expect(made.to.x).toBeCloseTo(at.x, 3);
      expect(made.to.y).toBeCloseTo(at.y, 3);
    }
    expect(screen.queryAllByTestId('connector-preview')).toHaveLength(0);
  });
});
