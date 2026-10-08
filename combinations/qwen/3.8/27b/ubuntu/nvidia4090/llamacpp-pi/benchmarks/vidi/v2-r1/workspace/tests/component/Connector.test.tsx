// Story 10 component tests: the Connector tool and the connector object
// (TC-18 to TC-21).
//
//  - TC-18: hovering a shape with the L tool shows four side dots.
//  - TC-19: dragging from A over B highlights B's nearest dot; releasing
//    creates an arrow attached to both.
//  - TC-20: the zoom-aware line hit test — a point 5 screen px from the line
//    selects, 7 screen px does not, at both 50% and 200% zoom (boundary,
//    negative). jsdom has no SVG geometry hit-testing, so the registry
//    hitTest (the single source of truth for arrow selection) is exercised
//    directly at the boundary.
//  - TC-21: dragging a selected arrow's end handle onto a shape attaches the
//    end there; releasing over empty space frees it at the release point.
//
// The camera is pinned to the origin; TC-20 additionally exercises the zoom
// argument directly.

import { describe, it, expect } from 'vitest';
import { act } from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { createConnector } from '../../src/shared/objects/connector';
import { createShape } from '../../src/shared/objects/shape';
import { objectsSnapshot } from '../../src/shared/board-model';
import { getObjectType } from '../../src/client/objects/registry';
import { flushRaf, hooks, renderApp } from './helpers';

const connectorButton = () => screen.getByRole('button', { name: 'Connector (L)' });
const vp = () => screen.getByTestId('board-viewport');

function pinCamera(cam?: { x: number; y: number; zoom: number }): void {
  hooks().setCamera(cam ?? { x: 0, y: 0, zoom: 1 });
}

function press(x: number, y: number): void {
  fireEvent.pointerDown(vp(), { pointerId: 1, clientX: x, clientY: y, bubbles: true });
}
function move(x: number, y: number): void {
  fireEvent.pointerMove(window, { pointerId: 1, clientX: x, clientY: y, bubbles: true });
}
function release(x: number, y: number): void {
  fireEvent.pointerUp(vp(), { pointerId: 1, clientX: x, clientY: y, bubbles: true });
}

function makeShape(at: { x: number; y: number }, w = 200, h = 120): string {
  let id = '';
  act(() => {
    id = createShape(hooks().doc, { kind: 'rect', rect: { ...at, width: w, height: h }, at }, 'me') ?? '';
  });
  return id;
}

function makeFreeConnector(a: { x: number; y: number }, b: { x: number; y: number }): string {
  let id = '';
  act(() => {
    id =
      createConnector(
        hooks().doc,
        { kind: 'free', ...a },
        { kind: 'free', ...b },
        'me',
      ) ?? '';
  });
  return id;
}

function connectorInfo(id: string): {
  from?: { kind: string; objectId?: string; x?: number; y?: number };
  to?: { kind: string; objectId?: string; x?: number; y?: number };
} {
  const o = hooks().getObjects().find((x) => x.id === id);
  return { from: o?.from, to: o?.to };
}

describe('connector tool and object (component)', () => {
  it('TC-18: hovering a shape with the L tool shows four side dots', async () => {
    await renderApp();
    pinCamera();
    makeShape({ x: 0, y: 0 }, 200, 120);

    fireEvent.keyDown(window, { key: 'l' });
    expect(connectorButton()).toHaveAttribute('aria-pressed', 'true');

    move(100, 60); // inside the shape
    await flushRaf();
    const dots = screen.getAllByTestId('connector-dot');
    expect(dots).toHaveLength(4);
    const sides = dots.map((d) => d.getAttribute('data-side')).sort();
    expect(sides).toEqual(['bottom', 'left', 'right', 'top']);
  });

  it('TC-19: dragging from A over B highlights B nearest dot; release attaches to both', async () => {
    await renderApp();
    pinCamera();
    const a = makeShape({ x: 0, y: 0 }, 200, 120);
    const b = makeShape({ x: 500, y: 0 }, 200, 120);

    fireEvent.keyDown(window, { key: 'l' });
    press(100, 60); // on A
    move(600, 60); // over B
    await flushRaf();

    // B's side nearest A (the left side) is the highlighted dot.
    const hl = screen.queryAllByTestId('connector-dot').find((d) =>
      d.hasAttribute('data-highlighted'),
    );
    expect(hl).toBeDefined();
    expect(hl!.getAttribute('data-side')).toBe('left');

    release(600, 60);
    await flushRaf();
    const objs = hooks().getObjects().filter((o) => o.type === 'connector');
    expect(objs).toHaveLength(1);
    const info = connectorInfo(objs[0]!.id);
    expect(info.from?.kind).toBe('attached');
    expect(info.from?.objectId).toBe(a);
    expect(info.to?.kind).toBe('attached');
    expect(info.to?.objectId).toBe(b);
  });

  it('TC-20: line hit test — 5px selects, 7px does not, at 50% and 200% zoom', async () => {
    await renderApp();
    // A free arrow along the x-axis from (0,0) to (200,0).
    makeFreeConnector({ x: 0, y: 0 }, { x: 200, y: 0 });
    const snap = objectsSnapshot(hooks().doc).find((o) => o.type === 'connector')!;
    const spec = getObjectType('connector')!;

    for (const zoom of [0.5, 2]) {
      // 5 screen px below the line (world offset = 5 / zoom).
      const hit = { x: 100, y: 5 / zoom };
      expect(spec.hitTest(snap, hit, zoom)).toBe(true);
      // 7 screen px below the line — beyond the 6px tolerance.
      const miss = { x: 100, y: 7 / zoom };
      expect(spec.hitTest(snap, miss, zoom)).toBe(false);
    }
  });

  it('TC-21: dragging an end handle onto a shape attaches; onto empty space frees', async () => {
    await renderApp();
    pinCamera();
    const c = makeShape({ x: 500, y: 0 }, 100, 100);
    const arrow = makeFreeConnector({ x: 0, y: 0 }, { x: 200, y: 0 });

    // Select the arrow (click its hit line).
    fireEvent.pointerDown(screen.getByTestId('connector-hitline'), {
      pointerId: 1,
      clientX: 100,
      clientY: 0,
      bubbles: true,
    });
    fireEvent.pointerUp(screen.getByTestId('connector-hitline'), {
      pointerId: 1,
      clientX: 100,
      clientY: 0,
      bubbles: true,
    });
    await flushRaf();
    expect(screen.getByTestId('connector-object')).toHaveAttribute('data-selected');

    // Drag the 'to' handle onto C → attached to C.
    fireEvent.pointerDown(screen.getByTestId('connector-handle-to'), {
      pointerId: 1,
      clientX: 200,
      clientY: 0,
      bubbles: true,
    });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 550, clientY: 50, bubbles: true });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 550, clientY: 50, bubbles: true });
    await flushRaf();
    let info = connectorInfo(arrow);
    expect(info.to?.kind).toBe('attached');
    expect(info.to?.objectId).toBe(c);

    // Drag the same handle to empty space → free at the release point.
    fireEvent.pointerDown(screen.getByTestId('connector-handle-to'), {
      pointerId: 1,
      clientX: 550,
      clientY: 50,
      bubbles: true,
    });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 900, clientY: 300, bubbles: true });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 900, clientY: 300, bubbles: true });
    await flushRaf();
    info = connectorInfo(arrow);
    expect(info.to?.kind).toBe('free');
    expect(info.to?.x).toBeCloseTo(900, 5);
    expect(info.to?.y).toBeCloseTo(300, 5);
  });
});
