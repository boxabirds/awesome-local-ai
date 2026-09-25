import { describe, expect, it } from 'vitest';
import { act, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { initDoc, objectSnapshot } from '../../src/shared/board-model';
import { CONNECTOR_DOT_RADIUS_PX } from '../../src/shared/config';
import type { Rect } from '../../src/shared/geometry';
import { worldToScreen } from '../../src/client/canvas/camera';
import { createShape } from '../../src/shared/objects/shape';
import { createConnector, type ConnectorSnap } from '../../src/shared/objects/connector';
import { pointer, key, renderApp, setCamera } from './helpers';

function freshDoc() {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function addShape(doc: Y.Doc, r: Rect): string {
  return createShape(doc, { kind: 'rect', rect: r, at: { x: r.x, y: r.y } }, 'g')!;
}

const connectors = (doc: Y.Doc) => objectSnapshot(doc).filter((o) => o.type === 'connector') as ConnectorSnap[];
const raw = (doc: Y.Doc, id: string) => doc.getMap<Y.Map<unknown>>('objects').get(id)!;
const surface = () => screen.getByTestId('connector-tool');
const dots = () => screen.queryAllByTestId('connection-dot');
const selection = () => window.__vidi6!.selection!();
const hitLine = (id: string) =>
  document.querySelector(`[data-connector-id="${id}"] [data-testid="connector-hit"]`) as Element;

describe('Connector tool and connector object (connector.ui)', () => {
  it('TC-18 with the Connector tool, hovering a shape shows four dots at its side midpoints', () => {
    const doc = freshDoc();
    const a = addShape(doc, { x: 0, y: 0, width: 200, height: 100 });
    renderApp(doc);
    setCamera({ x: 0, y: 0, zoom: 1 });
    key('l', document.body);
    pointer(surface(), 'move', 600, 600);
    expect(dots()).toHaveLength(0);
    pointer(surface(), 'move', 50, 50);
    const shown = dots();
    expect(shown).toHaveLength(4);
    const at = Object.fromEntries(shown.map((d) => [d.getAttribute('data-side'), [d.getAttribute('cx'), d.getAttribute('cy')]]));
    expect(at).toEqual({ top: ['100', '0'], right: ['200', '50'], bottom: ['100', '100'], left: ['0', '50'] });
    expect(shown.every((d) => d.getAttribute('data-object-id') === a)).toBe(true);
    expect(shown[0]).toHaveAttribute('r', String(CONNECTOR_DOT_RADIUS_PX));
    expect(shown.every((d) => d.getAttribute('data-highlighted') === 'false')).toBe(true);
  });

  it('TC-19 dragging from A over B highlights the nearest dot of B; the release creates an attached arrow', () => {
    const doc = freshDoc();
    const a = addShape(doc, { x: 0, y: 0, width: 100, height: 100 });
    const b = addShape(doc, { x: 300, y: 0, width: 100, height: 100 });
    renderApp(doc);
    setCamera({ x: 0, y: 0, zoom: 1 });
    key('l', document.body);
    pointer(surface(), 'down', 50, 50);
    pointer(surface(), 'move', 200, 60);
    expect(screen.getByTestId('connector-preview')).toBeInTheDocument();
    pointer(surface(), 'move', 380, 80);
    const shown = dots();
    expect(shown).toHaveLength(4);
    expect(shown.every((d) => d.getAttribute('data-object-id') === b)).toBe(true);
    expect(shown.filter((d) => d.getAttribute('data-highlighted') === 'true').map((d) => d.getAttribute('data-side'))).toEqual(['left']);
    pointer(surface(), 'up', 380, 80);
    const [c] = connectors(doc);
    expect(raw(doc, c.id).get('from')).toMatchObject({ kind: 'attached', objectId: a });
    expect(raw(doc, c.id).get('to')).toMatchObject({ kind: 'attached', objectId: b });
    expect(c.ends).toEqual([{ x: 100, y: 50 }, { x: 300, y: 50 }]);
    expect(selection()).toEqual([c.id]);
    expect(screen.getByRole('button', { name: 'Select (V)' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('a release on the starting object or after a few pixels creates nothing and keeps the tool; empty space gives free ends', () => {
    const doc = freshDoc();
    addShape(doc, { x: 0, y: 0, width: 100, height: 100 });
    renderApp(doc);
    setCamera({ x: 0, y: 0, zoom: 1 });
    key('l', document.body);
    pointer(surface(), 'down', 20, 20);
    pointer(surface(), 'move', 80, 80);
    pointer(surface(), 'up', 80, 80);
    pointer(surface(), 'down', 400, 400);
    pointer(surface(), 'up', 405, 403);
    expect(connectors(doc)).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Connector (L)' })).toHaveAttribute('aria-pressed', 'true');
    pointer(surface(), 'down', 400, 400);
    pointer(surface(), 'move', 600, 500);
    pointer(surface(), 'cancel', 600, 500);
    expect(connectors(doc)).toHaveLength(0);
    pointer(surface(), 'down', 400, 400);
    pointer(surface(), 'up', 600, 500);
    const [c] = connectors(doc);
    expect(raw(doc, c.id).get('from')).toEqual({ kind: 'free', x: 400, y: 400 });
    expect(raw(doc, c.id).get('to')).toEqual({ kind: 'free', x: 600, y: 500 });
  });

  for (const zoom of [0.5, 2]) {
    it(`TC-20 at ${zoom * 100}% a press 5 px from the arrow's line selects it; 7 px does not`, () => {
      const doc = freshDoc();
      const id = createConnector(doc, { kind: 'free', x: 0, y: 0 }, { kind: 'free', x: 200, y: 0 }, 'g')!;
      renderApp(doc);
      const cam = { x: -100, y: -100, zoom };
      setCamera(cam);
      const mid = worldToScreen(cam, { x: 100, y: 0 });
      pointer(hitLine(id), 'down', mid.x, mid.y + 7);
      pointer(hitLine(id), 'up', mid.x, mid.y + 7);
      expect(selection()).toEqual([]);
      pointer(hitLine(id), 'down', mid.x, mid.y - 5);
      pointer(hitLine(id), 'up', mid.x, mid.y - 5);
      expect(selection()).toEqual([id]);
      // The hit stroke is as wide as the tolerance on both sides, whatever the zoom.
      expect(Number(hitLine(id).getAttribute('stroke-width')) * zoom).toBeCloseTo(12, 6);
    });
  }

  it('TC-21 dragging a selected arrow end handle onto C attaches it to C; onto empty space frees it there', () => {
    const doc = freshDoc();
    const a = addShape(doc, { x: 0, y: 0, width: 100, height: 100 });
    const b = addShape(doc, { x: 300, y: 0, width: 100, height: 100 });
    const c = addShape(doc, { x: 300, y: 300, width: 100, height: 100 });
    const id = createConnector(doc, { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } }, { kind: 'attached', objectId: b, fallback: { x: 0, y: 0 } }, 'g')!;
    renderApp(doc);
    setCamera({ x: 0, y: 0, zoom: 1 });
    expect(screen.queryByRole('button', { name: 'Arrow end' })).toBeNull();
    pointer(hitLine(id), 'down', 200, 50);
    pointer(hitLine(id), 'up', 200, 50);
    expect(selection()).toEqual([id]);
    // An arrow alone shows its end handles, not a selection box.
    expect(screen.queryByTestId('selection-box')).toBeNull();
    const handle = screen.getByRole('button', { name: 'Arrow end' });
    expect(handle).toHaveStyle({ left: '300px', top: '50px' });
    pointer(handle, 'down', 300, 50);
    pointer(handle, 'move', 330, 200);
    pointer(handle, 'up', 350, 350);
    expect(raw(doc, id).get('to')).toMatchObject({ kind: 'attached', objectId: c });
    expect(connectors(doc)[0].ends).toEqual([{ x: 100, y: 50 }, { x: 300, y: 350 }]);

    // Onto the object at the other end: snaps back, nothing written.
    const end = screen.getByRole('button', { name: 'Arrow end' });
    pointer(end, 'down', 300, 350);
    pointer(end, 'up', 50, 50);
    expect(raw(doc, id).get('to')).toMatchObject({ kind: 'attached', objectId: c });

    pointer(end, 'down', 300, 350);
    pointer(end, 'move', 500, 500);
    pointer(end, 'up', 600, 650);
    expect(raw(doc, id).get('to')).toEqual({ kind: 'free', x: 600, y: 650 });
    expect(raw(doc, id).get('from')).toMatchObject({ kind: 'attached', objectId: a });
    expect(selection()).toEqual([id]);
  });

  it('arrows follow a moved object; deleting the object leaves the arrow with a free end where it was', () => {
    const doc = freshDoc();
    const a = addShape(doc, { x: 0, y: 0, width: 100, height: 100 });
    const b = addShape(doc, { x: 300, y: 0, width: 100, height: 100 });
    const id = createConnector(doc, { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } }, { kind: 'attached', objectId: b, fallback: { x: 0, y: 0 } }, 'g')!;
    renderApp(doc);
    setCamera({ x: 0, y: 0, zoom: 1 });
    const el = () => document.querySelector(`[data-connector-id="${id}"]`)!;
    expect(el()).toHaveAttribute('data-to', '300,50');
    // Someone else moves B below A.
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
    remote.transact(() => {
      remote.getMap<Y.Map<unknown>>('objects').get(b)!.set('x', 0);
      remote.getMap<Y.Map<unknown>>('objects').get(b)!.set('y', 300);
    });
    act(() => Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote)));
    expect(el()).toHaveAttribute('data-from', '50,100');
    expect(el()).toHaveAttribute('data-to', '50,300');
    const shapeEl = document.querySelector<HTMLElement>(`[data-shape-id="${b}"]`)!;
    pointer(shapeEl, 'down', 50, 350);
    pointer(shapeEl, 'up', 50, 350);
    key('Delete', document.body);
    expect(objectSnapshot(doc).map((o) => o.id)).not.toContain(b);
    expect(raw(doc, id).get('to')).toEqual({ kind: 'free', x: 50, y: 300 });
    expect(el()).toHaveAttribute('data-to', '50,300');
  });
});
