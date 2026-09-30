import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { objectsSnapshot } from '../../src/shared/board-model';
import { CONNECTOR_DOT_RADIUS_PX } from '../../src/shared/config';
import { createConnector, getConnectorEnds, isConnector, type ConnectorSnap } from '../../src/shared/objects/connector';
import { createShape } from '../../src/shared/objects/shape';
import type { Rect } from '../../src/shared/geometry';
import { worldToScreen, type Camera } from '../../src/client/canvas/camera';
import { flushFrame, keyDown, model, readCamera, renderApp, useFakeFrames } from './helpers';

const connectors = () => objectsSnapshot(window.__vidi6!.doc).filter(isConnector) as ConnectorSnap[];
const connectorEl = (id: string) => document.querySelector<HTMLElement>(`[data-connector-id="${id}"]`)!;
const selectButton = () => screen.getByRole('button', { name: 'Select (V)' });
const connectorButton = () => screen.getByRole('button', { name: 'Connector (L)' });

function addShape(rect: Rect): string {
  return model((doc) => createShape(doc, { kind: 'rect', rect, at: { x: rect.x, y: rect.y } }, 'c_x'))!;
}

function setCamera(cam: Camera) {
  act(() => window.__vidi6!.setCamera(cam));
  flushFrame();
}

const A: Rect = { x: 0, y: 0, width: 100, height: 100 };
const B: Rect = { x: 300, y: 50, width: 100, height: 100 };
const C: Rect = { x: 0, y: 300, width: 100, height: 100 };

describe('connector.ui', () => {
  beforeEach(() => useFakeFrames());
  afterEach(() => vi.useRealTimers());

  it('TC-18 with the Connector tool, hovering a shape shows four dots at its side midpoints', () => {
    const { viewport } = renderApp();
    const cam = readCamera(viewport);
    const a = addShape(A);
    keyDown(document.body, 'l');
    expect(connectorButton()).toHaveAttribute('aria-pressed', 'true');
    const layer = screen.getByTestId('connector-tool');
    expect(screen.queryAllByTestId('connection-dot')).toHaveLength(0);
    const inside = worldToScreen(cam, { x: 50, y: 50 });
    fireEvent.pointerMove(layer, { pointerId: 1, clientX: inside.x, clientY: inside.y });
    const dots = screen.getAllByTestId('connection-dot');
    expect(dots).toHaveLength(4);
    const at = (side: string) => dots.find((d) => d.getAttribute('data-side') === side)!;
    const expected = { top: { x: 50, y: 0 }, right: { x: 100, y: 50 }, bottom: { x: 50, y: 100 }, left: { x: 0, y: 50 } };
    for (const [side, w] of Object.entries(expected)) {
      const s = worldToScreen(cam, w);
      expect(Number(at(side).getAttribute('cx'))).toBeCloseTo(s.x, 9);
      expect(Number(at(side).getAttribute('cy'))).toBeCloseTo(s.y, 9);
      expect(at(side).getAttribute('r')).toBe(String(CONNECTOR_DOT_RADIUS_PX));
      expect(at(side).getAttribute('data-object-id')).toBe(a);
    }
    // Off the shape: no dots.
    const outside = worldToScreen(cam, { x: -200, y: -200 });
    fireEvent.pointerMove(layer, { pointerId: 1, clientX: outside.x, clientY: outside.y });
    expect(screen.queryAllByTestId('connection-dot')).toHaveLength(0);
  });

  it('TC-19 dragging from A over B highlights B\'s nearest dot; release creates an attached arrow and selects it', () => {
    const { viewport } = renderApp();
    const cam = readCamera(viewport);
    const a = addShape(A);
    const b = addShape(B);
    fireEvent.click(connectorButton());
    const layer = screen.getByTestId('connector-tool');
    const p0 = worldToScreen(cam, { x: 50, y: 50 });
    const p1 = worldToScreen(cam, { x: 350, y: 100 });
    fireEvent.pointerDown(layer, { pointerId: 1, button: 0, clientX: p0.x, clientY: p0.y });
    fireEvent.pointerMove(layer, { pointerId: 1, clientX: p1.x, clientY: p1.y });
    const highlighted = screen.getAllByTestId('connection-dot').filter((d) => d.getAttribute('data-highlighted') === 'true');
    expect(highlighted).toHaveLength(1);
    expect(highlighted[0].getAttribute('data-side')).toBe('left');
    expect(highlighted[0].getAttribute('data-object-id')).toBe(b);
    expect(screen.getByTestId('connector-preview')).toBeInTheDocument();
    fireEvent.pointerUp(layer, { pointerId: 1, clientX: p1.x, clientY: p1.y });
    const [arrow] = connectors();
    expect(arrow.from).toMatchObject({ kind: 'attached', objectId: a });
    expect(arrow.to).toMatchObject({ kind: 'attached', objectId: b });
    expect(arrow.ends).toEqual({ from: { x: 100, y: 50 }, to: { x: 300, y: 100 } });
    expect(connectorEl(arrow.id).dataset.selected).toBe('true');
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('toolbar', { name: 'Arrow' })).toBeInTheDocument();
  });

  it('TC-19 releasing on the start object or after a tiny drag creates nothing and keeps the tool; empty space gives free ends', () => {
    const { viewport } = renderApp();
    const cam = readCamera(viewport);
    addShape(A);
    keyDown(document.body, 'l');
    const layer = screen.getByTestId('connector-tool');
    const on = (x: number, y: number) => worldToScreen(cam, { x, y });
    const gesture = (from: { x: number; y: number }, to: { x: number; y: number }) => {
      fireEvent.pointerDown(layer, { pointerId: 1, button: 0, clientX: from.x, clientY: from.y });
      fireEvent.pointerMove(layer, { pointerId: 1, clientX: to.x, clientY: to.y });
      fireEvent.pointerUp(layer, { pointerId: 1, clientX: to.x, clientY: to.y });
    };
    gesture(on(10, 10), on(90, 90)); // same object
    gesture(on(500, 500), on(505, 505)); // 7.07 units
    expect(connectors()).toHaveLength(0);
    expect(connectorButton()).toHaveAttribute('aria-pressed', 'true');
    gesture(on(500, 500), on(600, 520)); // empty → empty
    const [arrow] = connectors();
    expect(arrow.from).toEqual({ kind: 'free', x: 500, y: 500 });
    expect(arrow.to).toEqual({ kind: 'free', x: 600, y: 520 });
  });

  for (const zoom of [0.5, 2]) {
    it(`TC-20 at ${zoom * 100}% a click 5 px from the line selects the arrow; 7 px does not`, () => {
      renderApp();
      setCamera({ x: -100, y: -100, zoom });
      const cam = readCamera(screen.getByTestId('board-viewport'));
      expect(cam.zoom).toBe(zoom);
      const id = model((doc) => createConnector(doc, { kind: 'free', x: 0, y: 0 }, { kind: 'free', x: 200, y: 100 }, 'c_x'))!;
      const hit = connectorEl(id).querySelector('[data-testid="connector-hit"]')!;
      const mid = worldToScreen(cam, { x: 100, y: 50 });
      // Unit normal of the line in screen space.
      const n = { x: -1 / Math.hypot(1, 2), y: 2 / Math.hypot(1, 2) };
      const clickAt = (px: number) => {
        const p = { clientX: mid.x + n.x * px, clientY: mid.y + n.y * px };
        fireEvent.pointerDown(hit, { pointerId: 1, button: 0, ...p });
        fireEvent.pointerUp(hit, { pointerId: 1, ...p });
      };
      clickAt(7);
      expect(connectorEl(id).dataset.selected).toBe('false');
      clickAt(-7);
      expect(connectorEl(id).dataset.selected).toBe('false');
      clickAt(5);
      expect(connectorEl(id).dataset.selected).toBe('true');
      // The hit stroke is 2 × 6 screen px wide at this zoom.
      expect(Number(hit.getAttribute('stroke-width'))).toBeCloseTo(12 / zoom, 9);
    });
  }

  it('TC-21 dragging a selected arrow\'s end handle onto C attaches it; onto empty space frees it at the release point', () => {
    renderApp();
    const a = addShape(A);
    const b = addShape(B);
    const c = addShape(C);
    const id = model((doc) =>
      createConnector(
        doc,
        { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } },
        { kind: 'attached', objectId: b, fallback: { x: 0, y: 0 } },
        'c_x',
      ),
    )!;
    const hit = connectorEl(id).querySelector('[data-testid="connector-hit"]')!;
    // Select the arrow by pressing on its line.
    const cam = readCamera(screen.getByTestId('board-viewport'));
    const mid = worldToScreen(cam, { x: 200, y: 75 });
    fireEvent.pointerDown(hit, { pointerId: 1, button: 0, clientX: mid.x, clientY: mid.y });
    fireEvent.pointerUp(hit, { pointerId: 1, clientX: mid.x, clientY: mid.y });
    const handle = () => screen.getByRole('button', { name: 'Arrow end' });
    expect(screen.getByRole('button', { name: 'Arrow start' })).toBeInTheDocument();
    const dragHandle = (fromWorld: { x: number; y: number }, toWorld: { x: number; y: number }) => {
      const s = worldToScreen(cam, fromWorld);
      const e = worldToScreen(cam, toWorld);
      const h = handle();
      fireEvent.pointerDown(h, { pointerId: 2, button: 0, clientX: s.x, clientY: s.y });
      fireEvent.pointerMove(h, { pointerId: 2, clientX: e.x, clientY: e.y });
      fireEvent.pointerUp(h, { pointerId: 2, clientX: e.x, clientY: e.y });
    };
    const endNow = () => connectors()[0].ends.to;
    dragHandle(endNow(), { x: 50, y: 350 }); // into C
    expect(getConnectorEnds(window.__vidi6!.doc, id)!.to).toMatchObject({ kind: 'attached', objectId: c });
    expect(endNow()).toEqual({ x: 50, y: 300 }); // C's top side faces A
    dragHandle(endNow(), { x: 600, y: 420 }); // empty space
    expect(getConnectorEnds(window.__vidi6!.doc, id)!.to).toEqual({ kind: 'free', x: 600, y: 420 });
    // Onto the object at the other end: rejected, nothing changes.
    dragHandle(endNow(), { x: 50, y: 50 });
    expect(getConnectorEnds(window.__vidi6!.doc, id)!.to).toEqual({ kind: 'free', x: 600, y: 420 });
    expect(connectorEl(id).dataset.selected).toBe('true');
  });

  it('arrows follow a moved shape (connector.follow) and keep their ends when a shape is deleted', () => {
    renderApp();
    const a = addShape(A);
    const b = addShape(B);
    const id = model((doc) =>
      createConnector(
        doc,
        { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } },
        { kind: 'attached', objectId: b, fallback: { x: 0, y: 0 } },
        'c_x',
      ),
    )!;
    expect(connectorEl(id).dataset.toX).toBe('300');
    model((doc) => {
      const obj = doc.getMap<import('yjs').Map<unknown>>('objects').get(b)!;
      obj.set('x', 0);
      obj.set('y', 400);
    });
    expect(connectorEl(id).dataset).toMatchObject({ fromX: '50', fromY: '100', toX: '50', toY: '400' });
    model((doc) => doc.getMap('objects').delete(b)); // someone else's plain delete: orphaned end at fallback
    expect(connectorEl(id).dataset).toMatchObject({ toKind: 'attached', toX: '300', toY: '100' });
  });

  it('a selected arrow moves with the selection: free ends shift, attached ends stay on their object', () => {
    renderApp();
    const a = addShape(A);
    const id = model((doc) =>
      createConnector(doc, { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } }, { kind: 'free', x: 400, y: 50 }, 'c_x'),
    )!;
    const cam = readCamera(screen.getByTestId('board-viewport'));
    const hit = connectorEl(id).querySelector('[data-testid="connector-hit"]')!;
    const mid = worldToScreen(cam, { x: 250, y: 50 });
    fireEvent.pointerDown(hit, { pointerId: 1, button: 0, clientX: mid.x, clientY: mid.y });
    fireEvent.pointerUp(hit, { pointerId: 1, clientX: mid.x, clientY: mid.y });
    keyDown(document.body, 'ArrowDown');
    expect(getConnectorEnds(window.__vidi6!.doc, id)!.to).toEqual({ kind: 'free', x: 400, y: 51 });
    // Drag the line by (+20, +30) screen px.
    fireEvent.pointerDown(hit, { pointerId: 1, button: 0, clientX: mid.x, clientY: mid.y });
    fireEvent.pointerMove(hit, { pointerId: 1, clientX: mid.x + 20, clientY: mid.y + 30 });
    flushFrame();
    fireEvent.pointerUp(hit, { pointerId: 1, clientX: mid.x + 20, clientY: mid.y + 30 });
    flushFrame();
    const ends = getConnectorEnds(window.__vidi6!.doc, id)!;
    expect(ends.to).toEqual({ kind: 'free', x: 420, y: 81 });
    expect(ends.from).toMatchObject({ kind: 'attached', objectId: a });
    expect(connectorEl(id).dataset.selected).toBe('true');
  });
});
