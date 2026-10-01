import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../../src/client/App';
import { snapshot } from '../../src/shared/board-model';
import { createConnector } from '../../src/shared/objects/connector';
import type { ConnectorSnap, Endpoint } from '../../src/shared/objects/connector';
import { createShape } from '../../src/shared/objects/shape';
import { Harness, newProbe } from './helpers';
import { drag, drawShape, key, shapes } from './shapeHelpers';

afterEach(cleanup);

const toolLayer = () => screen.getByTestId('connector-tool-layer');
const dots = () => screen.queryAllByTestId('connector-dot');
const arrows = () => [...document.querySelectorAll<SVGElement>('[data-connector-object]')];

/** Two shapes drawn with the real tool: A at screen (100..260, 100..260), B at (500..660, 100..260). */
function twoShapes() {
  render(<App />);
  drawShape([100, 100], [260, 260]);
  drawShape([500, 100], [660, 260]);
}

describe('connector tool', () => {
  it('TC-18 hovering a shape with the Connector tool shows four dots at the side midpoints', () => {
    twoShapes();
    key('l');
    expect(dots()).toHaveLength(0);
    fireEvent.pointerMove(toolLayer(), { clientX: 180, clientY: 180, pointerId: 1 });
    expect(dots()).toHaveLength(4);
    const at = Object.fromEntries(dots().map((d) => [d.getAttribute('data-side'), [d.getAttribute('cx'), d.getAttribute('cy')]]));
    expect(at).toEqual({ top: ['180', '100'], bottom: ['180', '260'], left: ['100', '180'], right: ['260', '180'] });
    fireEvent.pointerMove(toolLayer(), { clientX: 400, clientY: 500, pointerId: 1 });
    expect(dots()).toHaveLength(0);
  });

  it('TC-19 dragging from A over B highlights B’s nearest dot; releasing creates an attached arrow', () => {
    twoShapes();
    key('l');
    fireEvent.pointerDown(toolLayer(), { clientX: 180, clientY: 180, pointerId: 1, button: 0 });
    fireEvent.pointerMove(toolLayer(), { clientX: 580, clientY: 190, pointerId: 1 });
    const lit = dots().filter((d) => d.getAttribute('data-highlighted') === 'true');
    expect(lit).toHaveLength(1);
    expect(lit[0].getAttribute('data-side')).toBe('left');
    expect(screen.getByTestId('connector-preview')).toBeTruthy();
    fireEvent.pointerUp(toolLayer(), { clientX: 580, clientY: 190, pointerId: 1 });
    expect(arrows()).toHaveLength(1);
    expect(arrows()[0].dataset.selected).toBe('true');
    expect(screen.getByRole('button', { name: 'Select (V)' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByTestId('connector-tool-layer')).toBeNull();
    // Attached sides: A's right-middle to B's left-middle.
    const line = arrows()[0].querySelector('[data-testid="connector-hit"]') as SVGLineElement;
    const x = shapes().map((s) => parseFloat(s.style.left));
    expect(parseFloat(line.getAttribute('x1') as string)).toBeCloseTo(x[0] + 160);
    expect(parseFloat(line.getAttribute('x2') as string)).toBeCloseTo(x[1]);
  });

  it('releasing over empty space creates an arrow with a free end; a drag from empty space starts free', () => {
    twoShapes();
    key('l');
    drag(toolLayer(), [180, 180], [400, 500]);
    expect(arrows()).toHaveLength(1);
    key('l');
    drag(toolLayer(), [800, 600], [900, 650]);
    expect(arrows()).toHaveLength(2);
  });

  it('releasing on the starting object, or after under 8 units, creates nothing and keeps the tool', () => {
    twoShapes();
    key('l');
    drag(toolLayer(), [120, 120], [240, 240]);
    drag(toolLayer(), [800, 600], [804, 603]);
    expect(arrows()).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Connector (L)' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('TC-22 Escape with the Connector tool returns to Select and creates nothing', () => {
    twoShapes();
    key('l');
    fireEvent.pointerDown(toolLayer(), { clientX: 180, clientY: 180, pointerId: 1, button: 0 });
    key('Escape');
    expect(screen.getByRole('button', { name: 'Select (V)' }).getAttribute('aria-pressed')).toBe('true');
    expect(arrows()).toHaveLength(0);
  });
});

const att = (objectId: string): Endpoint => ({ kind: 'attached', objectId, fallback: { x: 0, y: 0 } });

function arrowHarness(zoom = 1) {
  const probe = newProbe();
  render(<Harness probe={probe} zoom={zoom} />);
  const shape = (x: number, y: number) =>
    createShape(probe.doc, { kind: 'rect', rect: { x, y, width: 100, height: 100 }, at: { x, y } }, 'u') as string;
  return { probe, shape };
}
const hit = () => screen.getByTestId('connector-hit');
const connector = (probe: { doc: import('yjs').Doc }) => snapshot(probe.doc).find((o) => o.type === 'connector') as ConnectorSnap;

describe('connector object', () => {
  it('TC-20 a click within 6 screen pixels of the line selects the arrow, farther does not (50% and 200%)', () => {
    for (const zoom of [0.5, 2]) {
      const { probe } = arrowHarness(zoom);
      let id = '';
      act(() => {
        id = createConnector(probe.doc, { kind: 'free', x: 0, y: 0 }, { kind: 'free', x: 400, y: 0 }, 'u') as string;
      });
      // Screen y offsets are in pixels: the world offset is px / zoom.
      fireEvent.pointerDown(hit(), { clientX: 100 * zoom, clientY: 7, pointerId: 1, button: 0 });
      expect(probe.ids.size).toBe(0);
      fireEvent.pointerUp(window, { pointerId: 1 });
      fireEvent.pointerDown(hit(), { clientX: 100 * zoom, clientY: 5, pointerId: 1, button: 0 });
      expect(probe.selectedId).toBe(id);
      fireEvent.pointerUp(window, { pointerId: 1 });
      cleanup();
    }
  });

  it('draws an arrowhead and shows two end handles only while selected', () => {
    const { probe } = arrowHarness();
    act(() => {
      createConnector(probe.doc, { kind: 'free', x: 0, y: 0 }, { kind: 'free', x: 400, y: 0 }, 'u');
    });
    expect(screen.getByTestId('connector-head')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Arrow end handle' })).toBeNull();
    fireEvent.pointerDown(hit(), { clientX: 100, clientY: 0, pointerId: 1, button: 0 });
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(screen.getByRole('button', { name: 'Arrow start handle' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Arrow end handle' })).toBeTruthy();
  });

  it('follows a moved object without any write to the arrow', () => {
    const { probe, shape } = arrowHarness();
    let a = '';
    act(() => {
      a = shape(0, 0);
      createConnector(probe.doc, att(a), { kind: 'free', x: 500, y: 50 }, 'u');
    });
    expect(hit().getAttribute('x1')).toBe('100');
    act(() => {
      probe.doc.getMap<import('yjs').Map<unknown>>('objects').get(a)?.set('x', 700);
    });
    // Moved past the other end: the arrow now leaves from the side that faces it.
    expect(hit().getAttribute('x1')).toBe('700');
  });

  it('TC-21 dragging an end handle onto another shape attaches it; onto empty space frees it at the release point', () => {
    const { probe, shape } = arrowHarness();
    let c = '';
    let id = '';
    act(() => {
      const a = shape(0, 0);
      const b = shape(400, 0);
      c = shape(0, 400);
      id = createConnector(probe.doc, att(a), att(b), 'u') as string;
    });
    fireEvent.pointerDown(hit(), { clientX: 200, clientY: 50, pointerId: 1, button: 0 });
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(probe.selectedId).toBe(id);
    const handle = () => screen.getByRole('button', { name: 'Arrow end handle' });
    fireEvent.pointerDown(handle(), { clientX: 400, clientY: 50, pointerId: 2, button: 0 });
    fireEvent.pointerMove(window, { clientX: 50, clientY: 450, pointerId: 2 });
    fireEvent.pointerUp(window, { clientX: 50, clientY: 450, pointerId: 2 });
    expect(connector(probe).to).toMatchObject({ kind: 'attached', objectId: c });
    fireEvent.pointerDown(handle(), { clientX: 50, clientY: 400, pointerId: 3, button: 0 });
    fireEvent.pointerUp(window, { clientX: 700, clientY: 700, pointerId: 3 });
    expect(connector(probe).to).toEqual({ kind: 'free', x: 700, y: 700 });
    expect(probe.selectedId).toBe(id);
  });

  it('releasing a handle over the object at the other end snaps back', () => {
    const { probe, shape } = arrowHarness();
    act(() => {
      const a = shape(0, 0);
      const b = shape(400, 0);
      createConnector(probe.doc, att(a), att(b), 'u');
    });
    fireEvent.pointerDown(hit(), { clientX: 200, clientY: 50, pointerId: 1, button: 0 });
    fireEvent.pointerUp(window, { pointerId: 1 });
    const before = JSON.stringify(connector(probe).to);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Arrow end handle' }), { clientX: 400, clientY: 50, pointerId: 2, button: 0 });
    fireEvent.pointerUp(window, { clientX: 50, clientY: 50, pointerId: 2 });
    expect(JSON.stringify(connector(probe).to)).toBe(before);
  });
});
