import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { act, screen } from '@testing-library/react';
import * as Y from 'yjs';
import {
  activeTool,
  activeConnectorDot,
  boardElement,
  connectorDots,
  connectorElement,
  connectorElements,
  connectorHandleElement,
  connectorOf,
  connectorPreviewLine,
  createConnectorObject,
  createShapeObject,
  docConnectors,
  flushFrame,
  offsetFromConnector,
  pointerAt,
  pointerEvent,
  pressKey,
  readCamera,
  renderBoard,
  screenOf,
  selectionCount,
  shapeCentre,
  shapeLabelElement,
  shapeOf,
  shapeSideMidpoints,
  toolButton,
  worldOf,
  dispatchWheel,
} from './harness';
import { moveObject } from '../../src/shared/board-model';
import {
  CHECKOUT_FLOW_CONNECTORS,
  CHECKOUT_FLOW_SHAPES,
  checkoutFlowObjects,
  seedCheckoutFlow,
} from '../fixtures/checkout-flow';
import { CONNECTOR_DOT_RADIUS_PX, CONNECTOR_HIT_TOLERANCE_PX } from '../../src/shared/config';

/**
 * Arrows between objects (`connector.ui`: TC-18 to TC-21).
 *
 * The board is rendered, the pointer is moved over it, and what is checked is the
 * document that came out and the arrow that got drawn - including the two things
 * that make an arrow different from every other object on the board: it is selected
 * by *distance* rather than by a box (`connector.select`), and its ends are stored
 * as attachments, so the arrow moves when the objects do (`connector.follow`).
 */

/**
 * Turn the wheel at the board's own zoom sensitivity, `steps` times (negative to
 * zoom in), and report the zoom the board ended at - the hit test is defined in
 * screen pixels divided by whatever that zoom is.
 */
async function zoomBy(steps: number): Promise<number> {
  for (let step = 0; step < Math.abs(steps); step += 1) {
    dispatchWheel(boardElement(), {
      deltaY: steps > 0 ? 100 : -100,
      ctrlKey: true,
      clientX: 0,
      clientY: 0,
    });
    await flushFrame();
  }
  return readCamera().zoom;
}

describe('connector tool and connector object (connector.ui)', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
  });

  it('TC-18: hovering a shape with the Connector tool shows four dots at its side midpoints', async () => {
    const id = createShapeObject(doc, { at: { x: 300, y: 300 } });
    renderBoard({ doc });
    await flushFrame();

    // No tool, no dots: the board is not being used to connect anything.
    expect(connectorDots()).toHaveLength(0);

    pressKey('l');
    expect(activeTool()).toBe('connector');
    expect(toolButton('connector').getAttribute('aria-pressed')).toBe('true');

    const centre = shapeCentre(id, doc);
    pointerEvent('pointermove', centre.x, centre.y);
    await flushFrame();

    const dots = connectorDots();
    expect(dots).toHaveLength(4);
    const expected = shapeSideMidpoints(doc, id);
    const sides = ['top', 'right', 'bottom', 'left'] as const;
    for (const side of sides) {
      const dot = dots.find((entry) => entry.getAttribute('data-side') === side);
      expect(dot, `the ${side} dot`).toBeTruthy();
      // `CONNECTOR_DOT_RADIUS_PX` on the screen at any zoom, centred on the midpoint.
      expect(parseFloat(dot!.style.width)).toBe(CONNECTOR_DOT_RADIUS_PX * 2);
      expect(parseFloat(dot!.style.left)).toBeCloseTo(expected[side].x - CONNECTOR_DOT_RADIUS_PX, 1);
      expect(parseFloat(dot!.style.top)).toBeCloseTo(expected[side].y - CONNECTOR_DOT_RADIUS_PX, 1);
      expect(dot!.getAttribute('data-active')).toBe('false');
    }

    // Moving off the object takes the dots away (`connector.hover_points`).
    pointerEvent('pointermove', centre.x + 600, centre.y - 400);
    await flushFrame();
    expect(connectorDots()).toHaveLength(0);

    // Pressing L again is not a toggle: the tool is still held (`tool.shortcuts`).
    pressKey('l');
    await flushFrame();
    expect(activeTool()).toBe('connector');
    expect(activeConnectorDot()).toBeNull();
  });

  it('TC-19: dragging from one shape to another highlights the dot it will attach to and creates one arrow', async () => {
    const a = createShapeObject(doc, { at: { x: 200, y: 300 } });
    const b = createShapeObject(doc, { at: { x: 600, y: 300 } });
    renderBoard({ doc });
    await flushFrame();

    pressKey('l');
    const start = shapeCentre(a, doc);
    pointerEvent('pointerdown', start.x, start.y);
    await flushFrame();

    // A press that found an object to attach to is a drag, not a board click.
    expect(selectionCount()).toBe(0);

    // Release a little inside B's left edge: the left dot is the one nearest the
    // pointer, and it is the one the arrow will be attached to.
    const shapeB = shapeOf(doc, b);
    const over = screenOf({ x: shapeB.x + 10, y: shapeB.y + shapeB.height / 2 });
    pointerEvent('pointermove', over.x - 40, over.y);
    await flushFrame();
    pointerEvent('pointermove', over.x, over.y);
    await flushFrame();

    const dots = connectorDots();
    expect(dots).toHaveLength(4);
    const active = activeConnectorDot();
    expect(active).not.toBeNull();
    expect(active!.getAttribute('data-side')).toBe('left');
    expect(connectorPreviewLine()).not.toBeNull();

    pointerEvent('pointerup', over.x, over.y);
    await flushFrame();

    const connectors = docConnectors(doc);
    expect(connectors).toHaveLength(1);
    const id = connectors[0]!.id;
    // What is stored: two attachments and nothing else - no side, no coordinates
    // (`connector.endpoints`).
    const connector = connectorOf(doc, id);
    const shapeA = shapeOf(doc, a);
    expect(connector.from.kind).toBe('attached');
    expect(connector.to.kind).toBe('attached');
    expect(connector.from.kind === 'attached' ? connector.from.objectId : '').toBe(a);
    expect(connector.to.kind === 'attached' ? connector.to.objectId : '').toBe(b);
    // What is drawn: each end on the side of its object that faces the other end.
    expect(connector.points.from).toEqual({
      x: shapeA.x + shapeA.width,
      y: shapeA.y + shapeA.height / 2,
    });
    expect(connector.points.to).toEqual({
      x: shapeB.x,
      y: shapeB.y + shapeB.height / 2,
    });

    // The arrow is drawn, selected, and the tool is put away.
    expect(connectorElement(id)).toBeTruthy();
    expect(connectorElements()).toHaveLength(1);
    expect(selectionCount()).toBe(1);
    expect(activeTool()).toBe('select');
    expect(connectorDots()).toHaveLength(0);
    expect(connectorPreviewLine()).toBeNull();
  });

  it('a drag released over empty space creates an arrow with a free end where it was released', async () => {
    const a = createShapeObject(doc, { at: { x: 200, y: 300 } });
    renderBoard({ doc });
    await flushFrame();

    pressKey('l');
    const start = shapeCentre(a, doc);
    pointerEvent('pointerdown', start.x, start.y);
    await flushFrame();
    const release = { x: start.x + 500, y: start.y + 200 };
    pointerEvent('pointermove', release.x, release.y);
    await flushFrame();
    pointerEvent('pointerup', release.x, release.y);
    await flushFrame();

    const id = docConnectors(doc)[0]!.id;
    const connector = connectorOf(doc, id);
    expect(connector.from.kind).toBe('attached');
    expect(connector.to.kind).toBe('free');
    const world = worldOf(release);
    expect(connector.to.kind === 'free' ? connector.to.x : 0).toBeCloseTo(world.x, 2);
    expect(connector.to.kind === 'free' ? connector.to.y : 0).toBeCloseTo(world.y, 2);
  });

  it('TC-20: a click within the tolerance of the line selects the arrow, one outside it does not', async () => {
    const from = { x: 100, y: 300 };
    const to = { x: 700, y: 300 };
    const id = createConnectorObject(doc, { kind: 'free', x: from.x, y: from.y }, { kind: 'free', x: to.x, y: to.y });
    renderBoard({ doc });
    await flushFrame();

    // Out at half size and in at double: the tolerance is 6 pixels on the screen at
    // either zoom, which is a different distance on the board at each (`connector.select`).
    for (const steps of [-2, 2]) {
      const zoom = await zoomBy(steps);
      expect(zoom).not.toBe(1);

      // A press, released where it landed, is a board click: `connector.select`
      // decides by distance, at this zoom, in world units (`CONNECTOR_HIT_TOLERANCE_PX`
      // divided by zoom).
      const near = offsetFromConnector(connectorOf(doc, id), CONNECTOR_HIT_TOLERANCE_PX - 1);
      pointerEvent('pointerdown', near.x, near.y);
      await flushFrame();
      pointerEvent('pointerup', near.x, near.y);
      await flushFrame();
      expect(selectionCount()).toBe(1);
      expect(connectorElement(id).getAttribute('data-selected')).toBe('true');

      // Clear it, then aim just past the tolerance.
      pointerEvent('pointerdown', 8, 600);
      await flushFrame();
      pointerEvent('pointerup', 8, 600);
      await flushFrame();
      expect(selectionCount()).toBe(0);

      const far = offsetFromConnector(connectorOf(doc, id), CONNECTOR_HIT_TOLERANCE_PX + 1);
      pointerEvent('pointerdown', far.x, far.y);
      await flushFrame();
      pointerEvent('pointerup', far.x, far.y);
      await flushFrame();
      expect(selectionCount()).toBe(0);

      // Even inside the arrow's bounding box: the box is not the arrow.
      const insideBox = screenOf({ x: (from.x + to.x) / 2, y: 300 - (CONNECTOR_HIT_TOLERANCE_PX + 1) / zoom });
      pointerEvent('pointerdown', insideBox.x, insideBox.y);
      await flushFrame();
      pointerEvent('pointerup', insideBox.x, insideBox.y);
      await flushFrame();
      expect(selectionCount()).toBe(0);
    }
  });

  it('TC-21: dragging an end handle re-attaches it to an object, refuses the object at the other end, and detaches over empty space', async () => {
    const a = createShapeObject(doc, { at: { x: 200, y: 300 } });
    const b = createShapeObject(doc, { at: { x: 600, y: 300 } });
    const c = createShapeObject(doc, { kind: 'diamond', at: { x: 400, y: 700 } });
    const id = createConnectorObject(
      doc,
      { kind: 'attached', objectId: a },
      { kind: 'attached', objectId: b },
    );
    renderBoard({ doc });
    await flushFrame();

    // Select the arrow by clicking on it.
    const click = offsetFromConnector(connectorOf(doc, id), 2);
    pointerEvent('pointerdown', click.x, click.y);
    await flushFrame();
    pointerEvent('pointerup', click.x, click.y);
    await flushFrame();
    expect(selectionCount()).toBe(1);

    // A selected arrow shows a handle at each end (`connector.reattach`).
    const handle = connectorHandleElement('to');
    expect(handle.getAttribute('data-end')).toBe('to');

    const dragTo = async (end: 'from' | 'to', world: { x: number; y: number }): Promise<void> => {
      const connector = connectorOf(doc, id);
      const at = screenOf(connector.points[end]);
      const to = screenOf(world);
      pointerAt(connectorHandleElement(end), 'pointerdown', at.x, at.y);
      await flushFrame();
      pointerEvent('pointermove', (at.x + to.x) / 2, (at.y + to.y) / 2);
      await flushFrame();
      pointerEvent('pointerup', to.x, to.y);
      await flushFrame();
    };

    // Onto C: attached to the side the pointer is nearest, and the arrow now follows C.
    const shapeC = shapeOf(doc, c);
    await dragTo('to', { x: shapeC.x + 6, y: shapeC.y + shapeC.height / 2 });
    let ends = connectorOf(doc, id);
    expect(ends.to.kind).toBe('attached');
    expect(ends.to.kind === 'attached' ? ends.to.objectId : '').toBe(c);
    expect(ends.from.kind === 'attached' ? ends.from.objectId : '').toBe(a);
    // The end is drawn on the side of C that faces the other end - A, which is above
    // and to the left of it - not on the side the pointer happened to cross
    // (`connector.endpoints`: the side is recomputed, never stored).
    expect(ends.points.to).toEqual({ x: shapeC.x + shapeC.width / 2, y: shapeC.y });

    // Onto the object at the other end: refused, and the end stays where it was.
    const shapeA = shapeOf(doc, a);
    await dragTo('to', { x: shapeA.x + 20, y: shapeA.y + 20 });
    ends = connectorOf(doc, id);
    expect(ends.to.kind === 'attached' ? ends.to.objectId : '').toBe(c);

    // Onto empty space: detached, and fixed at the point it was released at.
    const releaseWorld = { x: 1200, y: 200 };
    await dragTo('to', releaseWorld);
    ends = connectorOf(doc, id);
    expect(ends.to.kind).toBe('free');
    expect(ends.to.kind === 'free' ? ends.to.x : 0).toBeCloseTo(releaseWorld.x, 1);
    expect(ends.to.kind === 'free' ? ends.to.y : 0).toBeCloseTo(releaseWorld.y, 1);

    // The arrow is still the same arrow, still selected, still drawn.
    expect(docConnectors(doc)).toHaveLength(1);
    expect(connectorElement(id).getAttribute('data-selected')).toBe('true');
  });

  it('an arrow follows the object its end is attached to, and the side it lands on changes as objects pass (connector.follow)', async () => {
    const a = createShapeObject(doc, { at: { x: 200, y: 300 } });
    const b = createShapeObject(doc, { at: { x: 600, y: 300 } });
    const id = createConnectorObject(
      doc,
      { kind: 'attached', objectId: a },
      { kind: 'attached', objectId: b },
    );
    renderBoard({ doc });
    await flushFrame();

    const before = connectorOf(doc, id);
    const shapeA = shapeOf(doc, a);
    const shapeB = shapeOf(doc, b);
    // Each end sits on the midpoint of the side that faces the other end.
    expect(before.points.from).toEqual({ x: shapeA.x + shapeA.width, y: shapeA.y + shapeA.height / 2 });
    expect(before.points.to).toEqual({ x: shapeB.x, y: shapeB.y + shapeB.height / 2 });

    // Move B to the far left of A. Nothing is written to the connector: the board
    // model re-derives its ends from the objects they are attached to, and the arrow
    // is drawn somewhere else on the same frame (`connector.follow`).
    act(() => {
      moveObject(doc, b, -600, 300);
    });
    await flushFrame();

    const after = connectorOf(doc, id);
    const movedB = shapeOf(doc, b);
    expect(after.points.to).toEqual({
      x: movedB.x + movedB.width,
      y: movedB.y + movedB.height / 2,
    });
    expect(after.points.from).toEqual({ x: shapeA.x, y: shapeA.y + shapeA.height / 2 });

    // The stored ends are still the same two attachments (`connector.endpoints`).
    const stored = connectorOf(doc, id);
    expect(stored.from.kind === 'attached' ? stored.from.objectId : '').toBe(a);
    expect(stored.to.kind === 'attached' ? stored.to.objectId : '').toBe(b);

    // And the arrow on the board is drawn to the new places.
    const line = screen.getByTestId(`connector-line-${id}`);
    expect(Number(line.getAttribute('x2'))).toBeCloseTo(
      after.points.to.x - after.x,
      3,
    );
  });

  it('the pointer rules an arrow depends on are the ones the browser is given', () => {
    // jsdom hit-tests nothing by geometry, so every click in this file goes through
    // the board's own distance test. In a browser the arrow is only clickable where
    // its CSS says it is - the invisible band along the line, and its two handles -
    // and a wrapper that took pointers would swallow clicks meant for the board.
    // That difference is invisible here, so the rules themselves are asserted.
    const css = readFileSync(resolve(process.cwd(), 'src/client/styles.css'), 'utf8');
    const ruleFor = (selector: string): string => {
      const block = css.split('\n}\n').find((entry) => entry.includes(selector));
      if (!block) {
        throw new Error(`no rule for ${selector}`);
      }
      return block;
    };
    expect(ruleFor('.connector-object {')).toContain('pointer-events: none');
    expect(ruleFor('.connector-object__hit {')).toContain('pointer-events: stroke');
    expect(ruleFor('.connector-object__handle {')).toContain('pointer-events: auto');
    expect(ruleFor('.connector-object__line {')).toContain('pointer-events: none');
  });

  it('the checkout flow fixture is one connected diagram, and every arrow lands where the shapes are', async () => {
    // The story 10 fixture as a whole: four labelled shapes and four arrows, one of
    // which ends in empty space. No single case above covers the flow - the arrows
    // crossing a row of shapes, and the labels sitting inside their shapes - so the
    // fixture is rendered and read the way a person reads it.
    const flow = seedCheckoutFlow(doc);
    renderBoard({ doc });
    await flushFrame();

    const objects = checkoutFlowObjects(doc);
    expect(objects.shapes).toHaveLength(CHECKOUT_FLOW_SHAPES.length);
    expect(objects.connectors).toHaveLength(CHECKOUT_FLOW_CONNECTORS.length);
    expect(connectorElements()).toHaveLength(CHECKOUT_FLOW_CONNECTORS.length);
    for (const entry of CHECKOUT_FLOW_SHAPES) {
      expect(shapeLabelElement(flow.shapes[entry.key]!)?.textContent).toBe(entry.label);
    }

    // Every attached end sits on the midpoint of the side that faces the other end -
    // stated as plain numbers from the fixture's geometry, not recomputed with the
    // product's own helper.
    const ends = (key: string) => connectorOf(doc, flow.connectors[key]!).points;
    expect(ends('cart-payment')).toEqual({ from: { x: 300, y: 150 }, to: { x: 420, y: 150 } });
    expect(ends('payment-paid')).toEqual({ from: { x: 640, y: 150 }, to: { x: 760, y: 160 } });
    expect(ends('paid-receipt')).toEqual({ from: { x: 980, y: 160 }, to: { x: 1100, y: 150 } });
    // The free-ended arrow starts on the side of the diamond that faces the empty
    // space it points at, and ends at the point it was released at.
    expect(ends('chargeback')).toEqual({ from: { x: 530, y: 260 }, to: { x: 530, y: 420 } });

    // Pick 'Paid' up and put it below and to the left of the diamond - its new corner
    // is (190, 330), the position `moveObjects` is given as an absolute place to be
    // (`sel.group_move`, Key decision 1). The arrows are not moved at all: their ends
    // are re-derived, and their sides change.
    act(() => {
      moveObject(doc, flow.shapes['paid']!, 190, 330);
    });
    await flushFrame();

    expect(ends('payment-paid')).toEqual({ from: { x: 530, y: 260 }, to: { x: 300, y: 330 } });
    expect(ends('paid-receipt')).toEqual({ from: { x: 410, y: 400 }, to: { x: 1100, y: 150 } });
    // The arrow that was drawn left to right is now drawn top to bottom, and the
    // board holds the same two attachments it held before.
    const stored = connectorOf(doc, flow.connectors['payment-paid']!);
    expect(stored.type).toBe('connector');
    expect(stored.from.kind === 'attached' ? stored.from.objectId : '').toBe(flow.shapes['payment']);
    expect(stored.to.kind === 'attached' ? stored.to.objectId : '').toBe(flow.shapes['paid']);
    expect('side' in (stored.from as object)).toBe(false);
    expect('side' in (stored.to as object)).toBe(false);
    // The free end is where it was released, whoever moved what.
    expect(ends('chargeback').to).toEqual({ x: 530, y: 420 });
  });
});
