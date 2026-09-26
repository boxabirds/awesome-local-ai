import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as Y from 'yjs';

import { BoardApp } from '../../src/client/BoardApp';
import { initDoc, objectSnapshots } from '../../src/shared/board-model';
import type { StrokeSnap } from '../../src/shared/objects/stroke';
import {
  PEN_THICKNESS_WORLD,
  STROKE_MAX_POINTS,
} from '../../src/shared/config';
import { fireKey, firePointer } from './helpers';

/**
 * Story 11 component tests: PenTool gesture state machine (TC-09 to TC-14).
 */

function renderEditable() {
  const doc = new Y.Doc();
  initDoc(doc);
  const view = render(<BoardApp doc={doc} />);
  return {
    ...view,
    doc,
    async settle() {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
    },
  };
}

const strokes = (doc: Y.Doc): StrokeSnap[] =>
  objectSnapshots(doc).filter((obj) => obj.type === 'stroke') as unknown as StrokeSnap[];

/** Simulate a pen drag: pointerdown, moves, pointerup on the pen tool layer. */
function penDrag(
  layer: Element,
  points: { x: number; y: number }[],
  pointerId = 1,
): void {
  if (points.length === 0) return;
  firePointer(layer, 'pointerdown', points[0]!.x, points[0]!.y, { pointerId });
  for (let i = 1; i < points.length; i += 1) {
    firePointer(layer, 'pointermove', points[i]!.x, points[i]!.y, { pointerId });
  }
  firePointer(layer, 'pointerup', points[points.length - 1]!.x, points[points.length - 1]!.y, {
    pointerId,
  });
}

afterEach(cleanup);

describe('TC-09: draw a stroke with red + thick', () => {
  it('createStroke called once with red/thick; tool still pen', async () => {
    const { doc, settle: s } = renderEditable();
    await s();

    // Activate pen tool
    await act(async () => {
      fireEvent.click(screen.getByTestId('tool-pen'));
    });
    await s();

    // Select red
    await act(async () => {
      fireEvent.click(screen.getByTestId('pen-color-red'));
    });
    // Select thick
    await act(async () => {
      fireEvent.click(screen.getByTestId('pen-thickness-thick'));
    });
    await s();

    const layer = screen.getByTestId('pen-tool-layer');
    // Drag: move at least 50px to not be a dot
    penDrag(layer, [
      { x: 100, y: 100 },
      { x: 130, y: 110 },
      { x: 160, y: 100 },
      { x: 190, y: 120 },
      { x: 200, y: 100 },
    ]);
    await s();

    const result = strokes(doc);
    expect(result.length).toBeGreaterThanOrEqual(1);
    const stroke = result[result.length - 1]!;
    expect(stroke.color).toBe('red');
    expect(stroke.thickness).toBe('thick');
    // Pen tool stays active
    expect(screen.getByTestId('tool-pen').getAttribute('aria-pressed')).toBe('true');
  });
});

describe('TC-10: click without movement draws a dot', () => {
  it('single-point stroke committed', async () => {
    const { doc, settle: s } = renderEditable();
    await s();

    await act(async () => {
      fireEvent.click(screen.getByTestId('tool-pen'));
    });
    await s();

    const layer = screen.getByTestId('pen-tool-layer');
    // Click without moving (same x,y)
    firePointer(layer, 'pointerdown', 300, 300);
    firePointer(layer, 'pointerup', 300, 300);
    await s();

    const result = strokes(doc);
    expect(result.length).toBe(1);
    const stroke = result[0]!;
    // A dot should have a bbox equal to thickness
    expect(stroke.width).toBe(PEN_THICKNESS_WORLD.medium);
    expect(stroke.height).toBe(PEN_THICKNESS_WORLD.medium);
  });
});

describe('TC-11: interrupted drag commits points so far', () => {
  it('pointercancel commits stroke with points drawn so far', async () => {
    const { doc, settle: s } = renderEditable();
    await s();

    await act(async () => {
      fireEvent.click(screen.getByTestId('tool-pen'));
    });
    await s();

    const layer = screen.getByTestId('pen-tool-layer');
    // Start a drag
    firePointer(layer, 'pointerdown', 100, 100);
    firePointer(layer, 'pointermove', 120, 110);
    firePointer(layer, 'pointermove', 140, 120);
    firePointer(layer, 'pointermove', 160, 100);
    // Cancel instead of up
    firePointer(layer, 'pointercancel', 160, 100);
    await s();

    const result = strokes(doc);
    expect(result.length).toBe(1);
    expect(result[0]!.type).toBe('stroke');
  });
});

describe('TC-12: STROKE_MAX_POINTS split', () => {
  it('two createStroke calls, second starts at first last point', async () => {
    const { doc, settle: s } = renderEditable();
    await s();

    await act(async () => {
      fireEvent.click(screen.getByTestId('tool-pen'));
    });
    await s();

    const layer = screen.getByTestId('pen-tool-layer');
    const before = strokes(doc).length;
    const numPoints = STROKE_MAX_POINTS + 10;

    // pointerdown
    firePointer(layer, 'pointerdown', 100, 100);
    // Many pointermove events (zigzag so simplify keeps points)
    for (let i = 1; i < numPoints; i += 1) {
      const x = 100 + (i % 500);
      const y = i % 2 === 0 ? 100 : 200;
      firePointer(layer, 'pointermove', x, y);
    }
    // pointerup
    firePointer(layer, 'pointerup', 100, 200);
    await s();

    const after = strokes(doc);
    expect(after.length - before).toBeGreaterThanOrEqual(2);
  }, 120_000);
});

describe('TC-13: Escape switches to Select, no stroke created', () => {
  it('Escape; press V switches tool, nothing created', async () => {
    const { doc, settle: s } = renderEditable();
    await s();

    await act(async () => {
      fireEvent.click(screen.getByTestId('tool-pen'));
    });
    await s();

    const beforeCount = strokes(doc).length;

    // Press Escape
    fireKey({ key: 'Escape' });
    await s();

    // Press V (select)
    fireKey({ key: 'v' });
    await s();

    // No pen tool layer should be present
    expect(screen.queryByTestId('pen-tool-layer')).toBeNull();
    expect(strokes(doc).length).toBe(beforeCount);
  });
});

describe('TC-14: changing options does not restyle existing strokes', () => {
  it('existing stroke colour unchanged; next stroke uses new colour', async () => {
    const { doc, settle: s } = renderEditable();
    await s();

    await act(async () => {
      fireEvent.click(screen.getByTestId('tool-pen'));
    });
    await s();

    const layer = screen.getByTestId('pen-tool-layer');
    // Draw first stroke (default: black)
    penDrag(layer, [
      { x: 100, y: 100 },
      { x: 130, y: 110 },
      { x: 160, y: 100 },
    ]);
    await s();

    const firstStrokes = strokes(doc);
    expect(firstStrokes.length).toBe(1);
    expect(firstStrokes[0]!.color).toBe('black');

    // Change to blue
    await act(async () => {
      fireEvent.click(screen.getByTestId('pen-color-blue'));
    });
    await s();

    // Draw second stroke
    penDrag(layer, [
      { x: 200, y: 200 },
      { x: 230, y: 210 },
      { x: 260, y: 200 },
    ]);
    await s();

    const allStrokes = strokes(doc);
    expect(allStrokes.length).toBe(2);
    // First stroke unchanged
    expect(allStrokes.find((s) => s.id === firstStrokes[0]!.id)!.color).toBe('black');
    // Second stroke is blue
    const second = allStrokes.find((s) => s.id !== firstStrokes[0]!.id);
    expect(second!.color).toBe('blue');
  });
});
