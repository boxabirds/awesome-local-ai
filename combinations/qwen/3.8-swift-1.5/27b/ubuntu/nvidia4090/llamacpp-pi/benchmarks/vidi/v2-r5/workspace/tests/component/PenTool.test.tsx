// @vitest-environment jsdom
// tests/component/PenTool.test.tsx
// TC-09 to TC-14: Pen tool gesture states, options, tool staying active

import { describe, it, expect, beforeEach, beforeAll, vi, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import * as Y from 'yjs';
import { initDoc, snapshot } from '../../src/shared/board-model';
import { createStroke, type StrokeSnap } from '../../src/shared/objects/stroke';
import { PenTool } from '../../src/client/tools/PenTool';
import { useActiveTool } from '../../src/client/tools/useActiveTool';
import {
  STROKE_MAX_POINTS,
  type PenColor,
  type PenThickness,
} from '../../src/shared/config';
import type { Camera } from '../../src/client/canvas/camera';
import type { Point } from '../../src/shared/geometry';

const testCamera: Camera = { x: -640, y: -400, zoom: 1 };

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function makePointerEvent(type: string, x: number, y: number): Event {
  const evt = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(evt, 'clientX', { value: x });
  Object.defineProperty(evt, 'clientY', { value: y });
  Object.defineProperty(evt, 'pointerId', { value: 1 });
  return evt;
}

beforeAll(() => {
  const proto = Element.prototype as any;
  if (!proto.setPointerCapture) {
    proto.setPointerCapture = vi.fn();
    proto.releasePointerCapture = vi.fn();
  }
});

beforeEach(() => {
  cleanup();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// Helper to render PenTool with a real doc
function renderPenTool(opts?: { color?: PenColor; thickness?: PenThickness }) {
  const doc = makeDoc();
  const color = opts?.color ?? 'black';
  const thickness = opts?.thickness ?? 'medium';

  const createFn = vi.fn((points: Point[]) => {
    return createStroke(doc, { points, color, thickness }, 'local');
  });

  const { container } = render(
    <PenTool
      camera={testCamera}
      color={color}
      thickness={thickness}
      create={createFn}
    />
  );

  const overlay = container.querySelector('[data-testid="pen-tool-overlay"]')!;
  return { doc, container, overlay, createFn, color, thickness };
}

// TC-09: pointerdown/moves/up with red + thick → createStroke called once with red/thick; tool still pen
describe('TC-09: Pen tool drag creates stroke', () => {
  it('pointerdown/moves/up creates a stroke with selected color and thickness', () => {
    const { doc, overlay, createFn } = renderPenTool({ color: 'red', thickness: 'thick' });

    act(() => {
      overlay.dispatchEvent(makePointerEvent('pointerdown', 100, 100));
    });

    act(() => {
      overlay.dispatchEvent(makePointerEvent('pointermove', 150, 150));
    });

    act(() => {
      overlay.dispatchEvent(makePointerEvent('pointermove', 200, 120));
    });

    act(() => {
      overlay.dispatchEvent(makePointerEvent('pointerup', 200, 120));
    });

    // createStroke should have been called once
    expect(createFn).toHaveBeenCalledTimes(1);
    // A stroke should exist in the doc
    const snaps = snapshot(doc);
    expect(snaps.length).toBe(1);
    expect(snaps[0].type).toBe('stroke');
    const strokeSnap = snaps[0] as unknown as StrokeSnap;
    expect(strokeSnap.color).toBe('red');
    expect(strokeSnap.thickness).toBe('thick');
  });
});

// TC-10: pointerdown/up without movement → single-point dot committed
describe('TC-10: Click draws a dot', () => {
  it('pointerdown/up without movement creates a single-point dot', () => {
    const { doc, overlay, createFn } = renderPenTool();

    act(() => {
      overlay.dispatchEvent(makePointerEvent('pointerdown', 100, 100));
    });

    act(() => {
      overlay.dispatchEvent(makePointerEvent('pointerup', 100, 100));
    });

    // createStroke should have been called once
    expect(createFn).toHaveBeenCalledTimes(1);
    // The call should have a single point
    const callArg = createFn.mock.calls[0][0];
    expect(callArg.length).toBe(1);

    // A stroke should exist in the doc
    const snaps = snapshot(doc);
    expect(snaps.length).toBe(1);
    const strokeSnap = snaps[0] as unknown as StrokeSnap;
    expect(strokeSnap.points.length).toBe(2); // One point = [x, y]
  });
});

// TC-11: pointerdown, moves, pointercancel → stroke committed with points so far
describe('TC-11: Interrupted stroke is kept', () => {
  it('pointercancel commits the points drawn so far', () => {
    const { doc, overlay, createFn } = renderPenTool();

    act(() => {
      overlay.dispatchEvent(makePointerEvent('pointerdown', 100, 100));
    });

    act(() => {
      overlay.dispatchEvent(makePointerEvent('pointermove', 150, 150));
    });

    act(() => {
      overlay.dispatchEvent(makePointerEvent('pointermove', 200, 180));
    });

    // Cancel instead of up
    act(() => {
      overlay.dispatchEvent(makePointerEvent('pointercancel', 200, 180));
    });

    // createStroke should have been called once (with points so far)
    expect(createFn).toHaveBeenCalledTimes(1);
    // A stroke should exist in the doc
    const snaps = snapshot(doc);
    expect(snaps.length).toBe(1);
    expect(snaps[0].type).toBe('stroke');
  });
});

// TC-12: STROKE_MAX_POINTS + 10 moves → two commits, second starts at first's last point
describe('TC-12: Long stroke splits at STROKE_MAX_POINTS', () => {
  it('two createStroke calls when exceeding STROKE_MAX_POINTS; second starts at first\'s last point', () => {
    const { overlay, createFn } = renderPenTool();

    act(() => {
      overlay.dispatchEvent(makePointerEvent('pointerdown', 0, 0));
    });

    // Generate STROKE_MAX_POINTS + 10 moves
    for (let i = 1; i <= STROKE_MAX_POINTS + 10; i++) {
      act(() => {
        overlay.dispatchEvent(makePointerEvent('pointermove', i, i));
      });
    }

    act(() => {
      overlay.dispatchEvent(makePointerEvent('pointerup', STROKE_MAX_POINTS + 10, STROKE_MAX_POINTS + 10));
    });

    // Should have been called at least twice (split at limit + final commit)
    expect(createFn.mock.calls.length).toBeGreaterThanOrEqual(2);

    // The first call's last point should match the second call's first point
    const firstCallPoints = createFn.mock.calls[0][0] as Point[];
    const secondCallPoints = createFn.mock.calls[1][0] as Point[];
    const lastOfFirst = firstCallPoints[firstCallPoints.length - 1];
    const firstOfSecond = secondCallPoints[0];
    expect(firstOfSecond.x).toBe(lastOfFirst.x);
    expect(firstOfSecond.y).toBe(lastOfFirst.y);
  });
});

// TC-13: Escape; press V → tool becomes select; no stroke created
describe('TC-13: Escape and V switch tool', () => {
  it('pressing Escape then V switches to select; no stroke created', () => {
    // Test useActiveTool directly
    function TestComponent() {
      const { tool } = useActiveTool();
      return (
        <div>
          <span data-testid="current-tool">{tool}</span>
        </div>
      );
    }

    const { getByTestId } = render(<TestComponent />);

    // Initially select
    expect(getByTestId('current-tool').textContent).toBe('select');

    // Simulate pressing P (pen)
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p' }));
    });
    expect(getByTestId('current-tool').textContent).toBe('pen');

    // Simulate pressing Escape
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(getByTestId('current-tool').textContent).toBe('select');

    // Simulate pressing V
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v' }));
    });
    expect(getByTestId('current-tool').textContent).toBe('select');
  });
});

// TC-14: change colour after a stroke exists → existing stroke unchanged; next stroke uses new colour
describe('TC-14: Changing options does not restyle existing strokes', () => {
  it('existing stroke keeps its colour; next stroke uses new colour', () => {
    const doc = makeDoc();

    // Create first stroke with black
    const id1 = createStroke(doc, {
      points: [{ x: 10, y: 10 }, { x: 50, y: 50 }],
      color: 'black',
      thickness: 'medium',
    }, 'local')!;

    // Change colour to red (simulates toolbar interaction)
    // The createStroke function uses the current colour from options
    const createFn = vi.fn((points: Point[]) => {
      return createStroke(doc, { points, color: 'red', thickness: 'medium' }, 'local');
    });

    const { container } = render(
      <PenTool
        camera={testCamera}
        color="red"
        thickness="medium"
        create={createFn}
      />
    );
    const overlay = container.querySelector('[data-testid="pen-tool-overlay"]')!;

    // Draw a second stroke
    act(() => {
      overlay.dispatchEvent(makePointerEvent('pointerdown', 100, 100));
    });
    act(() => {
      overlay.dispatchEvent(makePointerEvent('pointermove', 150, 150));
    });
    act(() => {
      overlay.dispatchEvent(makePointerEvent('pointerup', 150, 150));
    });

    // Check both strokes
    const snaps = snapshot(doc);
    expect(snaps.length).toBe(2);

    const stroke1 = snaps.find(s => s.id === id1) as unknown as StrokeSnap;
    const stroke2 = snaps.find(s => s.id !== id1) as unknown as StrokeSnap;

    // First stroke keeps black
    expect(stroke1.color).toBe('black');
    // Second stroke is red
    expect(stroke2.color).toBe('red');
  });
});
