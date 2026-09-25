/** Story 10 connector.ui component tests (TC-18 to TC-21): Connector tool and ConnectorObject. */
import { act, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createShape } from '../../src/shared/objects/shape';
import { createConnector } from '../../src/shared/objects/connector';
import type { Rect } from '../../src/shared/geometry';
import { readCamera } from './helpers';
import { connectors, key, objectEl, pointer, renderApp, setCamera, toolButton, toScreen } from './shapeHelpers';

let doc: Y.Doc;

beforeEach(() => {
  doc = new Y.Doc();
});

afterEach(() => {
  vi.useRealTimers();
});

function addBox(r: Rect): string {
  let id = '';
  act(() => {
    id = createShape(doc, { kind: 'rect', rect: r, at: { x: r.x, y: r.y } }, 'g')!;
  });
  return id;
}

function centre(r: Rect) {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

function layer(): HTMLElement {
  return screen.getByTestId('connector-tool');
}

function dots(): { side: string; x: number; y: number; highlighted: boolean }[] {
  return screen.queryAllByTestId('connection-dot').map((d) => ({
    side: d.dataset.side!,
    x: Number(d.getAttribute('cx')),
    y: Number(d.getAttribute('cy')),
    highlighted: d.dataset.highlighted === 'true',
  }));
}

const A: Rect = { x: 0, y: 0, width: 100, height: 100 };
const B: Rect = { x: 300, y: 0, width: 100, height: 100 };
const C: Rect = { x: 300, y: 300, width: 100, height: 100 };

describe('connector.ui', () => {
  it('TC-18 L, hover a shape: four dots at its side midpoints; none over empty space', () => {
    renderApp(doc);
    addBox(A);
    key('l');
    expect(toolButton('Connector (L)')).toHaveAttribute('aria-pressed', 'true');
    pointer(layer(), 'pointerMove', toScreen(centre(A)));
    const camera = readCamera();
    const expected = {
      top: toScreen({ x: 50, y: 0 }, camera),
      right: toScreen({ x: 100, y: 50 }, camera),
      bottom: toScreen({ x: 50, y: 100 }, camera),
      left: toScreen({ x: 0, y: 50 }, camera),
    };
    const shown = dots();
    expect(shown).toHaveLength(4);
    for (const d of shown) expect({ x: d.x, y: d.y }).toEqual(expected[d.side as keyof typeof expected]);
    expect(shown.some((d) => d.highlighted)).toBe(false);

    pointer(layer(), 'pointerMove', toScreen({ x: 700, y: 700 }));
    expect(dots()).toHaveLength(0);
  });

  it('TC-19 drag from A over B: B’s facing dot highlighted; release creates an attached arrow, selected, Select active', () => {
    renderApp(doc);
    const a = addBox(A);
    const b = addBox(B);
    key('l');
    const el = layer();
    pointer(el, 'pointerDown', toScreen(centre(A)));
    pointer(el, 'pointerMove', toScreen({ x: 200, y: 50 }));
    expect(screen.getByTestId('connector-preview')).toBeInTheDocument();
    pointer(el, 'pointerMove', toScreen({ x: 330, y: 20 }));
    const shown = dots();
    expect(shown).toHaveLength(4);
    expect(shown.filter((d) => d.highlighted).map((d) => d.side)).toEqual(['left']);
    expect(shown.find((d) => d.side === 'left')).toMatchObject(toScreen({ x: 300, y: 50 }));
    expect(connectors(doc)).toHaveLength(0);
    pointer(el, 'pointerUp', toScreen({ x: 330, y: 20 }));

    const all = connectors(doc);
    expect(all).toHaveLength(1);
    const c = all[0]!;
    expect(c.from).toMatchObject({ kind: 'attached', objectId: a });
    expect(c.to).toMatchObject({ kind: 'attached', objectId: b });
    expect(c.fromPoint).toEqual({ x: 100, y: 50 });
    expect(c.toPoint).toEqual({ x: 300, y: 50 });
    expect(objectEl(c.id)).toHaveAttribute('data-selected', 'true');
    expect(toolButton('Select (V)')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('group', { name: 'Arrow from rectangle to rectangle' })).toBeInTheDocument();
  });

  it('TC-19 released on the start object or after a few pixels: nothing, tool stays; empty space: free ends', () => {
    renderApp(doc);
    addBox(A);
    key('l');
    const el = layer();
    pointer(el, 'pointerDown', toScreen({ x: 20, y: 20 }));
    pointer(el, 'pointerMove', toScreen({ x: 80, y: 80 }));
    pointer(el, 'pointerUp', toScreen({ x: 80, y: 80 }));
    pointer(el, 'pointerDown', toScreen({ x: 600, y: 600 }));
    pointer(el, 'pointerUp', toScreen({ x: 605, y: 600 }));
    expect(connectors(doc)).toHaveLength(0);
    expect(toolButton('Connector (L)')).toHaveAttribute('aria-pressed', 'true');

    pointer(el, 'pointerDown', toScreen(centre(A)));
    pointer(el, 'pointerMove', toScreen({ x: 500, y: 50 }));
    pointer(el, 'pointerUp', toScreen({ x: 500, y: 50 }));
    const c = connectors(doc)[0]!;
    expect(c.to).toEqual({ kind: 'free', x: 500, y: 50 });
    expect(c.fromPoint).toEqual({ x: 100, y: 50 });

    key('l');
    pointer(layer(), 'pointerDown', toScreen({ x: 600, y: 600 }));
    pointer(layer(), 'pointerUp', toScreen({ x: 700, y: 650 }));
    const free = connectors(doc).find((x) => x.id !== c.id)!;
    expect(free.from).toEqual({ kind: 'free', x: 600, y: 600 });
    expect(free.to).toEqual({ kind: 'free', x: 700, y: 650 });
  });

  for (const zoom of [0.5, 2]) {
    it(`TC-20 at ${zoom * 100}%: a press 5 px from the line selects the arrow, 7 px does not`, () => {
      renderApp(doc);
      let id = '';
      act(() => {
        id = createConnector(doc, { kind: 'free', x: 0, y: 0 }, { kind: 'free', x: 200, y: 0 }, 'g')!;
      });
      setCamera({ x: -100, y: -100, zoom });
      const camera = readCamera();
      expect(camera.zoom).toBe(zoom);
      const hit = () => objectEl(id).querySelector('[data-testid="connector-hit"]')!;
      const onLine = toScreen({ x: 100, y: 0 }, camera);

      pointer(hit(), 'pointerDown', { x: onLine.x, y: onLine.y + 7 });
      pointer(hit(), 'pointerUp', { x: onLine.x, y: onLine.y + 7 });
      expect(objectEl(id)).toHaveAttribute('data-selected', 'false');

      pointer(hit(), 'pointerDown', { x: onLine.x, y: onLine.y - 5 });
      pointer(hit(), 'pointerUp', { x: onLine.x, y: onLine.y - 5 });
      expect(objectEl(id)).toHaveAttribute('data-selected', 'true');
      // The hit band is the tolerance on screen at every zoom.
      expect(Number(hit().getAttribute('stroke-width')) * zoom).toBeCloseTo(12);
    });
  }

  it('TC-21 dragging the end handle onto C attaches to C; onto empty space frees it at the release point', () => {
    renderApp(doc);
    const a = addBox(A);
    const b = addBox(B);
    const c3 = addBox(C);
    let id = '';
    act(() => {
      id = createConnector(doc, { kind: 'attached', objectId: a, fallback: { x: 0, y: 0 } }, { kind: 'attached', objectId: b, fallback: { x: 0, y: 0 } }, 'g')!;
    });
    const mid = toScreen({ x: 200, y: 50 });
    const hit = objectEl(id).querySelector('[data-testid="connector-hit"]')!;
    pointer(hit, 'pointerDown', mid);
    pointer(hit, 'pointerUp', mid);
    expect(objectEl(id)).toHaveAttribute('data-selected', 'true');

    const drag = (handleName: string, to: { x: number; y: number }) => {
      const handle = screen.getByRole('button', { name: handleName });
      const at = { x: Number(handle.getAttribute('cx')), y: Number(handle.getAttribute('cy')) };
      pointer(handle, 'pointerDown', toScreen(at));
      pointer(handle, 'pointerMove', toScreen({ x: (at.x + to.x) / 2, y: (at.y + to.y) / 2 }));
      pointer(handle, 'pointerMove', toScreen(to));
      pointer(handle, 'pointerUp', toScreen(to));
    };

    drag('Arrow end', centre(C));
    let conn = connectors(doc)[0]!;
    expect(conn.to).toMatchObject({ kind: 'attached', objectId: c3 });
    expect(conn.from).toMatchObject({ kind: 'attached', objectId: a });

    // Onto the object at the other end: snaps back, nothing written.
    drag('Arrow end', centre(A));
    expect(connectors(doc)[0]!.to).toMatchObject({ kind: 'attached', objectId: c3 });

    drag('Arrow end', { x: 600, y: 120 });
    conn = connectors(doc)[0]!;
    expect(conn.to).toEqual({ kind: 'free', x: 600, y: 120 });
    expect(conn.toPoint).toEqual({ x: 600, y: 120 });

    drag('Arrow start', { x: -300, y: 120 });
    expect(connectors(doc)[0]!.from).toEqual({ kind: 'free', x: -300, y: 120 });
    expect(objectEl(id)).toHaveAttribute('data-selected', 'true');
  });
});
