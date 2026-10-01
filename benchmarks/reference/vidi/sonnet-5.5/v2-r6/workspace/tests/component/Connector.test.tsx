import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type * as Y from 'yjs';
import { deleteObjects, snapshot, type ConnectorSnapshot } from '../../src/shared/board-model';
import { CONNECTOR_HIT_TOLERANCE_PX } from '../../src/shared/config';
import { createConnector } from '../../src/shared/objects/connector';
import { createShape } from '../../src/shared/objects/shape';
import { getObjectType } from '../../src/client/objects/registry';
import { press, renderBoardAtOrigin } from './board';

const key = (k: string) => fireEvent.keyDown(window, { key: k });
const connectors = (doc: Y.Doc) => snapshot(doc).filter((o): o is ConnectorSnapshot => o.type === 'connector');
const pressed = (name: string) => screen.getByRole('button', { name }).getAttribute('aria-pressed');
const dots = () => screen.queryAllByTestId('connection-dot');
const attachedTo = (id: string) => ({ kind: 'attached' as const, objectId: id, fallback: { x: 0, y: 0 } });

function addShape(doc: Y.Doc, x: number, y: number, w = 100, h = 100): string {
  let id = '';
  act(() => { id = createShape(doc, { kind: 'rect', rect: { x, y, width: w, height: h }, at: { x, y } }, 'g') as string; });
  return id;
}
const hover = (viewport: Element, x: number, y: number) => fireEvent.pointerMove(viewport, { clientX: x, clientY: y, pointerId: 1 });
const shapeEl = (id: string) => document.querySelector(`[data-shape-object][data-object-id="${id}"]`) as HTMLElement;

describe('connector tool', () => {
  it('TC-18 hovering a shape with the Connector tool shows four dots at the side midpoints', async () => {
    const { doc, viewport } = await renderBoardAtOrigin();
    addShape(doc, 100, 100);
    key('l');
    expect(pressed('Connector (L)')).toBe('true');
    expect(dots()).toHaveLength(0);
    hover(viewport, 150, 150);
    expect(dots().map((d) => [d.dataset.side, parseFloat(d.style.left) + 4, parseFloat(d.style.top) + 4])).toEqual([
      ['top', 150, 100], ['right', 200, 150], ['bottom', 150, 200], ['left', 100, 150],
    ]);
    hover(viewport, 600, 600);
    expect(dots()).toHaveLength(0);
  });

  it('TC-19 dragging from A over B highlights B\'s nearest dot and releasing creates an attached arrow', async () => {
    const { doc, viewport } = await renderBoardAtOrigin();
    const a = addShape(doc, 100, 100);
    const b = addShape(doc, 400, 120);
    key('l');
    press(viewport, 150, 150);
    fireEvent.pointerMove(window, { clientX: 450, clientY: 170, pointerId: 1 });
    expect(screen.getByTestId('connector-preview')).toBeTruthy();
    const lit = dots().filter((d) => d.dataset.highlight === 'true');
    expect(lit.map((d) => [d.dataset.side, d.dataset.objectId])).toEqual([['left', b]]);
    fireEvent.pointerUp(window, { clientX: 450, clientY: 170, pointerId: 1 });
    const made = connectors(doc);
    expect(made).toHaveLength(1);
    expect(made[0].from).toMatchObject({ kind: 'attached', objectId: a });
    expect(made[0].to).toMatchObject({ kind: 'attached', objectId: b });
    expect(made[0].start).toEqual({ x: 200, y: 150 });
    expect(made[0].end).toEqual({ x: 400, y: 170 });
    expect(pressed('Select (V)')).toBe('true');
    expect(document.querySelector(`[data-connector][data-object-id="${made[0].id}"]`)?.getAttribute('data-selected')).toBe('true');
  });

  it('releasing over empty space leaves a free end; a tiny drag or the same object makes nothing', async () => {
    const { doc, viewport } = await renderBoardAtOrigin();
    const a = addShape(doc, 100, 100);
    key('l');
    press(viewport, 150, 150);
    fireEvent.pointerUp(window, { clientX: 152, clientY: 150, pointerId: 1 });
    press(viewport, 120, 120);
    fireEvent.pointerUp(window, { clientX: 180, clientY: 180, pointerId: 1 });
    expect(connectors(doc)).toHaveLength(0);
    expect(pressed('Connector (L)')).toBe('true');
    press(viewport, 150, 150);
    fireEvent.pointerUp(window, { clientX: 600, clientY: 500, pointerId: 1 });
    expect(connectors(doc)[0].from).toMatchObject({ kind: 'attached', objectId: a });
    expect(connectors(doc)[0].to).toEqual({ kind: 'free', x: 600, y: 500 });
  });

  it('TC-22 Escape leaves the Connector tool, also mid-drag, creating nothing', async () => {
    const { doc, viewport } = await renderBoardAtOrigin();
    addShape(doc, 100, 100);
    key('l');
    press(viewport, 150, 150);
    fireEvent.pointerMove(window, { clientX: 700, clientY: 500, pointerId: 1 });
    key('Escape');
    fireEvent.pointerUp(window, { clientX: 700, clientY: 500, pointerId: 1 });
    expect(connectors(doc)).toHaveLength(0);
    expect(pressed('Select (V)')).toBe('true');
  });
});

describe('connector object', () => {
  it('TC-20 only a click within 6 screen pixels of the line hits, at 50% and 200% zoom', async () => {
    const { doc } = await renderBoardAtOrigin();
    let id = '';
    act(() => { id = createConnector(doc, { kind: 'free', x: 0, y: 0 }, { kind: 'free', x: 200, y: 100 }, 'g') as string; });
    const c = connectors(doc).find((o) => o.id === id)!;
    const hit = getObjectType('connector')!.hitTest;
    expect(CONNECTOR_HIT_TOLERANCE_PX).toBe(6);
    // a point on the line at x = 100 is (100, 50); step perpendicular by n screen pixels
    const norm = Math.hypot(200, 100);
    const away = (px: number, zoom: number) => ({ x: 100 - (100 / norm) * (px / zoom), y: 50 + (200 / norm) * (px / zoom) });
    for (const zoom of [0.5, 1, 2]) {
      expect(hit(c, away(5, zoom), zoom)).toBe(true);
      expect(hit(c, away(7, zoom), zoom)).toBe(false);
    }
    // a click inside the bounding box but away from the line
    expect(hit(c, { x: 10, y: 90 }, 1)).toBe(false);
    // the DOM hit area is as wide as the tolerance on both sides
    expect(screen.getByTestId('connector-hit').getAttribute('stroke-width')).toBe('12');
  });

  it('TC-21 dragging an end handle onto another shape attaches it, onto empty space frees it', async () => {
    const { doc } = await renderBoardAtOrigin();
    const a = addShape(doc, 0, 0);
    const b = addShape(doc, 400, 0);
    const c = addShape(doc, 400, 300);
    let id = '';
    act(() => { id = createConnector(doc, attachedTo(a), attachedTo(b), 'g') as string; });
    fireEvent.pointerDown(screen.getByTestId('connector-hit'), { button: 0, pointerId: 1, clientX: 250, clientY: 50 });
    fireEvent.pointerUp(window, { button: 0, pointerId: 1, clientX: 250, clientY: 50 });
    const handle = screen.getByTestId('connector-handle-to');
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 400, clientY: 50 });
    fireEvent.pointerMove(window, { clientX: 450, clientY: 350, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 450, clientY: 350, pointerId: 1 });
    expect(connectors(doc)[0].to).toMatchObject({ kind: 'attached', objectId: c });
    const before = connectors(doc)[0].end;
    fireEvent.pointerDown(screen.getByTestId('connector-handle-to'), { button: 0, pointerId: 1, clientX: 450, clientY: 300 });
    fireEvent.pointerMove(window, { clientX: 900, clientY: 700, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 900, clientY: 700, pointerId: 1 });
    const free = connectors(doc).find((o) => o.id === id)!;
    expect(free.to.kind).toBe('free');
    expect(free.end).toEqual({ x: before.x + 450, y: before.y + 400 });
    // the handle onto the object at the other end is rejected: the end stays free
    fireEvent.pointerDown(screen.getByTestId('connector-handle-to'), { button: 0, pointerId: 1, clientX: free.end.x, clientY: free.end.y });
    fireEvent.pointerMove(window, { clientX: 50, clientY: 50, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 50, clientY: 50, pointerId: 1 });
    expect(connectors(doc)[0].to.kind).toBe('free');
  });

  it('arrows follow a moved shape and keep their end where a deleted shape was', async () => {
    const { doc } = await renderBoardAtOrigin();
    const a = addShape(doc, 0, 0);
    const b = addShape(doc, 400, 0);
    act(() => { createConnector(doc, attachedTo(a), attachedTo(b), 'g'); });
    expect(connectors(doc)[0].end).toEqual({ x: 400, y: 50 });
    act(() => {
      doc.getMap('objects').get(b) && (doc.getMap('objects').get(b) as Y.Map<unknown>).set('x', 0);
      (doc.getMap('objects').get(b) as Y.Map<unknown>).set('y', 400);
    });
    expect(connectors(doc)[0].start).toEqual({ x: 50, y: 100 });
    expect(connectors(doc)[0].end).toEqual({ x: 50, y: 400 });
    const line = screen.getByTestId('connector-line');
    expect(line.getAttribute('x1')).toBe('50');
    expect(line.getAttribute('y1')).toBe('100');
    act(() => { deleteObjects(doc, [b]); });
    expect(connectors(doc)[0].to).toEqual({ kind: 'free', x: 50, y: 400 });
    expect(shapeEl(a)).toBeTruthy();
  });
});
