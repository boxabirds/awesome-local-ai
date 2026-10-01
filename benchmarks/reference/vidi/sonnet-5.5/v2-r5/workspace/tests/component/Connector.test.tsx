import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Y from 'yjs';
import { newDoc } from './helpers';

const hoisted = vi.hoisted(() => ({ doc: null as unknown as Y.Doc }));

vi.mock('../../src/client/board/useBoardDoc', async () => {
  const model = await import('../../src/shared/board-model');
  const react = await import('react');
  return {
    useBoardDoc: () => {
      const doc = hoisted.doc;
      const [objects, setObjects] = react.useState(() => model.snapshotObjects(doc));
      react.useEffect(() => {
        const map = doc.getMap('objects');
        const h = () => setObjects(model.snapshotObjects(doc));
        map.observeDeep(h);
        return () => map.unobserveDeep(h);
      }, [doc]);
      return { doc, objects, connection: 'connected' };
    },
  };
});

import { deleteObjects, moveObject, snapshotObjects } from '../../src/shared/board-model';
import { CONNECTOR_HIT_TOLERANCE_PX } from '../../src/shared/config';
import { createConnector, type ConnectorSnap, type Endpoint } from '../../src/shared/objects/connector';
import { createShape } from '../../src/shared/objects/shape';
import { getObjectType } from '../../src/client/objects/registry';
import { App } from './TestApp';

afterEach(cleanup);
beforeEach(() => { hoisted.doc = newDoc(); });

// In jsdom the world layer has no offset, so the connector handles see client coordinates as world coordinates,
// while the tool layers use the camera (world origin at the centre of the 1024 x 768 viewport).
const ORIGIN = { x: 512, y: 384 };
const box = (x: number, y: number, size = 100) =>
  createShape(hoisted.doc, { kind: 'rect', rect: { x, y, width: size, height: size }, at: { x, y } }, 'g') as string;
const att = (objectId: string): Endpoint => ({ kind: 'attached', objectId, fallback: { x: 0, y: 0 } });
const free = (x: number, y: number): Endpoint => ({ kind: 'free', x, y });
const connectors = () => snapshotObjects(hoisted.doc).filter((o): o is ConnectorSnap => o.type === 'connector');
const ptr = (clientX: number, clientY: number) => ({ clientX, clientY, pointerId: 1, button: 0 });
const toolLayer = () => screen.getByTestId('connector-tool-layer');
const screenOf = (wx: number, wy: number) => [wx + ORIGIN.x, wy + ORIGIN.y] as const;

describe('connector tool', () => {
  it('TC-18 hovering a shape with the Connector tool shows four dots at its side midpoints', () => {
    box(0, 0, 200);
    render(<App />);
    fireEvent.keyDown(window, { key: 'l' });
    expect(screen.queryAllByTestId('connection-dot')).toHaveLength(0);
    fireEvent.pointerMove(toolLayer(), ptr(...screenOf(100, 100)));
    const dots = screen.getAllByTestId('connection-dot');
    expect(dots.map((d) => d.getAttribute('data-side')).sort()).toEqual(['bottom', 'left', 'right', 'top']);
    const centre = (side: string) => {
      const d = dots.find((x) => x.getAttribute('data-side') === side)!;
      return [parseFloat(d.style.left) + parseFloat(d.style.width) / 2, parseFloat(d.style.top) + parseFloat(d.style.height) / 2];
    };
    expect(centre('top')).toEqual([...screenOf(100, 0)]);
    expect(centre('right')).toEqual([...screenOf(200, 100)]);
    expect(centre('bottom')).toEqual([...screenOf(100, 200)]);
    expect(centre('left')).toEqual([...screenOf(0, 100)]);
    fireEvent.pointerMove(toolLayer(), ptr(...screenOf(600, 600)));
    expect(screen.queryAllByTestId('connection-dot')).toHaveLength(0);
  });

  it('TC-19 dragging from A over B highlights B\'s nearest dot; release creates an attached arrow and selects it', () => {
    const a = box(0, 0);
    const b = box(400, 0);
    render(<App />);
    fireEvent.keyDown(window, { key: 'l' });
    fireEvent.pointerDown(toolLayer(), ptr(...screenOf(50, 50)));
    fireEvent.pointerMove(toolLayer(), ptr(...screenOf(450, 60)));
    const hot = screen.getAllByTestId('connection-dot').filter((d) => d.getAttribute('data-highlighted') === 'true');
    expect(hot.map((d) => d.getAttribute('data-side'))).toEqual(['left']);
    expect(screen.getByTestId('connector-preview')).toBeTruthy();
    fireEvent.pointerUp(toolLayer(), ptr(...screenOf(450, 60)));
    const [c] = connectors();
    expect(c.from).toMatchObject({ kind: 'attached', objectId: a });
    expect(c.to).toMatchObject({ kind: 'attached', objectId: b });
    expect(screen.getByRole('group', { name: 'Arrow' }).getAttribute('data-selected')).toBe('true');
    expect(screen.getByRole('button', { name: 'Select (V)' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByTestId('connector-tool-layer')).toBeNull();
  });

  it('releasing over empty space leaves the end free; starting on empty space fixes the start there', () => {
    const a = box(0, 0);
    render(<App />);
    fireEvent.keyDown(window, { key: 'l' });
    fireEvent.pointerDown(toolLayer(), ptr(...screenOf(50, 50)));
    fireEvent.pointerUp(toolLayer(), ptr(...screenOf(300, 50)));
    expect(connectors()[0].from).toMatchObject({ kind: 'attached', objectId: a });
    expect(connectors()[0].to).toEqual(free(300, 50));
    fireEvent.keyDown(window, { key: 'l' });
    fireEvent.pointerDown(toolLayer(), ptr(...screenOf(500, 500)));
    fireEvent.pointerUp(toolLayer(), ptr(...screenOf(700, 500)));
    expect(connectors()[1].from).toEqual(free(500, 500));
    expect(connectors()[1].to).toEqual(free(700, 500));
  });

  it('a drag that ends on its own object, or moves under 8 units, creates nothing and keeps the tool', () => {
    box(0, 0, 300);
    render(<App />);
    fireEvent.keyDown(window, { key: 'l' });
    fireEvent.pointerDown(toolLayer(), ptr(...screenOf(50, 50)));
    fireEvent.pointerUp(toolLayer(), ptr(...screenOf(250, 250)));
    fireEvent.pointerDown(toolLayer(), ptr(...screenOf(500, 500)));
    fireEvent.pointerUp(toolLayer(), ptr(...screenOf(505, 503)));
    expect(connectors()).toHaveLength(0);
    expect(toolLayer()).toBeTruthy();
  });

  it('TC-22 Connector: create returns to Select; Escape returns to Select and creates nothing', () => {
    render(<App />);
    fireEvent.keyDown(window, { key: 'l' });
    fireEvent.pointerDown(toolLayer(), ptr(100, 100));
    fireEvent.pointerUp(toolLayer(), ptr(300, 300));
    expect(connectors()).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Select (V)' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.keyDown(window, { key: 'l' });
    fireEvent.pointerDown(toolLayer(), ptr(100, 100));
    fireEvent.pointerMove(toolLayer(), ptr(400, 400));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(connectors()).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Select (V)' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('an arrow to an object another person deletes mid-drag is still created, drawn at its fallback', () => {
    box(0, 0);
    const b = box(400, 0);
    render(<App />);
    fireEvent.keyDown(window, { key: 'l' });
    fireEvent.pointerDown(toolLayer(), ptr(...screenOf(50, 50)));
    fireEvent.pointerMove(toolLayer(), ptr(...screenOf(450, 50)));
    // The tool captured B's rectangle on the last move; B vanishes between the move and the release.
    deleteObjects(hoisted.doc, [b]);
    fireEvent.pointerUp(toolLayer(), ptr(...screenOf(450, 50)));
    expect(connectors()).toHaveLength(1);
  });
});

describe('connector object', () => {
  it('TC-20 selects only within 6 screen pixels of the line, at 50% and 200% zoom', () => {
    const spec = getObjectType('connector')!;
    const id = createConnector(hoisted.doc, free(0, 0), free(200, 0), 'g') as string;
    const c = connectors().find((x) => x.id === id)!;
    for (const zoom of [0.5, 2]) {
      const px = (n: number) => n / zoom;
      expect(spec.hitTest(c, { x: 100, y: px(CONNECTOR_HIT_TOLERANCE_PX - 1) }, { zoom })).toBe(true);
      expect(spec.hitTest(c, { x: 100, y: px(CONNECTOR_HIT_TOLERANCE_PX + 1) }, { zoom })).toBe(false);
    }
    // A diagonal arrow: a point inside its bounding box but away from the line does not hit.
    const diagonalId = createConnector(hoisted.doc, free(0, 100), free(100, 0), 'g');
    const d = connectors().find((x) => x.id === diagonalId)!;
    expect(spec.hitTest(d, { x: 50, y: 50 })).toBe(true);
    expect(spec.hitTest(d, { x: 10, y: 10 })).toBe(false);
  });

  it('clicking the arrow line selects it with the Select tool and shows two end handles', () => {
    createConnector(hoisted.doc, free(100, 100), free(300, 100), 'g');
    render(<App />);
    expect(screen.queryByRole('button', { name: 'Arrow start handle' })).toBeNull();
    fireEvent.pointerDown(screen.getByTestId('connector-hit'), ptr(200, 100));
    fireEvent.pointerUp(window, ptr(200, 100));
    expect(screen.getByRole('group', { name: 'Arrow' }).getAttribute('data-selected')).toBe('true');
    expect(screen.getByRole('button', { name: 'Arrow start handle' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Arrow end handle' })).toBeTruthy();
  });

  it('the arrow redraws at the nearest side when an attached shape moves', () => {
    const a = box(0, 0);
    const b = box(400, 0);
    createConnector(hoisted.doc, att(a), att(b), 'g');
    render(<App />);
    const arrow = () => screen.getByRole('group', { name: 'Arrow' });
    expect([arrow().getAttribute('data-from-x'), arrow().getAttribute('data-to-x')]).toEqual(['100', '400']);
    // Move B above A: the arrow switches to A's top and B's bottom, with no write to the connector.
    act(() => { moveObject(hoisted.doc, b, 0, -400); });
    expect([arrow().getAttribute('data-from-x'), arrow().getAttribute('data-from-y')]).toEqual(['50', '0']);
    expect([arrow().getAttribute('data-to-x'), arrow().getAttribute('data-to-y')]).toEqual(['50', '-300']);
  });

  it('TC-21 dragging an end handle onto another object attaches it; onto empty space detaches it', () => {
    const a = box(0, 0);
    const b = box(400, 0);
    const c = box(400, 400);
    const id = createConnector(hoisted.doc, att(a), att(b), 'g') as string;
    render(<App />);
    fireEvent.pointerDown(screen.getByTestId('connector-hit'), ptr(250, 50));
    fireEvent.pointerUp(window, ptr(250, 50));
    const handle = () => screen.getByRole('button', { name: 'Arrow end handle' });
    // jsdom's world offset is zero here, so client coordinates are world coordinates.
    fireEvent.pointerDown(handle(), ptr(400, 50));
    fireEvent.pointerMove(handle(), ptr(450, 450));
    fireEvent.pointerUp(handle(), ptr(450, 450));
    let conn = connectors().find((x) => x.id === id)!;
    expect(conn.to).toMatchObject({ kind: 'attached', objectId: c });
    expect(conn.from).toMatchObject({ kind: 'attached', objectId: a });
    fireEvent.pointerDown(handle(), ptr(450, 400));
    fireEvent.pointerUp(handle(), ptr(700, 700));
    conn = connectors().find((x) => x.id === id)!;
    expect(conn.to).toEqual(free(700, 700));
  });

  it('releasing an end handle over the object at the other end snaps back without writing', () => {
    const a = box(0, 0);
    const b = box(400, 0);
    const id = createConnector(hoisted.doc, att(a), att(b), 'g') as string;
    render(<App />);
    fireEvent.pointerDown(screen.getByTestId('connector-hit'), ptr(250, 50));
    fireEvent.pointerUp(window, ptr(250, 50));
    const before = JSON.stringify(connectors());
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Arrow end handle' }), ptr(400, 50));
    fireEvent.pointerUp(screen.getByRole('button', { name: 'Arrow end handle' }), ptr(50, 50));
    expect(JSON.stringify(connectors())).toBe(before);
    expect(connectors().find((x) => x.id === id)!.to).toMatchObject({ objectId: b });
  });
});
