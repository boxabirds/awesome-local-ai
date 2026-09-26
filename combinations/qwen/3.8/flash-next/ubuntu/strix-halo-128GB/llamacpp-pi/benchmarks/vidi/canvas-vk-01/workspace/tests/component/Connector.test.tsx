import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as Y from 'yjs';

import { BoardApp } from '../../src/client/App';
import { initDoc, objectSnapshots } from '../../src/shared/board-model';
import type { ConnectorSnapshot } from '../../src/shared/objects/connector';
import { getObjectType } from '../../src/client/objects/registry';
import { CONNECTOR_DOT_RADIUS_PX } from '../../src/shared/config';
import { worldToScreen } from '../../src/client/canvas/camera';
import { nearestSide, sideAnchor } from '../../src/shared/geometry/connector-geometry';
import { seedConnectorBetween, seedShape } from '../fixtures/boards';
import { flowRect, moveFlowShape, seedCheckoutFlow } from '../fixtures/checkout-flow';
import { fireKey, firePointer } from './helpers';

/**
 * Story 10 connector UI: the connection dots (`connector.hover_points`), the
 * preview and creation (`connector.create_attached`), the screen-pixel click
 * tolerance (`connector.select`) and re-attaching an end (`connector.reattach`).
 */

function renderEditable() {
  const doc = new Y.Doc();
  initDoc(doc);
  const view = render(<BoardApp doc={doc} />);
  return {
    ...view,
    doc,
    async settle() {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
      });
    },
  };
}

const camera = () => window.__vidi6?.getCamera() ?? { x: 0, y: 0, zoom: 1 };
const clientOf = (world: { x: number; y: number }) => worldToScreen(camera(), world);
const connectorOf = (doc: Y.Doc): ConnectorSnapshot | undefined =>
  objectSnapshots(doc).find((obj) => obj.type === 'connector') as ConnectorSnapshot | undefined;

/** Release a handle over a client point; the object listens on window. */
function releaseAt(x: number, y: number): void {
  act(() => {
    window.dispatchEvent(
      new PointerEvent('pointerup', {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        pointerId: 1,
        button: 0,
        buttons: 0,
        isPrimary: true,
        pointerType: 'mouse',
      }),
    );
  });
}

/** Click an object at a client point: press and release without moving. */
function clickAt(element: Element, x: number, y: number): void {
  firePointer(element, 'pointerdown', x, y);
  firePointer(element, 'pointerup', x, y);
}

afterEach(cleanup);

describe('TC-18: hovering an object with the Connector tool', () => {
  it('shows four dots at the side midpoints', async () => {
    const { doc, settle } = renderEditable();
    await settle();
    const id = seedShape(doc, { x: 100, y: 100, width: 200, height: 120 });
    await settle();
    firePointer(screen.getByTestId('board-toolbar'), 'pointerdown', 0, 0);
    fireEvent.click(screen.getByTestId('tool-connector'));
    await settle();

    const layer = screen.getByTestId('connector-tool-layer');
    expect(screen.queryAllByTestId('connector-dot')).toHaveLength(0);

    // Hover the middle of the shape.
    const middle = clientOf({ x: 200, y: 160 });
    firePointer(layer, 'pointermove', middle.x, middle.y);
    await settle();

    const dots = screen.queryAllByTestId('connector-dot');
    expect(dots).toHaveLength(4);
    const rect = { x: 100, y: 100, width: 200, height: 120 };
    const expected = ['top', 'right', 'bottom', 'left'].map((side) => ({
      side,
      ...clientOf(sideAnchor(rect, side as 'top' | 'right' | 'bottom' | 'left')),
    }));
    for (const want of expected) {
      const dot = dots.find((candidate) => candidate.dataset.side === want.side);
      expect(dot, `dot for ${want.side}`).toBeDefined();
      expect(dot!.dataset.object).toBe(id);
      // The dot is centred on the side midpoint (it is placed by its top-left).
      expect(parseFloat(dot!.style.left)).toBeCloseTo(want.x - CONNECTOR_DOT_RADIUS_PX, 0);
      expect(parseFloat(dot!.style.top)).toBeCloseTo(want.y - CONNECTOR_DOT_RADIUS_PX, 0);
    }

    // Moving onto empty space takes them away again.
    firePointer(layer, 'pointermove', 900, 700);
    await settle();
    expect(screen.queryAllByTestId('connector-dot')).toHaveLength(0);
  });
});

describe('TC-19: dragging an arrow between two shapes', () => {
  it('highlights the target dot and creates an attached connector', async () => {
    const { doc, settle } = renderEditable();
    await settle();
    const a = seedShape(doc, { x: 100, y: 100, width: 160, height: 100 });
    const b = seedShape(doc, { x: 460, y: 100, width: 160, height: 100 });
    await settle();
    fireEvent.click(screen.getByTestId('tool-connector'));
    await settle();
    const layer = screen.getByTestId('connector-tool-layer');

    const start = clientOf({ x: 180, y: 150 });
    const over = clientOf({ x: 540, y: 150 });
    firePointer(layer, 'pointerdown', start.x, start.y);
    firePointer(layer, 'pointermove', over.x, over.y);
    await settle();

    const highlighted = screen
      .queryAllByTestId('connector-dot')
      .filter((dot) => dot.dataset.highlighted === 'true');
    expect(highlighted).toHaveLength(1);
    expect(highlighted[0]!.dataset.object).toBe(b);
    expect(highlighted[0]!.dataset.side).toBe(nearestSide({ x: 460, y: 100, width: 160, height: 100 }, { x: 180, y: 150 }));
    expect(screen.getByTestId('connector-preview')).toBeDefined();

    firePointer(layer, 'pointerup', over.x, over.y);
    await settle();

    const connector = connectorOf(doc);
    expect(connector).toBeDefined();
    expect(connector!.from.kind).toBe('attached');
    expect(connector!.to.kind).toBe('attached');
    expect((connector!.from as { objectId: string }).objectId).toBe(a);
    expect((connector!.to as { objectId: string }).objectId).toBe(b);
    // The arrow is selected and the tool is back to Select.
    expect(screen.getByTestId(`connector-object-${connector!.id}`).dataset.selected).toBe('true');
    expect(screen.getByTestId('tool-select').getAttribute('aria-pressed')).toBe('true');
  });

  it('a drag back onto its own object creates nothing', async () => {
    const { doc, settle } = renderEditable();
    await settle();
    seedShape(doc, { x: 100, y: 100, width: 200, height: 120 });
    await settle();
    fireEvent.click(screen.getByTestId('tool-connector'));
    await settle();
    const layer = screen.getByTestId('connector-tool-layer');

    const from = clientOf({ x: 140, y: 140 });
    const to = clientOf({ x: 260, y: 190 });
    firePointer(layer, 'pointerdown', from.x, from.y);
    firePointer(layer, 'pointermove', to.x, to.y);
    firePointer(layer, 'pointerup', to.x, to.y);
    await settle();

    expect(connectorOf(doc)).toBeUndefined();
    // The tool stays ready to try again.
    expect(screen.getByTestId('tool-connector').getAttribute('aria-pressed')).toBe('true');
  });
});

describe('TC-20: clicking an arrow selects it within the screen-pixel tolerance', () => {
  it('5 px selects and 7 px does not, at 50% and at 200%', () => {
    const { doc } = renderEditable();
    const a = seedShape(doc, { x: 100, y: 100, width: 160, height: 100 });
    const b = seedShape(doc, { x: 460, y: 100, width: 160, height: 100 });
    seedConnectorBetween(doc, a, b);
    const connector = connectorOf(doc)!;
    const hitTest = getObjectType('connector')!.hitTest;
    const middle = { x: (connector.fromPoint.x + connector.toPoint.x) / 2, y: (connector.fromPoint.y + connector.toPoint.y) / 2 };

    for (const zoom of [0.5, 2]) {
      // Perpendicular to the line, which runs horizontally here.
      const near = { x: middle.x, y: middle.y + 5 / zoom };
      const far = { x: middle.x, y: middle.y + 7 / zoom };
      expect(hitTest(connector, near, zoom), `5 px at ${zoom}x`).toBe(true);
      expect(hitTest(connector, far, zoom), `7 px at ${zoom}x`).toBe(false);
    }
    // And a click well off the line never selects, whatever the zoom.
    expect(hitTest(connector, { x: middle.x, y: middle.y + 20 }, 1)).toBe(false);
  });

  it('a click on the arrow selects it and shows its handles', async () => {
    const { doc, settle } = renderEditable();
    const a = seedShape(doc, { x: 100, y: 100, width: 160, height: 100 });
    const b = seedShape(doc, { x: 460, y: 100, width: 160, height: 100 });
    seedConnectorBetween(doc, a, b);
    const connector = connectorOf(doc)!;
    await settle();

    const middle = clientOf({
      x: (connector.fromPoint.x + connector.toPoint.x) / 2,
      y: (connector.fromPoint.y + connector.toPoint.y) / 2,
    });
    clickAt(screen.getByTestId(`connector-hit-${connector.id}`), middle.x, middle.y);
    await settle();

    expect(screen.getByTestId(`connector-object-${connector.id}`).dataset.selected).toBe('true');
    expect(screen.getByTestId('connector-handle-from')).toBeDefined();
    expect(screen.getByTestId('connector-handle-to')).toBeDefined();
  });
});

describe('TC-21: re-attaching an end', () => {
  it('dragging the end handle onto another shape attaches it there', async () => {
    const { doc, settle } = renderEditable();
    const a = seedShape(doc, { x: 100, y: 100, width: 160, height: 100 });
    const b = seedShape(doc, { x: 460, y: 100, width: 160, height: 100 });
    const c = seedShape(doc, { x: 300, y: 420, width: 160, height: 100 });
    seedConnectorBetween(doc, a, b);
    const id = connectorOf(doc)!.id;
    await settle();

    const onLine = clientOf(connectorOf(doc)!.fromPoint);
    clickAt(screen.getByTestId(`connector-hit-${id}`), onLine.x, onLine.y);
    await settle();

    const handle = screen.getByTestId('connector-handle-to');
    const at = clientOf(connectorOf(doc)!.toPoint);
    firePointer(handle, 'pointerdown', at.x, at.y);
    const onto = clientOf({ x: 380, y: 470 });
    releaseAt(onto.x, onto.y);
    await settle();

    const after = connectorOf(doc)!;
    expect(after.to.kind).toBe('attached');
    expect((after.to as { objectId: string }).objectId).toBe(c);
    // The other end was not touched.
    expect((after.from as { objectId: string }).objectId).toBe(a);
  });

  it('releasing the end on empty space fixes it at that point', async () => {
    const { doc, settle } = renderEditable();
    const a = seedShape(doc, { x: 100, y: 100, width: 160, height: 100 });
    const b = seedShape(doc, { x: 460, y: 100, width: 160, height: 100 });
    seedConnectorBetween(doc, a, b);
    const id = connectorOf(doc)!.id;
    await settle();

    const from = clientOf(connectorOf(doc)!.fromPoint);
    clickAt(screen.getByTestId(`connector-hit-${id}`), from.x, from.y);
    await settle();

    const handle = screen.getByTestId('connector-handle-to');
    const at = clientOf(connectorOf(doc)!.toPoint);
    firePointer(handle, 'pointerdown', at.x, at.y);
    const empty = clientOf({ x: 900, y: 640 });
    releaseAt(empty.x, empty.y);
    await settle();

    const after = connectorOf(doc)!;
    expect(after.to.kind).toBe('free');
    expect((after.to as { x: number; y: number }).x).toBeCloseTo(900, 0);
    expect((after.to as { x: number; y: number }).y).toBeCloseTo(640, 0);
    // It still points from A, and it is still an arrow on the board.
    expect((after.from as { objectId: string }).objectId).toBe(a);
  });
});

describe('the checkout flow fixture', () => {
  it('renders as four shapes and four arrows whose ends follow their steps', async () => {
    const { doc, settle } = renderEditable();
    const flow = seedCheckoutFlow(doc);
    await settle();

    expect(screen.getAllByTestId(/^shape-object-/)).toHaveLength(4);
    expect(screen.getAllByTestId(/^connector-object-/)).toHaveLength(4);
    expect(screen.getByTestId(`shape-object-${flow.inStock}`)?.textContent).toContain('In stock?');
    const snap = (id: string): ConnectorSnapshot =>
      objectSnapshots(doc).find((obj) => obj.id === id) as ConnectorSnapshot;

    // The arrow with a free end keeps it, where it was left.
    expect(snap(flow.looseEnd).to.kind).toBe('free');

    // Move the step in the middle: the arrow into it re-routes to its new side.
    const before = snap(flow.arrows[1]);
    moveFlowShape(doc, flow.payment, 700, 40);
    await settle();

    const after = snap(flow.arrows[1]);
    const moved = flowRect(doc, flow.payment);
    expect(after.toPoint.x).not.toBe(before.toPoint.x);
    expect(after.toPoint.x).toBeCloseTo(moved.x, 6);
    expect(after.toPoint.y).toBeCloseTo(moved.y + moved.height / 2, 6);
    // The other end of that arrow has not moved with it.
    expect(after.fromPoint.x).toBeCloseTo(before.fromPoint.x, 6);
    expect(after.fromPoint.y).toBeCloseTo(before.fromPoint.y, 6);
  });
});

describe('undo: story 8 boundaries apply to arrows', () => {
  const undoButton = (): HTMLButtonElement => screen.getByLabelText('Undo') as HTMLButtonElement;

  it('drawing an arrow is one undo step, and leaves the shapes it joins', async () => {
    const { doc, settle } = renderEditable();
    await settle();
    seedShape(doc, { x: 100, y: 100, width: 160, height: 100 });
    seedShape(doc, { x: 460, y: 100, width: 160, height: 100 });
    await settle();
    fireEvent.click(screen.getByTestId('tool-connector'));
    await settle();

    const layer = screen.getByTestId('connector-tool-layer');
    const start = clientOf({ x: 180, y: 150 });
    const over = clientOf({ x: 540, y: 150 });
    firePointer(layer, 'pointerdown', start.x, start.y);
    firePointer(layer, 'pointermove', over.x, over.y);
    firePointer(layer, 'pointerup', over.x, over.y);
    await settle();
    expect(connectorOf(doc)).toBeDefined();

    act(() => {
      undoButton().click();
    });
    await settle();

    expect(connectorOf(doc)).toBeUndefined();
    expect(objectSnapshots(doc)).toHaveLength(2);
  });

  it('deleting a shape frees its arrow ends, and one undo brings both back', async () => {
    const { doc, settle } = renderEditable();
    await settle();
    const a = seedShape(doc, { x: 100, y: 100, width: 160, height: 100 });
    const b = seedShape(doc, { x: 460, y: 100, width: 160, height: 100 });
    const arrow = seedConnectorBetween(doc, a, b);
    await settle();

    const onB = clientOf({ x: 540, y: 150 });
    clickAt(screen.getByTestId(`shape-object-${b}`), onB.x, onB.y);
    await settle();
    fireKey({ key: 'Delete' });
    await settle();

    const remaining = objectSnapshots(doc);
    expect(remaining.find((obj) => obj.id === b)).toBeUndefined();
    const freed = remaining.find((obj) => obj.id === arrow) as ConnectorSnapshot;
    expect(freed).toBeDefined();
    // The end is free, parked where it was attached: B's midpoint on the A side.
    expect(freed.to.kind).toBe('free');
    expect((freed.to as { x: number }).x).toBeCloseTo(460, 0);
    expect((freed.to as { y: number }).y).toBeCloseTo(150, 0);

    // The detach happened inside the delete's own transaction, so one undo
    // restores the shape and the attachment together.
    act(() => {
      undoButton().click();
    });
    await settle();

    const restored = objectSnapshots(doc);
    expect(restored.find((obj) => obj.id === b)).toBeDefined();
    const reattached = restored.find((obj) => obj.id === arrow) as ConnectorSnapshot;
    expect(reattached.to.kind).toBe('attached');
    expect((reattached.to as { objectId: string }).objectId).toBe(b);
    expect(reattached.from.kind).toBe('attached');
    expect((reattached.from as { objectId: string }).objectId).toBe(a);
  });
});
