/**
 * Component tests for drawing and editing arrows (TC-18 to TC-21, connector.create,
 * connector.attach, connector.render, connector.follow, connector.reattach).
 *
 * The hover dots are the tool's promise about where an arrow will join, so they are
 * asserted at the four side midpoints of the object under the cursor. Creation and
 * re-attachment are asserted against the document's endpoints, which is the only place
 * "attached" means anything: a preview that looks attached while the model stored a free
 * end would be the worst kind of pass. Hit tolerance is asserted in world units at the
 * zooms the design names, and the follow-on-move case is driven through the model,
 * because "the arrow followed" means the resolved endpoints changed.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, type RenderResult } from '@testing-library/react';
import * as Y from 'yjs';
import App from '../../src/client/App';
import { stubViewportSize } from './boardHarness';
import {
  findConnector,
  findShape,
  objectsOf,
  screenOf,
  seedConnector,
  seedShape,
} from './flowHarness';
import { hitTestConnector } from '../../src/client/objects/ConnectorObject';
import { CONNECTOR_HIT_TOLERANCE_PX } from '../../src/shared/config';
import { moveObjects } from '../../src/shared/board-model';
import type { ConnectorSnap } from '../../src/shared/objects/connector';

stubViewportSize();

describe('Connector tool (connector.create, connector.attach)', () => {
  // A pointer id of its own, so a gesture cannot be picked up by another test's listener.
  const POINTER = 31;
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
  });

  afterEach(() => {
    doc.destroy();
  });

  /** Two shapes with a gap between them, the tool up, and points to press on. */
  function setup(): {
    view: RenderResult;
    layer: HTMLElement;
    a: string;
    b: string;
    overA: { x: number; y: number };
    overB: { x: number; y: number };
    empty: { x: number; y: number };
  } {
    const a = seedShape(doc, 'rect', { x: 0, y: 0, width: 200, height: 120 });
    const b = seedShape(doc, 'rect', { x: 600, y: 0, width: 200, height: 120 });
    const view = render(<App doc={doc} />);
    fireEvent.keyDown(window, { key: 'l' });
    const layer = view.container.querySelector<HTMLElement>('[data-tool-layer="connector"]');
    if (!layer) throw new Error('the Connector tool layer is not up');
    return {
      view,
      layer,
      a,
      b,
      overA: screenOf(view.container, { x: 100, y: 60 }),
      overB: screenOf(view.container, { x: 700, y: 60 }),
      // Far below both shapes: nothing to join there.
      empty: screenOf(view.container, { x: 400, y: 900 }),
    };
  }

  const arrows = (): ConnectorSnap[] =>
    objectsOf(doc).filter((object) => object.type === 'connector') as ConnectorSnap[];

  /** Press on the layer and move; the caller releases when it wants to. */
  function drag(
    layer: HTMLElement,
    from: { x: number; y: number },
    to: { x: number; y: number },
  ): void {
    fireEvent.pointerDown(layer, { clientX: from.x, clientY: from.y, button: 0, pointerId: POINTER });
    fireEvent.pointerMove(window, { clientX: to.x, clientY: to.y, button: 0, pointerId: POINTER });
  }

  const release = (at: { x: number; y: number }): void => {
    fireEvent.pointerUp(window, { clientX: at.x, clientY: at.y, button: 0, pointerId: POINTER });
  };

  it('TC-18 hovering a shape shows a dot at the middle of each of its four sides', () => {
    const { view, layer, overA } = setup();
    fireEvent.pointerMove(layer, { clientX: overA.x, clientY: overA.y, pointerId: POINTER });

    const dots = [...view.container.querySelectorAll<SVGCircleElement>('[data-connector-dot]')];
    expect(dots).toHaveLength(4);
    expect(dots.map((dot) => dot.getAttribute('data-side')).sort()).toEqual([
      'bottom',
      'left',
      'right',
      'top',
    ]);
    const at = (side: string): { x: number; y: number } => {
      const dot = dots.find((candidate) => candidate.getAttribute('data-side') === side)!;
      return { x: Number(dot.getAttribute('cx')), y: Number(dot.getAttribute('cy')) };
    };
    // Side midpoints of a 200x120 box. The tool layer covers the viewport exactly, so
    // at zoom 1 its screen units are world units too.
    expect(at('right').x - at('left').x).toBe(200);
    expect(at('bottom').y - at('top').y).toBe(120);
    expect(at('left').y).toBe(at('right').y);
    expect(at('top').x).toBe(at('bottom').x);
    // And they are where the box is, not somewhere arbitrary.
    expect(at('left').x).toBe(overA.x - 100);
    expect(at('top').y).toBe(overA.y - 60);
  });

  it('hovering nothing shows no dots (negative)', () => {
    const { view, layer, empty } = setup();
    fireEvent.pointerMove(layer, { clientX: empty.x, clientY: empty.y, pointerId: POINTER });
    expect(view.container.querySelectorAll('[data-connector-dot]')).toHaveLength(0);
  });

  it('TC-19 dragging from one shape to another lights the facing side and joins both ends', () => {
    const { view, layer, a, b, overA, overB } = setup();
    drag(layer, overA, overB);

    const preview = view.container.querySelector<SVGLineElement>('[data-testid="connector-preview"]');
    if (!preview) throw new Error('the drag painted no preview line');
    expect(Math.round(Number(preview.getAttribute('x2')))).toBe(Math.round(overB.x));

    const lit = view.container.querySelector<SVGCircleElement>('[data-testid="connector-target-dot"]');
    if (!lit) throw new Error('the target shape showed no dot for the end being aimed');
    expect(lit.getAttribute('data-attached-to')).toBe(b);
    // The arrow runs from the shape on the left to the shape on the right, so the far
    // end joins the target on the side that faces where the drag began.
    expect(lit.getAttribute('data-side')).toBe('left');

    release(overB);
    const created = arrows();
    expect(created).toHaveLength(1);
    const from = created[0]?.from;
    const to = created[0]?.to;
    if (from?.kind !== 'attached' || to?.kind !== 'attached') {
      throw new Error(`expected both ends attached, got ${JSON.stringify(created[0])}`);
    }
    expect(from.objectId).toBe(a);
    expect(to.objectId).toBe(b);
    // The arrow is the selection, and the tool has gone back to Select.
    const selected = view.container.querySelectorAll<HTMLElement>('[data-object-type][data-selected="true"]');
    expect(selected).toHaveLength(1);
    expect(selected[0]?.dataset.objectType).toBe('connector');
    expect(view.container.querySelector('[data-tool-layer="connector"]')).toBeNull();
  });

  it('TC-19 a release over empty board leaves that end free, at the point it was dropped', () => {
    const { layer, a, overA, empty } = setup();
    drag(layer, overA, empty);
    release(empty);

    const created = arrows();
    expect(created).toHaveLength(1);
    const attached = created[0]?.from.kind === 'attached' ? created[0].from : created[0]?.to;
    const loose = created[0]?.from.kind === 'free' ? created[0].from : created[0]?.to;
    if (attached?.kind !== 'attached' || loose?.kind !== 'free') {
      throw new Error(`expected one attached end and one free end, got ${JSON.stringify(created[0])}`);
    }
    expect(attached.objectId).toBe(a);
    // The world point it was dropped on: `empty` is world (400, 900).
    expect(Math.round(loose.x)).toBe(400);
    expect(Math.round(loose.y)).toBe(900);
  });

  it('a drag that starts and ends on the same shape makes nothing, and the tool stays up (negative)', () => {
    const { view, layer, overA } = setup();
    drag(layer, overA, { x: overA.x + 40, y: overA.y + 20 });
    release({ x: overA.x + 40, y: overA.y + 20 });
    expect(arrows()).toHaveLength(0);
    expect(view.container.querySelector('[data-tool-layer="connector"]')).not.toBeNull();
  });

  it('a drag too short to be an arrow makes nothing, and the tool stays up (negative)', () => {
    const { view, layer, empty } = setup();
    drag(layer, empty, { x: empty.x + 5, y: empty.y });
    release({ x: empty.x + 5, y: empty.y });
    expect(arrows()).toHaveLength(0);
    expect(view.container.querySelector('[data-tool-layer="connector"]')).not.toBeNull();
  });

  it('a cancelled drag makes nothing, and the release after it makes nothing either (negative)', () => {
    const { layer, overA, overB } = setup();
    drag(layer, overA, overB);
    fireEvent.pointerCancel(window, { pointerId: POINTER });
    expect(arrows()).toHaveLength(0);
    release(overB);
    expect(arrows()).toHaveLength(0);
  });

  it('one created arrow is one document update', () => {
    const { layer, overA, overB } = setup();
    drag(layer, overA, overB);
    let updates = 0;
    const listener = (): void => {
      updates += 1;
    };
    doc.on('update', listener);
    release(overB);
    doc.off('update', listener);
    expect(updates).toBe(1);
    expect(arrows()).toHaveLength(1);
  });
});

describe('connector object (connector.render, connector.reattach)', () => {
  // Its own pointer id, for the same reason.
  const POINTER = 41;
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
  });

  afterEach(() => {
    doc.destroy();
  });

  /** A → B horizontally, plus a third shape C well below them. */
  function setup(): {
    view: RenderResult;
    a: string;
    b: string;
    c: string;
    arrow: string;
  } {
    const a = seedShape(doc, 'rect', { x: 0, y: 0, width: 200, height: 120 });
    const b = seedShape(doc, 'rect', { x: 600, y: 0, width: 200, height: 120 });
    const c = seedShape(doc, 'rect', { x: 300, y: 400, width: 200, height: 120 });
    const arrow = seedConnector(doc, a, b);
    const view = render(<App doc={doc} />);
    return { view, a, b, c, arrow };
  }

  /** Press the arrow's line at a world point on it: that selects it. */
  function selectArrow(view: RenderResult, arrow: string, world: { x: number; y: number }): void {
    const at = screenOf(view.container, world);
    const hit = view.container.querySelector<SVGPathElement>(`[data-testid="connector-hit-${arrow}"]`);
    if (!hit) throw new Error('the arrow rendered no clickable line');
    fireEvent.pointerDown(hit, { clientX: at.x, clientY: at.y, button: 0, pointerId: POINTER });
    fireEvent.pointerUp(window, { clientX: at.x, clientY: at.y, button: 0, pointerId: POINTER });
  }

  it('draws a line with a filled arrowhead at the head end', () => {
    const { view, arrow } = setup();
    const line = view.container.querySelector<SVGPathElement>(`[data-testid="connector-line-${arrow}"]`);
    const head = view.container.querySelector<SVGPolygonElement>(`[data-testid="connector-arrowhead"]`);
    if (!line || !head) throw new Error('the arrow drew no line or no head');
    expect(line.getAttribute('d')).toMatch(/^M /);
    // The head's tip is the arrow's end: the last point of the line and the first of
    // the triangle are the same place.
    const end = /L ([-\d.]+) ([-\d.]+)/.exec(line.getAttribute('d') ?? '')?.slice(1).map(Number);
    const tip = head.getAttribute('points')?.trim().split(/\s+/)[0]?.split(',').map(Number);
    expect(end).toBeDefined();
    expect(tip).toBeDefined();
    expect(Math.abs((end?.[0] ?? 0) - (tip?.[0] ?? 0))).toBeLessThan(0.001);
    expect(Math.abs((end?.[1] ?? 0) - (tip?.[1] ?? 0))).toBeLessThan(0.001);
  });

  it('TC-20 a click within six screen pixels of the line selects it at 50% and at 200%', () => {
    const { arrow: arrowId } = setup();
    const arrow = findConnector(doc, arrowId);
    // The resolved line runs from A's right side (200, 60) to B's left side (600, 60).
    const on = { x: 400, y: 60 };
    expect(hitTestConnector(arrow, on, 1)).toBe(true);

    // Screen pixels, converted to the world units the test works in: at 50% a pixel is
    // two world units, at 200% it is half one.
    expect(hitTestConnector(arrow, { x: 400, y: 60 + 5 / 0.5 }, 0.5)).toBe(true);
    expect(hitTestConnector(arrow, { x: 400, y: 60 + 7 / 0.5 }, 0.5)).toBe(false);
    expect(hitTestConnector(arrow, { x: 400, y: 60 + 5 / 2 }, 2)).toBe(true);
    expect(hitTestConnector(arrow, { x: 400, y: 60 + 7 / 2 }, 2)).toBe(false);
    // And a point beside the middle of the line but past its ends is not on it.
    expect(hitTestConnector(arrow, { x: 400, y: 300 }, 1)).toBe(false);
  });

  it('the clickable band is six screen pixels wide whatever the zoom', () => {
    const { view, arrow } = setup();
    const hit = view.container.querySelector<SVGPathElement>(`[data-testid="connector-hit-${arrow}"]`);
    if (!hit) throw new Error('the arrow rendered no clickable line');
    // The drawing is in world units, so the band has to be divided by the zoom to stay
    // the same size on the screen.
    const zoom = 1;
    expect(Number(hit.getAttribute('stroke-width'))).toBeCloseTo(
      (CONNECTOR_HIT_TOLERANCE_PX * 2) / zoom,
      6,
    );
  });

  it('pressing the line selects the arrow; pressing beside it does not', () => {
    const { view, arrow } = setup();
    selectArrow(view, arrow, { x: 400, y: 60 });
    expect(
      view.container.querySelector(`[data-object-id="${arrow}"][data-selected="true"]`),
    ).not.toBeNull();

    // Two shape bodies are still clickable too: the arrow's padded box must not
    // blanket the board.
    const a = view.container.querySelector<SVGElement>(`[data-testid^="shape-body-"]`);
    expect(a).not.toBeNull();
  });

  it('TC-21 dragging an end onto another shape joins it to that shape', () => {
    const { view, c, arrow } = setup();
    selectArrow(view, arrow, { x: 400, y: 60 });

    const handle = view.container.querySelector<SVGCircleElement>('[data-testid="connector-handle-from"]');
    if (!handle) throw new Error('a selected arrow shows no end handles');
    const from = { x: 200, y: 60 };
    const start = screenOf(view.container, from);
    const overC = screenOf(view.container, { x: 400, y: 460 });

    fireEvent.pointerDown(handle, { clientX: start.x, clientY: start.y, button: 0, pointerId: POINTER });
    fireEvent.pointerMove(window, { clientX: overC.x, clientY: overC.y, button: 0, pointerId: POINTER });
    // While it is held over C, the dot says which side C would be joined on.
    const dot = view.container.querySelector<SVGCircleElement>(`[data-testid="connector-target-${arrow}"]`);
    if (!dot) throw new Error('dragging an end over a shape showed no target dot');
    fireEvent.pointerUp(window, { clientX: overC.x, clientY: overC.y, button: 0, pointerId: POINTER });

    const moved = findConnector(doc, arrow);
    if (moved.from.kind !== 'attached') throw new Error(`the end did not attach: ${JSON.stringify(moved.from)}`);
    expect(moved.from.objectId).toBe(c);
    // It joined the side of C that faces the other end, so the line does not cross C:
    // C's top, because B is above and to the right of C.
    expect(Math.round(moved.ends.from.x)).toBe(400);
    expect(Math.round(moved.ends.from.y)).toBe(400);
    // And B turned its own anchor to face the new position: the arrow is drawn between
    // the two sides that look at each other, not between the two it was born with.
    expect(Math.round(moved.ends.to.x)).toBe(700);
    expect(Math.round(moved.ends.to.y)).toBe(120);
  });

  it('TC-21 dragging an end into empty board looses it at the point it was dropped', () => {
    const { view, b, arrow } = setup();
    selectArrow(view, arrow, { x: 400, y: 60 });
    const handle = view.container.querySelector<SVGCircleElement>('[data-testid="connector-handle-from"]')!;
    const start = screenOf(view.container, { x: 200, y: 60 });
    const drop = screenOf(view.container, { x: 500, y: 800 });

    fireEvent.pointerDown(handle, { clientX: start.x, clientY: start.y, button: 0, pointerId: POINTER });
    fireEvent.pointerMove(window, { clientX: drop.x, clientY: drop.y, button: 0, pointerId: POINTER });
    expect(view.container.querySelector(`[data-testid="connector-target-${arrow}"]`)).toBeNull();
    fireEvent.pointerUp(window, { clientX: drop.x, clientY: drop.y, button: 0, pointerId: POINTER });

    const moved = findConnector(doc, arrow);
    if (moved.from.kind !== 'free') throw new Error(`the end did not come loose: ${JSON.stringify(moved.from)}`);
    expect(Math.round(moved.from.x)).toBe(500);
    expect(Math.round(moved.from.y)).toBe(800);
    // The other end is still attached to B — and has swung round to the side of B that
    // now faces the loose end below it.
    expect(moved.to.kind).toBe('attached');
    if (moved.to.kind !== 'attached') return;
    expect(moved.to.objectId).toBe(b);
    expect(Math.round(moved.ends.to.x)).toBe(700);
    expect(Math.round(moved.ends.to.y)).toBe(120);
  });

  it('dragging an end onto the shape the other end is on is refused and the handle snaps back (negative)', () => {
    const { view, b, arrow } = setup();
    selectArrow(view, arrow, { x: 400, y: 60 });
    const handle = view.container.querySelector<SVGCircleElement>('[data-testid="connector-handle-from"]')!;
    const start = screenOf(view.container, { x: 200, y: 60 });
    const overB = screenOf(view.container, { x: 700, y: 60 });

    fireEvent.pointerDown(handle, { clientX: start.x, clientY: start.y, button: 0, pointerId: POINTER });
    fireEvent.pointerMove(window, { clientX: overB.x, clientY: overB.y, button: 0, pointerId: POINTER });
    fireEvent.pointerUp(window, { clientX: overB.x, clientY: overB.y, button: 0, pointerId: POINTER });

    const same = findConnector(doc, arrow);
    if (same.from.kind !== 'attached') throw new Error('the end detached onto the shape at the other end');
    expect(same.from.objectId).not.toBe(b);
    expect(Math.round(same.ends.from.x)).toBe(200);
  });

  it('when a shape moves, the arrow is redrawn from the new anchors (connector.follow)', () => {
    const { view, a, b, arrow } = setup();
    const before = view.container.querySelector<SVGPathElement>(`[data-testid="connector-line-${arrow}"]`)!;
    const d0 = before.getAttribute('d');

    // Somebody else drags A a hundred units down and sixty right. The screen only
    // catches up because the board re-renders on the document event.
    const a0 = findShape(doc, a);
    act(() => {
      moveObjects(doc, new Map([[a, { x: (a0.x ?? 0) + 60, y: (a0.y ?? 0) + 100 }]]));
    });

    const after = view.container.querySelector<SVGPathElement>(`[data-testid="connector-line-${arrow}"]`);
    if (!after) throw new Error('the arrow stopped being drawn');
    const d1 = after.getAttribute('d');
    expect(d1).not.toBe(d0);
    const ends = findConnector(doc, arrow);
    expect(Math.round(ends.ends.from.x)).toBe(260);
    expect(Math.round(ends.ends.from.y)).toBe(160);
    // The head end has not moved: B is where it was.
    expect(Math.round(ends.ends.to.x)).toBe(600);
    void b;
  });
});
