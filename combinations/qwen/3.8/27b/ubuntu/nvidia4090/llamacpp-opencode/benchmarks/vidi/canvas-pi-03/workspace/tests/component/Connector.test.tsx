import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, act, cleanup } from '@testing-library/react';
import { renderFullApp, hooks, firePointer, fireWindowPointer, pressKey } from './story2';
import { createShape } from '@/shared/objects/shape';
import { createConnector, readConnector } from '@/shared/objects/connector';
import { getObjectType } from '@/client/objects/registry';
import { CONNECTOR_HIT_TOLERANCE_PX } from '@/shared/config';
import type { Point, Rect } from '@/shared/geometry';
import type { Endpoint } from '@/shared/objects/connector';

// Story 5: the board page checks existence before rendering the board.
vi.mock('@/client/api', () => ({
  checkBoard: vi.fn(async () => ({ kind: 'exists' })),
  createBoardRequest: vi.fn(async () => ({ kind: 'failed' })),
}));

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** jsdom window is 1024x768; initial camera (-512,-384), zoom 1. */
const S = (wx: number, wy: number): { x: number; y: number } => ({ x: wx + 512, y: wy + 384 });

/** Creates a shape through the model (as a remote client would). */
function makeShape(rect: Rect, kind: 'rect' | 'ellipse' | 'diamond' = 'rect'): string {
  let id = '';
  act(() => {
    id = createShape(hooks().getDoc(), { kind, rect, at: { x: rect.x, y: rect.y } }, 'tester')!;
  });
  return id;
}

function makeConnector(from: Endpoint, to: Endpoint): string {
  let id = '';
  act(() => {
    id = createConnector(hooks().getDoc(), from, to, 'tester')!;
  });
  return id;
}

function attached(id: string, fallback: Point): Endpoint {
  return { kind: 'attached', objectId: id, fallback };
}

/** A connector as it appears in the object snapshot (resolved points included). */
interface ConnectorObjSnap {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  from?: { kind: string; objectId?: string; fallback?: { x: number; y: number } };
  to?: { kind: string; objectId?: string; fallback?: { x: number; y: number } };
  fromPoint?: { x: number; y: number };
  toPoint?: { x: number; y: number };
}

function connectorSnap(id: string): ConnectorObjSnap {
  const o = hooks().getObjects().find((x) => x.id === id);
  if (o === undefined) throw new Error(`connector ${id} not found`);
  return o as unknown as ConnectorObjSnap;
}

function setCam(cam: { x: number; y: number; zoom: number }): void {
  act(() => {
    hooks().setCamera(cam);
  });
}

/** Dispatches a press+release on the given element at screen (x,y). */
function clickAt(el: Element, x: number, y: number): void {
  firePointer(el, 'pointerdown', x, y);
  firePointer(el, 'pointerup', x, y);
}

/** Clicks empty board space (the viewport background) to clear the selection. */
function clickBackground(x: number, y: number): void {
  const vp = document.querySelector('[data-testid="board-viewport"]');
  if (vp === null) throw new Error('board viewport not found');
  clickAt(vp, x, y);
}

describe('story 10: connector tool + objects (ui-component)', () => {
  it('TC-18: hovering a shape with the L tool shows four dots at the side midpoints', async () => {
    await renderFullApp();
    const A = makeShape({ x: 0, y: 0, width: 200, height: 200 });

    pressKey(window, 'l');
    const overlay = screen.getByTestId('connector-tool-overlay');

    // Hover the centre of A (screen 612,484).
    firePointer(overlay, 'pointermove', S(100, 100).x, S(100, 100).y);

    const dots = screen.getAllByTestId('connector-dot');
    expect(dots).toHaveLength(4);
    const sides = new Set(dots.map((d) => d.getAttribute('data-side')));
    expect(sides).toEqual(new Set(['top', 'right', 'bottom', 'left']));
    for (const d of dots) {
      expect(d.getAttribute('data-object-id')).toBe(A);
      expect(d.hasAttribute('data-highlighted')).toBe(false);
    }

    // Hovering empty space hides the dots.
    firePointer(overlay, 'pointermove', S(-400, 300).x, S(-400, 300).y);
    expect(screen.queryAllByTestId('connector-dot')).toHaveLength(0);
  });

  it('TC-19: dragging from A over B highlights B nearest dot; release creates the attached arrow', async () => {
    await renderFullApp();
    const A = makeShape({ x: 0, y: 0, width: 200, height: 200 });
    const B = makeShape({ x: 400, y: 0, width: 200, height: 200 });

    pressKey(window, 'l');
    const overlay = screen.getByTestId('connector-tool-overlay');

    // Press near A's right edge (world 188,100 -> right anchor 200,100).
    firePointer(overlay, 'pointerdown', S(188, 100).x, S(188, 100).y);
    expect(screen.getByTestId('connector-preview')).toBeTruthy();

    // Move over B's centre (world 500,100): B's LEFT dot (facing the start
    // point) is the highlighted one.
    firePointer(overlay, 'pointermove', S(500, 100).x, S(500, 100).y);
    const dots = screen.getAllByTestId('connector-dot');
    expect(dots).toHaveLength(4);
    for (const d of dots) {
      expect(d.getAttribute('data-object-id')).toBe(B);
    }
    const highlighted = dots.filter((d) => d.hasAttribute('data-highlighted'));
    expect(highlighted).toHaveLength(1);
    expect(highlighted[0].getAttribute('data-side')).toBe('left');

    // Release on B: an attached A->B connector is created and selected.
    firePointer(overlay, 'pointerup', S(500, 100).x, S(500, 100).y);

    const connectors = hooks().getObjects().filter((o) => o.type === 'connector');
    expect(connectors).toHaveLength(1);
    const snap = connectorSnap(connectors[0].id);
    expect(readConnector(hooks().getDoc(), snap.id)).not.toBeUndefined();
    const stored = readConnector(hooks().getDoc(), snap.id)!;
    expect(stored.from.kind).toBe('attached');
    if (stored.from.kind === 'attached') expect(stored.from.objectId).toBe(A);
    expect(stored.to.kind).toBe('attached');
    if (stored.to.kind === 'attached') expect(stored.to.objectId).toBe(B);
    // Fallbacks: the side anchors at creation time.
    if (stored.from.kind === 'attached') expect(stored.from.fallback).toEqual({ x: 200, y: 100 });
    if (stored.to.kind === 'attached') expect(stored.to.fallback).toEqual({ x: 400, y: 100 });
    // Resolved points match the anchors.
    expect(snap.fromPoint).toEqual({ x: 200, y: 100 });
    expect(snap.toPoint).toEqual({ x: 400, y: 100 });

    // Selected, and the tool returned to Select.
    expect(hooks().getSelection()).toEqual([snap.id]);
    expect(screen.queryByTestId('connector-tool-overlay')).toBeNull();
  });

  it('TC-20: a 5 px screen offset selects the arrow, 7 px does not, at 50% and 200% zoom', async () => {
    await renderFullApp();

    // A horizontal free connector from world (0,0) to (100,0).
    const id = makeConnector({ kind: 'free', x: 0, y: 0 }, { kind: 'free', x: 100, y: 0 });
    const hit = getObjectType('connector');
    if (hit === undefined) throw new Error('connector type not registered');
    const snapObj = hooks().getObjects().find((o) => o.id === id)!;

    for (const zoom of [0.5, 2]) {
      // Centre the line midpoint (world 50,0) at the screen centre (512,384).
      setCam({ x: 50 - 512 / zoom, y: 0 - 384 / zoom, zoom });

      // The registry hit test: screen px convert to world px by /zoom.
      const near: Point = { x: 50, y: 5 / zoom }; // 5 screen px below the line
      const far: Point = { x: 50, y: 7 / zoom }; // 7 screen px below the line
      expect(hit.hitTest(snapObj, near, zoom)).toBe(true);
      expect(hit.hitTest(snapObj, far, zoom)).toBe(false);

      // The rendered fat hit line is exactly 2 x tolerance screen px wide:
      // its world stroke width is 2 * tolerance / zoom.
      const hitLine = document.querySelector('[data-testid="connector-hit"]') as SVGLineElement;
      expect(hitLine).not.toBeNull();
      expect(Number(hitLine.getAttribute('stroke-width'))).toBeCloseTo(
        (2 * CONNECTOR_HIT_TOLERANCE_PX) / zoom,
        5,
      );

      // A click 5 screen px from the line lands on the fat line: selected.
      clickAt(hitLine, 512, 384 + 5);
      expect(hooks().getSelection()).toEqual([id]);

      // Clear, then a click 7 screen px from the line lands on the
      // background (outside the stroke): nothing is selected.
      clickBackground(100, 100);
      expect(hooks().getSelection()).toEqual([]);
      clickAt(vp(), 512, 384 + 7);
      expect(hooks().getSelection()).toEqual([]);
    }

    function vp(): Element {
      const el = document.querySelector('[data-testid="board-viewport"]');
      if (el === null) throw new Error('viewport missing');
      return el;
    }
  });

  it('TC-21: dragging a selected arrow end re-attaches onto C; onto empty space frees it', async () => {
    await renderFullApp();
    const A = makeShape({ x: 0, y: 0, width: 200, height: 200 });
    const B = makeShape({ x: 400, y: 0, width: 200, height: 200 });
    const C = makeShape({ x: 0, y: 400, width: 200, height: 200 });
    // A->B attached at the facing side anchors.
    const id = makeConnector(attached(A, { x: 200, y: 100 }), attached(B, { x: 400, y: 100 }));

    // Select the arrow by clicking its fat line (midpoint world 300,100).
    const hitLine = () => {
      const el = document.querySelector(`[data-testid="connector"][data-id="${id}"] [data-testid="connector-hit"]`);
      if (el === null) throw new Error('connector hit line not found');
      return el;
    };
    clickAt(hitLine(), S(300, 100).x, S(300, 100).y);
    expect(hooks().getSelection()).toEqual([id]);

    // The endpoint handles are visible when selected.
    const handleTo = () => {
      const el = document.querySelector(`[data-testid="connector"][data-id="${id}"] [data-testid="connector-handle-to"]`);
      if (el === null) throw new Error('to-handle not found');
      return el;
    };
    const handleFrom = () => {
      const el = document.querySelector(`[data-testid="connector"][data-id="${id}"] [data-testid="connector-handle-from"]`);
      if (el === null) throw new Error('from-handle not found');
      return el;
    };

    // Drag the `to` end onto C (world 100,500). C's facing side is its top
    // (toward A's anchor 200,100): fallback (100,400).
    firePointer(handleTo(), 'pointerdown', S(400, 100).x, S(400, 100).y);
    fireWindowPointer('pointermove', S(100, 500).x, S(100, 500).y);
    fireWindowPointer('pointerup', S(100, 500).x, S(100, 500).y);

    let stored = readConnector(hooks().getDoc(), id)!;
    expect(stored.to.kind).toBe('attached');
    if (stored.to.kind === 'attached') {
      expect(stored.to.objectId).toBe(C);
      expect(stored.to.fallback).toEqual({ x: 100, y: 400 });
    }

    // Drag the `from` end to empty space (world 900,700): it becomes free.
    firePointer(handleFrom(), 'pointerdown', S(200, 100).x, S(200, 100).y);
    fireWindowPointer('pointermove', S(900, 700).x, S(900, 700).y);
    fireWindowPointer('pointerup', S(900, 700).x, S(900, 700).y);

    stored = readConnector(hooks().getDoc(), id)!;
    expect(stored.from.kind).toBe('free');
    if (stored.from.kind === 'free') {
      expect(stored.from.x).toBe(900);
      expect(stored.from.y).toBe(700);
    }
    // The `to` end is still attached to C.
    expect(stored.to.kind).toBe('attached');
  });
});
