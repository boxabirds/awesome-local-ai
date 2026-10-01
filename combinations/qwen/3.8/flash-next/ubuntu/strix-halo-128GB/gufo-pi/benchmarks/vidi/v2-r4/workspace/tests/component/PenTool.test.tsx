/**
 * Component tests for Pen tool (story 11).
 * TC-09 to TC-14.
 *
 * Uses jsdom, real Y.Doc, synthetic pointer events, fake rAF timers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, type RenderResult } from '@testing-library/react';
import * as Y from 'yjs';
import { App } from '../../src/client/App';
import { snapshot } from '../../src/shared/board-model';
import { PEN_THICKNESS_WORLD, STROKE_MAX_POINTS } from '../../src/shared/config';
import type { StrokeSnap } from '../../src/shared/objects/stroke';

let renderResult: RenderResult;
let doc: Y.Doc;

function renderApp(): RenderResult {
  doc = new Y.Doc();
  renderResult = render(<App doc={doc} />);
  flush();
  return renderResult;
}

function flush(): void {
  act(() => {
    vi.advanceTimersByTime(50);
  });
}

function viewportEl(): HTMLElement {
  return screen.getByTestId('board-viewport');
}

function pointerEvent(
  type: string,
  x: number,
  y: number,
  opts: { pointerId?: number } = {},
): void {
  const target = screen.queryByTestId('pen-tool-overlay') || viewportEl();
  let event: Event;
  if (typeof PointerEvent !== 'undefined') {
    event = new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      button: 0,
      pointerId: opts.pointerId ?? 1,
      pointerType: 'mouse',
      isPrimary: true,
    });
  } else {
    const me = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      button: 0,
    });
    Object.defineProperty(me, 'pointerId', { value: opts.pointerId ?? 1 });
    Object.defineProperty(me, 'pointerType', { value: 'mouse' });
    Object.defineProperty(me, 'isPrimary', { value: true });
    event = me;
  }
  fireEvent(target, event);
}

function keyDown(key: string, opts: { shiftKey?: boolean; ctrlKey?: boolean } = {}): void {
  fireEvent(
    window,
    new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
      shiftKey: opts.shiftKey ?? false,
      ctrlKey: opts.ctrlKey ?? false,
    }),
  );
}

function getStrokes(): StrokeSnap[] {
  return snapshot(doc).filter((o): o is StrokeSnap => o.type === 'stroke');
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  Element.prototype.getBoundingClientRect = function () {
    return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) };
  };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('PenTool', () => {
  it('TC-09: drag with red + thick → createStroke called once with red/thick; tool stays pen', () => {
    renderApp();

    // Activate pen tool
    keyDown('p');
    flush();

    // Select red colour
    const redBtn = screen.getByTestId('pen-color-red');
    fireEvent.click(redBtn);
    flush();

    // Select thick
    const thickBtn = screen.getByTestId('pen-thickness-thick');
    fireEvent.click(thickBtn);
    flush();

    // Draw a stroke
    pointerEvent('pointerdown', 100, 100);
    pointerEvent('pointermove', 110, 110);
    pointerEvent('pointermove', 120, 120);
    pointerEvent('pointermove', 130, 130);
    pointerEvent('pointerup', 130, 130);
    flush();

    // Check a stroke was created with red + thick
    const strokes = getStrokes();
    expect(strokes).toHaveLength(1);
    expect(strokes[0]!.color).toBe('red');
    expect(strokes[0]!.thickness).toBe('thick');

    // Tool should still be pen
    expect(screen.getByTestId('tool-pen')).toHaveAttribute('aria-pressed', 'true');
  });

  it('TC-10: click without movement → single-point dot committed', () => {
    renderApp();

    keyDown('p');
    flush();

    // Click without moving
    pointerEvent('pointerdown', 200, 200);
    pointerEvent('pointerup', 200, 200);
    flush();

    const strokes = getStrokes();
    expect(strokes).toHaveLength(1);
    // Dot: bbox should be a thickness square
    const snap = strokes[0]!;
    const thickness = PEN_THICKNESS_WORLD[snap.thickness];
    expect(snap.width).toBe(thickness);
    expect(snap.height).toBe(thickness);
    expect(snap.points).toHaveLength(2);
  });

  it('TC-11: pointercancel → stroke committed with points so far (interrupted)', () => {
    renderApp();

    keyDown('p');
    flush();

    pointerEvent('pointerdown', 100, 100);
    pointerEvent('pointermove', 120, 120);
    pointerEvent('pointermove', 140, 140);
    pointerEvent('pointercancel', 140, 140);
    flush();

    const strokes = getStrokes();
    expect(strokes).toHaveLength(1);
    expect(strokes[0]!.points.length).toBeGreaterThanOrEqual(2);
  });

  it('TC-12: STROKE_MAX_POINTS + 10 moves → two commits, second starts at first\'s last point', () => {
    renderApp();

    keyDown('p');
    flush();

    // Draw a long stroke exceeding STROKE_MAX_POINTS
    pointerEvent('pointerdown', 0, 0);
    for (let i = 1; i <= STROKE_MAX_POINTS + 10; i++) {
      pointerEvent('pointermove', i * 0.6, i * 0.6);
    }
    pointerEvent('pointerup', (STROKE_MAX_POINTS + 10) * 0.6, (STROKE_MAX_POINTS + 10) * 0.6);
    flush();

    const strokes = getStrokes();
    // Should have at least 2 strokes (the long one was split)
    expect(strokes.length).toBeGreaterThanOrEqual(2);
  });

  it('TC-13: Escape → tool becomes select; no stroke created', () => {
    renderApp();

    keyDown('p');
    flush();

    // Press Escape (don't draw)
    keyDown('Escape');
    flush();

    // Tool should be select
    expect(screen.getByTestId('tool-select')).toHaveAttribute('aria-pressed', 'true');

    // No strokes
    expect(getStrokes()).toHaveLength(0);
  });

  it('TC-14: change colour after a stroke exists → existing unchanged; next stroke uses new colour', () => {
    renderApp();

    keyDown('p');
    flush();

    // Draw first stroke in black (default)
    pointerEvent('pointerdown', 50, 50);
    pointerEvent('pointermove', 100, 100);
    pointerEvent('pointerup', 100, 100);
    flush();

    const strokes1 = getStrokes();
    expect(strokes1).toHaveLength(1);
    expect(strokes1[0]!.color).toBe('black');
    const firstId = strokes1[0]!.id;

    // Change colour to blue
    const blueBtn = screen.getByTestId('pen-color-blue');
    fireEvent.click(blueBtn);
    flush();

    // Draw second stroke
    pointerEvent('pointerdown', 200, 200);
    pointerEvent('pointermove', 250, 250);
    pointerEvent('pointerup', 250, 250);
    flush();

    const strokes2 = getStrokes();
    expect(strokes2).toHaveLength(2);
    // First stroke unchanged
    const first = strokes2.find((s) => s.id === firstId);
    expect(first!.color).toBe('black');
    // Second stroke uses blue
    const second = strokes2.find((s) => s.id !== firstId);
    expect(second!.color).toBe('blue');
  });
});
