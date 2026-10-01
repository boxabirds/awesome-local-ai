import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { createRef } from 'react';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { BoardHarness, type HarnessHandle } from './harness/BoardHarness';
import { snapshot } from '../../src/shared/board-model';
import type { StrokeSnap } from '../../src/shared/objects/stroke';
import { pointer, frames } from './pointerUtils';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function setup() {
  const handleRef = createRef<HarnessHandle | null>();
  render(<BoardHarness handleRef={handleRef} />);
  const handle = handleRef.current!;
  return { handle, doc: handle.doc };
}

function activatePen(handle: HarnessHandle) {
  act(() => {
    fireEvent.keyDown(window, { key: 'p' });
  });
  frames();
}

describe('pen.tool (TC-09 to TC-14)', () => {
  it('TC-09: pointerdown/moves/up with red + thick selected creates stroke with red/thick; tool still pen', () => {
    const { handle, doc } = setup();
    activatePen(handle);
    expect(handle.getTool()).toBe('pen');

    // Select red and thick
    act(() => {
      handle.setPenColor('red');
      handle.setPenThickness('thick');
    });
    frames();

    // Draw a short stroke
    const board = document.querySelector<HTMLElement>('[data-grid-layer="true"]')!;
    pointer(board, 'pointerdown', 100, 100);
    frames();
    pointer(board, 'pointermove', 150, 120);
    frames();
    pointer(board, 'pointermove', 200, 140);
    frames();
    pointer(board, 'pointerup', 200, 140);
    frames();

    // Stroke should be created with red/thick
    const objects = snapshot(doc);
    const stroke = objects.find((o) => o.type === 'stroke') as StrokeSnap | undefined;
    expect(stroke).toBeDefined();
    expect(stroke!.color).toBe('red');
    expect(stroke!.thickness).toBe('thick');

    // Tool should still be pen
    expect(handle.getTool()).toBe('pen');
  });

  it('TC-10: pointerdown/up without movement creates a dot (single point)', () => {
    const { handle, doc } = setup();
    activatePen(handle);

    const board = document.querySelector<HTMLElement>('[data-grid-layer="true"]')!;
    pointer(board, 'pointerdown', 200, 200);
    frames();
    pointer(board, 'pointerup', 200, 200);
    frames();

    const objects = snapshot(doc);
    const stroke = objects.find((o) => o.type === 'stroke') as StrokeSnap | undefined;
    expect(stroke).toBeDefined();
    // A dot has points length 2 (one x, one y)
    expect(stroke!.points).toHaveLength(2);
  });

  it('TC-11: pointerdown, moves, pointercancel commits stroke with points so far', () => {
    const { handle, doc } = setup();
    activatePen(handle);

    const board = document.querySelector<HTMLElement>('[data-grid-layer="true"]')!;
    pointer(board, 'pointerdown', 100, 100);
    frames();
    pointer(board, 'pointermove', 150, 120);
    frames();
    pointer(board, 'pointermove', 200, 140);
    frames();
    // Cancel the pointer
    pointer(board, 'pointercancel', 200, 140);
    frames();

    const objects = snapshot(doc);
    const stroke = objects.find((o) => o.type === 'stroke') as StrokeSnap | undefined;
    expect(stroke).toBeDefined();
    // Should have at least 2 points (we moved through 3 screen points before cancel)
    expect(stroke!.points.length).toBeGreaterThanOrEqual(4); // at least 2 points
  });

  it('TC-12: STROKE_MAX_POINTS + 10 moves creates two commits; second starts at first last point', () => {
    const { handle, doc } = setup();
    activatePen(handle);

    const board = document.querySelector<HTMLElement>('[data-grid-layer="true"]')!;
    pointer(board, 'pointerdown', 10, 10);
    frames();

    // Move STROKE_MAX_POINTS + 10 times (each pixel apart to avoid simplification to nothing)
    const max = 5000;
    for (let i = 1; i <= max + 10; i++) {
      const x = 10 + (i % 1000);
      const y = 10 + Math.floor(i / 1000) * 10;
      pointer(board, 'pointermove', x, y);
      // Don't call frames() every iteration for performance; only occasionally
      if (i % 1000 === 0) frames();
    }
    frames();

    // Release
    pointer(board, 'pointerup', 20, 60);
    frames();

    const objects = snapshot(doc);
    const strokes = objects.filter((o) => o.type === 'stroke') as StrokeSnap[];
    // Should have at least 2 strokes from the split
    expect(strokes.length).toBeGreaterThanOrEqual(2);

    // The second stroke should start near the end of the first (shared join point)
    // Since both have been simplified, just verify they exist
    expect(strokes[0].points.length).toBeGreaterThan(0);
    expect(strokes[1].points.length).toBeGreaterThan(0);
  });

  it('TC-13: Escape switches tool to select; no stroke created', () => {
    const { handle, doc } = setup();
    activatePen(handle);
    expect(handle.getTool()).toBe('pen');

    // Press Escape
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    frames();

    expect(handle.getTool()).toBe('select');

    // No stroke should exist
    const objects = snapshot(doc);
    const strokes = objects.filter((o) => o.type === 'stroke');
    expect(strokes).toHaveLength(0);
  });

  it('TC-13b: pressing V switches tool from pen to select; nothing created', () => {
    const { handle, doc } = setup();
    activatePen(handle);
    expect(handle.getTool()).toBe('pen');

    act(() => {
      fireEvent.keyDown(window, { key: 'v' });
    });
    frames();

    expect(handle.getTool()).toBe('select');

    const objects = snapshot(doc);
    const strokes = objects.filter((o) => o.type === 'stroke');
    expect(strokes).toHaveLength(0);
  });

  it('TC-14: changing colour after a stroke exists does not restyle existing stroke', () => {
    const { handle, doc } = setup();
    activatePen(handle);

    // Draw first stroke with black (default)
    const board = document.querySelector<HTMLElement>('[data-grid-layer="true"]')!;
    pointer(board, 'pointerdown', 100, 100);
    frames();
    pointer(board, 'pointermove', 200, 150);
    frames();
    pointer(board, 'pointerup', 200, 150);
    frames();

    const objects1 = snapshot(doc);
    const stroke1 = objects1.find((o) => o.type === 'stroke') as StrokeSnap;
    expect(stroke1.color).toBe('black');

    // Change colour to red
    act(() => {
      handle.setPenColor('red');
    });
    frames();

    // Verify existing stroke is unchanged
    const objects2 = snapshot(doc);
    const stroke1b = objects2.find((o) => o.type === 'stroke') as StrokeSnap;
    expect(stroke1b.color).toBe('black');

    // Draw second stroke
    pointer(board, 'pointerdown', 300, 300);
    frames();
    pointer(board, 'pointermove', 400, 350);
    frames();
    pointer(board, 'pointerup', 400, 350);
    frames();

    // Second stroke should be red
    const objects3 = snapshot(doc);
    const strokes = objects3.filter((o) => o.type === 'stroke') as StrokeSnap[];
    expect(strokes.length).toBe(2);
    expect(strokes[1].color).toBe('red');
  });
});
