import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { App } from '../../src/client/App';
import { connectorHitTest, getObjectType } from '../../src/client/objects/registry';
import { initDoc, objectsMap, objectsSnapshot } from '../../src/shared/board-model';
import { CONNECTOR_DOT_RADIUS_PX } from '../../src/shared/config';
import { type ConnectorSnap, createConnector, isConnector } from '../../src/shared/objects/connector';
import { createShape } from '../../src/shared/objects/shape';
import type { Rect } from '../../src/shared/geometry';
import { flushFrame, pointer } from './helpers';

function newDoc() {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function box(doc: Y.Doc, r: Rect) {
  return createShape(doc, { kind: 'rect', rect: r, at: { x: r.x, y: r.y } }, 'g')!;
}

function setup(doc: Y.Doc, camera = { x: 0, y: 0, zoom: 1 }) {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout'] });
  render(<App doc={doc} />);
  act(() => window.__vidi6?.setCamera(camera));
  flushFrame();
}

const arrows = (doc: Y.Doc) => objectsSnapshot(doc).filter(isConnector) as ConnectorSnap[];
const layer = () => screen.getByTestId('connector-tool');
const dots = () => screen.queryAllByTestId('connector-dot');
const selection = () => window.__vidi6?.getSelection?.();
const arrowEl = (id: string) => document.querySelector(`[data-connector-object][data-id="${id}"]`) as HTMLElement;

/** A at (100,100) 100x100, B at (400,100) 100x100, C at (100,400) 100x100; camera at world (0,0), 100%. */
function threeBoxes() {
  const doc = newDoc();
  const a = box(doc, { x: 100, y: 100, width: 100, height: 100 });
  const b = box(doc, { x: 400, y: 100, width: 100, height: 100 });
  const c = box(doc, { x: 100, y: 400, width: 100, height: 100 });
  return { doc, a, b, c };
}

describe('connector.ui ConnectorTool', () => {
  it('TC-18 L, hover a shape → four dots at its side midpoints', () => {
    const { doc } = threeBoxes();
    setup(doc);
    fireEvent.keyDown(window, { key: 'l' });
    expect(screen.getByRole('button', { name: 'Connector (L)' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.pointerMove(layer(), { clientX: 20, clientY: 20, pointerId: 1 });
    expect(dots()).toHaveLength(0);
    fireEvent.pointerMove(layer(), { clientX: 150, clientY: 150, pointerId: 1 });
    const found = dots().map((d) => [d.dataset.side, Number(d.getAttribute('cx')), Number(d.getAttribute('cy'))]);
    expect(found).toEqual([
      ['top', 150, 100],
      ['right', 200, 150],
      ['bottom', 150, 200],
      ['left', 100, 150],
    ]);
    expect(dots().every((d) => Number(d.getAttribute('r')) === CONNECTOR_DOT_RADIUS_PX)).toBe(true);
  });

  it('TC-19 drag from A over B highlights B’s nearest dot; release creates an attached arrow, selected, back to Select', () => {
    const { doc, a, b } = threeBoxes();
    setup(doc);
    fireEvent.keyDown(window, { key: 'l' });
    pointer(layer(), 'down', 150, 150);
    pointer(layer(), 'move', 300, 150);
    expect(screen.getByTestId('connector-preview')).toBeTruthy();
    pointer(layer(), 'move', 470, 180);
    const highlighted = dots().filter((d) => d.dataset.highlighted === 'true');
    expect(highlighted).toHaveLength(1);
    expect(highlighted[0]!.dataset.side).toBe('left');
    expect(highlighted[0]!.dataset.objectId).toBe(b);
    pointer(layer(), 'up', 470, 180);
    const [c] = arrows(doc);
    expect(c!.from).toMatchObject({ kind: 'attached', objectId: a });
    expect(c!.to).toMatchObject({ kind: 'attached', objectId: b });
    expect(c!.ends).toEqual({ from: { x: 200, y: 150 }, to: { x: 400, y: 150 } });
    expect(selection()).toEqual([c!.id]);
    expect(screen.getByRole('button', { name: 'Select (V)' }).getAttribute('aria-pressed')).toBe('true');
    expect(arrowEl(c!.id).getAttribute('aria-label')).toBe('Arrow from Rectangle to Rectangle');
  });

  it('released on empty space → free end at the release point; started on empty space → free start', () => {
    const { doc, a } = threeBoxes();
    setup(doc);
    fireEvent.keyDown(window, { key: 'l' });
    pointer(layer(), 'down', 150, 150);
    pointer(layer(), 'up', 700, 600);
    expect(arrows(doc)[0]!.to).toEqual({ kind: 'free', x: 700, y: 600 });
    fireEvent.keyDown(window, { key: 'l' });
    pointer(layer(), 'down', 700, 50);
    pointer(layer(), 'up', 150, 150);
    const second = arrows(doc).find((c) => c.from.kind === 'free' && c.from.y === 50)!;
    expect(second.from).toEqual({ kind: 'free', x: 700, y: 50 });
    expect(second.to).toMatchObject({ kind: 'attached', objectId: a });
  });

  it('released on the start object or moved less than 8 units → no arrow, tool stays Connector', () => {
    const { doc } = threeBoxes();
    setup(doc);
    fireEvent.keyDown(window, { key: 'l' });
    pointer(layer(), 'down', 120, 120);
    pointer(layer(), 'up', 180, 180);
    pointer(layer(), 'down', 700, 600);
    pointer(layer(), 'up', 705, 605);
    expect(arrows(doc)).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Connector (L)' }).getAttribute('aria-pressed')).toBe('true');
  });
});

describe('connector.ui ConnectorObject', () => {
  it.each([0.5, 2])('TC-20 at zoom %s a click 5 px (screen) from the line selects it; 7 px does not', (zoom) => {
    const doc = newDoc();
    const id = createConnector(doc, { kind: 'free', x: 0, y: 0 }, { kind: 'free', x: 400, y: 400 }, 'g')!;
    setup(doc, { x: -100, y: -100, zoom });
    const hit = arrowEl(id).querySelector('[data-testid="connector-hit"]') as HTMLElement;
    // Screen point of world (200, 200), then 7 px and 5 px away perpendicular to the line.
    const mid = { x: (200 + 100) * zoom, y: (200 + 100) * zoom };
    const off = (px: number) => ({ x: mid.x + px / Math.SQRT2, y: mid.y - px / Math.SQRT2 });
    // Inside the arrow's bounding box, but farther than the tolerance.
    const far = off(7);
    pointer(hit, 'down', far.x, far.y);
    pointer(hit, 'up', far.x, far.y);
    expect(selection()).toEqual([]);
    const near = off(5);
    pointer(hit, 'down', near.x, near.y);
    pointer(hit, 'up', near.x, near.y);
    expect(selection()).toEqual([id]);
    expect(arrowEl(id).dataset.selected).toBe('true');
    // The registry hit test agrees (world units = screen / zoom).
    const c = arrows(doc)[0]!;
    const world = (p: { x: number; y: number }) => ({ x: p.x / zoom - 100, y: p.y / zoom - 100 });
    expect(getObjectType('connector')!.hitTest(c, world(near), zoom)).toBe(true);
    expect(connectorHitTest(c, world(far), zoom)).toBe(false);
  });

  it('TC-21 dragging a selected arrow’s end handle onto C attaches it; onto empty space frees it there', () => {
    const { doc, a, b, c } = threeBoxes();
    const id = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } },
      { kind: 'attached', objectId: b, fallback: { x: 0, y: 0 } },
      'g',
    )!;
    setup(doc);
    const hit = arrowEl(id).querySelector('[data-testid="connector-hit"]') as HTMLElement;
    pointer(hit, 'down', 300, 150);
    pointer(hit, 'up', 300, 150);
    expect(selection()).toEqual([id]);
    const handle = () => screen.getByRole('button', { name: 'Arrow end' });
    expect(screen.getByRole('button', { name: 'Arrow start' })).toBeTruthy();
    pointer(handle(), 'down', 400, 150);
    pointer(handle(), 'move', 150, 450);
    expect(arrowEl(id).dataset.state).toBe('reattaching');
    pointer(handle(), 'up', 150, 450);
    expect(objectsMap(doc).get(id)!.get('to')).toMatchObject({ kind: 'attached', objectId: c });
    expect(arrows(doc)[0]!.ends).toEqual({ from: { x: 150, y: 200 }, to: { x: 150, y: 400 } });
    expect(selection()).toEqual([id]);

    pointer(handle(), 'down', 150, 400);
    pointer(handle(), 'move', 640, 560);
    pointer(handle(), 'up', 640, 560);
    expect(objectsMap(doc).get(id)!.get('to')).toEqual({ kind: 'free', x: 640, y: 560 });

    // Onto the object at the other end: rejected, the handle snaps back.
    pointer(handle(), 'down', 640, 560);
    pointer(handle(), 'up', 150, 150);
    expect(objectsMap(doc).get(id)!.get('to')).toEqual({ kind: 'free', x: 640, y: 560 });
  });

  it('moving an attached shape redraws the arrow at its nearest side', () => {
    const { doc, a, b } = threeBoxes();
    const id = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } },
      { kind: 'attached', objectId: b, fallback: { x: 0, y: 0 } },
      'g',
    )!;
    setup(doc);
    const bEl = document.querySelector(`[data-shape-object][data-id="${b}"]`) as HTMLElement;
    pointer(bEl, 'down', 450, 150);
    pointer(bEl, 'move', 150, 650);
    flushFrame();
    pointer(bEl, 'up', 150, 650);
    flushFrame();
    // B now lies below A.
    expect(arrowEl(id).dataset.x1).toBe('150');
    expect(arrowEl(id).dataset.y1).toBe('200');
  });

  it('a group move takes free arrow ends along; attached ends stay with their objects', () => {
    const { doc, a } = threeBoxes();
    const id = createConnector(doc, { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } }, { kind: 'free', x: 600, y: 150 }, 'g')!;
    setup(doc);
    const hit = arrowEl(id).querySelector('[data-testid="connector-hit"]') as HTMLElement;
    pointer(hit, 'down', 400, 150);
    pointer(hit, 'move', 400, 250);
    flushFrame();
    pointer(hit, 'move', 400, 350);
    flushFrame();
    pointer(hit, 'up', 400, 350);
    flushFrame();
    expect(objectsMap(doc).get(id)!.get('to')).toEqual({ kind: 'free', x: 600, y: 350 });
    expect(objectsMap(doc).get(id)!.get('from')).toMatchObject({ kind: 'attached', objectId: a });
  });
});
