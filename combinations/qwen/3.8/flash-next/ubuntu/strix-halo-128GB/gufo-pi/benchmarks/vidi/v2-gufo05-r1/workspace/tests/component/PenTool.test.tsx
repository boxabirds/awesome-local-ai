// Story 11 · Sketch freehand with a pen — component tests.
//
// The Pen tool is mounted on its own, with the same camera and document the board gives it, so
// a test can watch one gesture produce exactly one stroke without a browser. The camera is at
// (0, 0, zoom 1), so a screen point is a world point too. jsdom fires one pointer event per
// dispatch with no coalescing, which is a valid — coarse — sampling of the pen, and it lets a
// test say exactly how many points a path has.
//
// Animation frames are stubbed to a no-op here: the in-air preview is checked in the browser
// suite, and the committed stroke does not depend on a frame — it is written on release.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import * as Y from 'yjs';

import { PenTool } from '../../src/client/tools/PenTool';
import { initDoc, objectSnapshots } from '../../src/shared/board-model';
import { STROKE_MAX_POINTS } from '../../src/shared/config';
import { worldPoints, type StrokeSnap } from '../../src/shared/objects/stroke';
import type { Camera } from '../../src/client/canvas/camera';

const CAMERA: Camera = { x: 0, y: 0, zoom: 1 };
const IDENTITY = 'me';

beforeAll(() => {
  // The preview frame is not what these tests check; keep state updates synchronous.
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterAll(() => {
  vi.unstubAllGlobals();
});

function strokes(doc: Y.Doc): StrokeSnap[] {
  return objectSnapshots(doc).filter((s): s is StrokeSnap => s.type === 'stroke');
}

interface Draw {
  down(x: number, y: number): void;
  moveTo(x: number, y: number): void;
  up(x: number, y: number): void;
  lostCapture(): void;
  cancel(): void;
}

function penTool(): HTMLElement {
  return screen.getByTestId('pen-tool');
}

function pointer(el: HTMLElement, type: string, x?: number, y?: number, extra: object = {}): void {
  fireEvent(
    el,
    new window.PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      isPrimary: true,
      pointerType: 'mouse',
      button: type === 'pointerup' || type === 'pointerdown' ? 0 : -1,
      clientX: x,
      clientY: y,
      ...extra,
    }),
  );
}

function gesture(): Draw {
  const el = penTool();
  return {
    down: (x, y) => act(() => pointer(el, 'pointerdown', x, y)),
    moveTo: (x, y) => act(() => pointer(el, 'pointermove', x, y)),
    up: (x, y) => act(() => pointer(el, 'pointerup', x, y, { button: 0 })),
    lostCapture: () => act(() => pointer(el, 'lostpointercapture')),
    cancel: () => act(() => pointer(el, 'pointercancel')),
  };
}

function renderPen(doc: Y.Doc, boundary = vi.fn()) {
  render(
    <PenTool
      camera={CAMERA}
      color="blue"
      thickness="medium"
      doc={doc}
      identityId={IDENTITY}
      onCommitBoundary={boundary}
    />,
  );
  return boundary;
}

describe('PenTool (story 11)', () => {
  it('draws a polyline into the document and leaves the Pen still armed', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const boundary = renderPen(doc);

    const g = gesture();
    g.down(10, 10);
    g.moveTo(40, 20);
    g.moveTo(70, 12);
    g.up(70, 12);

    const made = strokes(doc);
    expect(made).toHaveLength(1);
    expect(made[0]!.points.length).toBeGreaterThanOrEqual(6); // 3 points, flattened
    expect(made[0]!.createdBy).toBe(IDENTITY);
    // A stroke is its own undo step, bounded on both sides (`pen.tool_ui`).
    expect(boundary).toHaveBeenCalledTimes(2);

    // The Pen does not return to Select: a second line draws immediately after the first.
    g.down(100, 100);
    g.moveTo(140, 140);
    g.up(140, 140);
    expect(strokes(doc)).toHaveLength(2);
  });

  it('leaves a dot when the pen is pressed without a real movement', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    renderPen(doc);

    const g = gesture();
    g.down(300, 250);
    g.moveTo(301, 250); // 1 screen pixel: under the threshold, so no stroke
    g.up(301, 250);

    const made = strokes(doc);
    expect(made).toHaveLength(1);
    expect(made[0]!.points).toHaveLength(2); // one flattened point
    expect(worldPoints(made[0]!)).toEqual([{ x: 300, y: 250 }]);
    // baseWidth/baseHeight of 0 keeps the box on the point.
    // A single point has no span, so the box is held at the smallest size an object may take.
    expect(made[0]!.width).toBeGreaterThanOrEqual(0);
    expect(made[0]!.width).toBeLessThanOrEqual(4);
    expect(made[0]!.height).toBeLessThanOrEqual(4);
  });

  it('keeps the stroke drawn so far when the gesture is cancelled mid-draw', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    renderPen(doc);

    const g = gesture();
    g.down(10, 10);
    g.moveTo(30, 30);
    g.moveTo(60, 10);
    g.cancel(); // pointercancel before pointerup: keep the points drawn so far

    const made = strokes(doc);
    expect(made).toHaveLength(1);
    expect(made[0]!.points.length).toBeGreaterThanOrEqual(6); // the points to hand are kept
  });

  it('starts a new stroke automatically when a path reaches the maximum', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    renderPen(doc);

    const g = gesture();
    g.down(0, 0);
    // Enough moves that the live path runs past the maximum: 5100 moves.
    for (let i = 1; i <= STROKE_MAX_POINTS + 100; i += 1) g.moveTo(i, i % 5);
    g.up(STROKE_MAX_POINTS + 100, 0);

    const made = strokes(doc);
    // The path was split into at least two strokes, each at or under the maximum.
    expect(made.length).toBeGreaterThanOrEqual(2);
    for (const s of made) {
      expect(s.points.length / 2).toBeLessThanOrEqual(STROKE_MAX_POINTS);
    }
  });

  it('stores the colour and thickness chosen on the panel', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    render(
      <PenTool
        camera={CAMERA}
        color="purple"
        thickness="thick"
        doc={doc}
        identityId={IDENTITY}
      />,
    );

    const g = gesture();
    g.down(50, 50);
    g.moveTo(120, 90);
    g.up(120, 90);

    const made = strokes(doc);
    expect(made[0]!.color).toBe('purple');
    expect(made[0]!.thickness).toBe('thick');
  });
});
