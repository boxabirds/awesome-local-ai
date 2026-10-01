import { act, cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { snapshot } from '../../src/shared/board-model';
import { getObjectType } from '../../src/client/objects/registry';
import { createConnector, type ConnectorSnap } from '../../src/shared/objects/connector';
import { down, key, move, objectsOf, renderBoard, toScreen, up } from './shapes-helpers';

afterEach(cleanup);

const layer = () => screen.getByTestId('connector-tool-layer');
const att = (objectId: string) => ({ kind: 'attached' as const, objectId, fallback: { x: 0, y: 0 } });
const connectors = (doc: Parameters<typeof objectsOf>[0]) => objectsOf(doc, 'connector') as ConnectorSnap[];

describe('connector.ui', () => {
  it('TC-18 hovering a shape with the Connector tool shows four dots at the side midpoints', () => {
    renderBoard([{ x: 100, y: 100 }]);
    key('l');
    expect(screen.queryByTestId('connection-dot-top')).toBeNull();
    const c = toScreen({ x: 150, y: 150 });
    move(layer(), c.x, c.y);
    const dots = ['top', 'right', 'bottom', 'left'].map((s) => screen.getByTestId(`connection-dot-${s}`));
    const centre = (el: HTMLElement) => ({ x: parseFloat(el.style.left) + parseFloat(el.style.width) / 2, y: parseFloat(el.style.top) + parseFloat(el.style.height) / 2 });
    const expected = [toScreen({ x: 150, y: 100 }), toScreen({ x: 200, y: 150 }), toScreen({ x: 150, y: 200 }), toScreen({ x: 100, y: 150 })];
    dots.forEach((d, i) => {
      expect(centre(d).x).toBeCloseTo(expected[i].x, 5);
      expect(centre(d).y).toBeCloseTo(expected[i].y, 5);
    });
    move(layer(), 5, 5);
    expect(screen.queryByTestId('connection-dot-top')).toBeNull();
  });

  it("TC-19 dragging from A over B highlights B's nearest dot; release creates an attached arrow and selects it", () => {
    const { doc, ids } = renderBoard([{ x: 100, y: 100 }, { x: 500, y: 100 }]);
    key('l');
    const a = toScreen({ x: 150, y: 150 });
    const b = toScreen({ x: 550, y: 150 });
    down(layer(), a.x, a.y);
    move(layer(), b.x, b.y);
    expect(screen.getByTestId('connection-dot-left').getAttribute('data-highlighted')).toBe('true');
    expect(screen.getByTestId('connection-dot-right').getAttribute('data-highlighted')).toBe('false');
    up(layer(), b.x, b.y);
    const [conn] = connectors(doc);
    expect(conn.from).toMatchObject({ kind: 'attached', objectId: ids[0] });
    expect(conn.to).toMatchObject({ kind: 'attached', objectId: ids[1] });
    expect(screen.getByRole('group', { name: 'Arrow' }).getAttribute('data-selected')).toBe('true');
    expect(screen.queryByTestId('connector-tool-layer')).toBeNull();
  });

  it('releasing on the start object, or after a tiny drag, creates nothing and keeps the tool', () => {
    const { doc } = renderBoard([{ x: 100, y: 100 }]);
    key('l');
    const a = toScreen({ x: 150, y: 150 });
    down(layer(), a.x, a.y);
    move(layer(), a.x + 30, a.y);
    up(layer(), a.x + 30, a.y);
    down(layer(), 600, 600);
    up(layer(), 604, 600);
    expect(connectors(doc)).toHaveLength(0);
    expect(screen.getByTestId('connector-tool-layer')).toBeTruthy();
  });

  it('a drag from empty space to empty space makes a free arrow', () => {
    const { doc } = renderBoard();
    key('l');
    down(layer(), 300, 300);
    up(layer(), 500, 300);
    const [conn] = connectors(doc);
    expect(conn.from.kind).toBe('free');
    expect(conn.to.kind).toBe('free');
  });

  it('TC-20 the click tolerance is 6 screen pixels at 50% and 200% zoom', () => {
    const { doc } = renderBoard();
    const id = createConnector(doc, { kind: 'free', x: 0, y: 0 }, { kind: 'free', x: 400, y: 0 }, 'g')!;
    const conn = snapshot(doc).find((o) => o.id === id)!;
    const hit = getObjectType('connector')!.hitTest;
    for (const zoom of [0.5, 2]) {
      expect(hit(conn, { x: 200, y: 5 / zoom }, zoom)).toBe(true);
      expect(hit(conn, { x: 200, y: 7 / zoom }, zoom)).toBe(false);
    }
    // inside the bounding box of a diagonal arrow but far from the line
    const diagId = createConnector(doc, { kind: 'free', x: 0, y: 0 }, { kind: 'free', x: 400, y: 400 }, 'g')!;
    const diag = snapshot(doc).find((o) => o.id === diagId)!;
    expect(hit(diag, { x: 350, y: 50 }, 1)).toBe(false);
    expect(hit(diag, { x: 200, y: 203 }, 1)).toBe(true);
  });

  it('pressing the arrow line selects it', () => {
    const { doc } = renderBoard();
    act(() => void createConnector(doc, { kind: 'free', x: 0, y: 0 }, { kind: 'free', x: 400, y: 0 }, 'g'));
    const hit = screen.getByTestId('connector-hit');
    expect(Number(hit.getAttribute('stroke-width'))).toBe(12);
    down(hit, 100, 100);
    up(hit, 100, 100);
    expect(screen.getByRole('group', { name: 'Arrow' }).getAttribute('data-selected')).toBe('true');
  });

  it('TC-21 dragging an end handle onto C attaches it; onto empty space frees it at the release point', () => {
    const { doc, ids } = renderBoard([{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 400 }]);
    let id = '';
    act(() => void (id = createConnector(doc, att(ids[0]), att(ids[1]), 'g')!));
    const hit = screen.getByTestId('connector-hit');
    down(hit, 50, 50);
    up(hit, 50, 50);
    const endHandle = () => screen.getByRole('button', { name: 'Arrow end handle' });
    const dragTo = (world: { x: number; y: number }) => {
      const conn = connectors(doc).find((c) => c.id === id)!;
      const dx = world.x - conn.ends.to.x;
      const dy = world.y - conn.ends.to.y;
      down(endHandle(), 1000, 1000);
      move(endHandle(), 1000 + dx, 1000 + dy);
      up(endHandle(), 1000 + dx, 1000 + dy);
    };
    dragTo({ x: 450, y: 450 });
    expect(connectors(doc)[0].to).toMatchObject({ kind: 'attached', objectId: ids[2] });
    dragTo({ x: 900, y: 40 });
    expect(connectors(doc)[0].to).toEqual({ kind: 'free', x: 900, y: 40 });
    // over the object at the opposite end: rejected, nothing changes
    dragTo({ x: 50, y: 50 });
    expect(connectors(doc)[0].to).toEqual({ kind: 'free', x: 900, y: 40 });
  });

  it('an arrow follows a moved object and survives its deletion', () => {
    const { doc, ids } = renderBoard([{ x: 0, y: 0 }, { x: 400, y: 0 }]);
    let id = '';
    act(() => void (id = createConnector(doc, att(ids[0]), att(ids[1]), 'g')!));
    const el = () => screen.getByRole('group', { name: 'Arrow' });
    expect(el().getAttribute('data-to')).toBe('400,50');
    act(() => (doc.getMap('objects').get(ids[1]) as import('yjs').Map<unknown>).set('x', 700));
    expect(el().getAttribute('data-to')).toBe('700,50');
    expect(id).toBeTruthy();
  });
});

