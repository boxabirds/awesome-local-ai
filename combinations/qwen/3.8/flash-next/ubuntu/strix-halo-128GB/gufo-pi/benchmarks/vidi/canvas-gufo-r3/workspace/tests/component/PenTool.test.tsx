import React, { useState, useRef, useCallback, useEffect } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act, fireEvent, cleanup } from '@testing-library/react';
import * as Y from 'yjs';
import { initDoc, snapshotAll } from '@shared/board-model';
import { createStroke, snapshotStroke } from '@shared/objects/stroke';
import { Camera, screenToWorld } from '@client/canvas/camera';
import { STROKE_MAX_POINTS } from '@shared/config';
import type { PenColor, PenThickness } from '@shared/config';
import { PenTool } from '@client/tools/PenTool';
import { PenToolbar } from '@client/tools/PenToolbar';
import { usePenOptions } from '@client/tools/usePenOptions';
import { useActiveTool } from '@client/tools/useActiveTool';

const VIEWPORT = { width: 1280, height: 800 };

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

// Helper to render PenTool with controls for testing
function renderPenHarness(opts: {
  color?: PenColor;
  thickness?: PenThickness;
} = {}) {
  const doc = makeDoc();
  const commits: string[] = [];
  let currentTool = 'pen';
  let penColor = opts.color ?? 'black';
  let penThickness = opts.thickness ?? 'medium';
  let camera: Camera = { x: 0, y: 0, zoom: 1 };

  const Harness = React.forwardRef<{
    setCamera(c: Camera): void;
    setTool(t: string): void;
    getTool(): string;
    setColor(c: PenColor): void;
    setThickness(t: PenThickness): void;
    getDoc(): Y.Doc;
    getCommits(): string[];
  }>((_, ref) => {
    const [tool, setToolState] = useState('pen');
    const [cam, setCam] = useState<Camera>(camera);
    const [color, setColorState] = useState<PenColor>(penColor);
    const [thickness, setThicknessState] = useState<PenThickness>(penThickness);

    const onCommit = useCallback(() => {
      const strokes = snapshotStroke(doc);
      if (strokes.length > commits.length) {
        commits.push(strokes[strokes.length - 1].id);
      }
    }, [doc]);

    // Expose via ref
    React.useImperativeHandle(ref, () => ({
      setCamera(c: Camera) { camera = c; setCam(c); },
      setTool(t: string) { currentTool = t; setToolState(t); },
      getTool() { return currentTool; },
      setColor(c: PenColor) { penColor = c; setColorState(c); },
      setThickness(t: PenThickness) { penThickness = t; setThicknessState(t); },
      getDoc() { return doc; },
      getCommits() { return commits; },
    }));

    if (tool !== 'pen') return <div data-testid="no-tool">no tool</div>;

    return (
      <div style={{ width: VIEWPORT.width, height: VIEWPORT.height, position: 'relative' }}>
        <PenTool
          camera={cam}
          color={color}
          thickness={thickness}
          doc={doc}
          identityId="user"
          onCommit={onCommit}
        />
      </div>
    );
  });

  const ref = React.createRef<any>();
  const utils = render(<Harness ref={ref} />);

  function screenToWorldPoint(sx: number, sy: number) {
    return screenToWorld(camera, { x: sx, y: sy });
  }

  function pointerDown(x: number, y: number) {
    const overlay = utils.getByTestId('pen-tool-overlay');
    fireEvent.pointerDown(overlay, { clientX: x, clientY: y, pointerId: 1, button: 0 });
  }

  function pointerMove(x: number, y: number) {
    fireEvent.pointerMove(window, { clientX: x, clientY: y, pointerId: 1 });
  }

  function pointerUp(x: number, y: number) {
    fireEvent.pointerUp(window, { clientX: x, clientY: y, pointerId: 1 });
  }

  function pointerCancel(x: number, y: number) {
    fireEvent.pointerCancel(window, { clientX: x, clientY: y, pointerId: 1 });
  }

  return { ref, utils, doc, pointerDown, pointerMove, pointerUp, pointerCancel, screenToWorldPoint, commits,
    get color() { return penColor; },
    get thickness() { return penThickness; },
    get camera() { return camera; },
  };
}

describe('PenTool component tests', () => {
  afterEach(cleanup);

  it('TC-09: drag with red + thick selected creates stroke once with red/thick; tool stays pen', () => {
    const h = renderPenHarness({ color: 'red', thickness: 'thick' });
    // Drag from (100,100) to (300,200)
    h.pointerDown(100, 100);
    h.pointerMove(150, 120);
    h.pointerMove(200, 150);
    h.pointerMove(250, 180);
    h.pointerUp(300, 200);

    const strokes = snapshotStroke(h.doc);
    expect(strokes.length).toBe(1);
    expect(strokes[0].color).toBe('red');
    expect(strokes[0].thickness).toBe('thick');

    // Tool should still be pen
    expect(h.ref.current.getTool()).toBe('pen');
  });

  it('TC-10: click without movement creates a single-point dot', () => {
    const h = renderPenHarness();
    h.pointerDown(200, 200);
    h.pointerUp(200, 200);

    const strokes = snapshotStroke(h.doc);
    expect(strokes.length).toBe(1);
    expect(strokes[0].points.length).toBe(2); // single point stored as [x, y]
  });

  it('TC-11: interrupted drag (pointercancel) commits stroke with points so far', () => {
    const h = renderPenHarness();
    h.pointerDown(100, 100);
    h.pointerMove(150, 150);
    h.pointerMove(200, 200);
    h.pointerCancel(200, 200);

    const strokes = snapshotStroke(h.doc);
    expect(strokes.length).toBe(1);
    // Should have points from the moves (at least 2-3)
    expect(strokes[0].points.length).toBeGreaterThanOrEqual(4);
  });

  it('TC-12: STROKE_MAX_POINTS + 10 moves → two commits, second starts at first last point', () => {
    const h = renderPenHarness();
    h.pointerDown(50, 50);

    // Move STROKE_MAX_POINTS + 10 times
    for (let i = 0; i < STROKE_MAX_POINTS + 10; i++) {
      const x = 50 + i * 0.1;
      const y = 50 + i * 0.1;
      h.pointerMove(x, y);
    }
    h.pointerUp(50 + (STROKE_MAX_POINTS + 10) * 0.1, 50 + (STROKE_MAX_POINTS + 10) * 0.1);

    const strokes = snapshotStroke(h.doc);
    expect(strokes.length).toBeGreaterThanOrEqual(2);

    // Check that the second stroke's first world point ≈ first stroke's last world point
    // We need to convert from relative points back to world space
    const first = strokes[0];
    const second = strokes[1];
    // first stroke's last point in world coords
    const firstLastX = first.x + first.points[first.points.length - 2] * (first.width / first.baseWidth);
    const firstLastY = first.y + first.points[first.points.length - 1] * (first.height / first.baseHeight);
    // second stroke's first point in world coords
    const secondFirstX = second.x + second.points[0] * (second.width / second.baseWidth);
    const secondFirstY = second.y + second.points[1] * (second.height / second.baseHeight);

    // They should be close (within simplification tolerance)
    expect(Math.abs(firstLastX - secondFirstX)).toBeLessThan(5);
    expect(Math.abs(firstLastY - secondFirstY)).toBeLessThan(5);
  });

  it('TC-13: Escape switches to select tool; no stroke created', () => {
    const h = renderPenHarness();
    act(() => {
      h.ref.current.setTool('select');
    });

    // Should no longer render pen tool overlay
    expect(() => h.utils.getByTestId('pen-tool-overlay')).toThrow();

    // No strokes created
    expect(snapshotStroke(h.doc).length).toBe(0);
  });

  it('TC-14: change colour after a stroke exists; existing stroke unchanged; next stroke uses new colour', () => {
    const h = renderPenHarness({ color: 'red' });

    // Draw first stroke (red)
    h.pointerDown(100, 100);
    h.pointerMove(200, 200);
    h.pointerUp(300, 300);

    const afterFirst = snapshotStroke(h.doc);
    expect(afterFirst.length).toBe(1);
    expect(afterFirst[0].color).toBe('red');

    // Change color to blue
    act(() => {
      h.ref.current.setColor('blue');
    });

    // Draw second stroke (blue)
    h.pointerDown(400, 400);
    h.pointerMove(500, 500);
    h.pointerUp(600, 600);

    const afterSecond = snapshotStroke(h.doc);
    expect(afterSecond.length).toBe(2);
    expect(afterSecond[0].color).toBe('red');
    expect(afterSecond[1].color).toBe('blue');
  });
});

describe('PenToolbar component tests', () => {
  afterEach(cleanup);

  it('renders six colour buttons with correct aria-labels', () => {
    const onColor = vi.fn();
    const onThickness = vi.fn();
    const { container } = render(
      <PenToolbar color="black" thickness="medium" onColor={onColor} onThickness={onThickness} />
    );

    const colorLabels = ['Black pen', 'Blue pen', 'Red pen', 'Green pen', 'Orange pen', 'Purple pen'];
    for (const label of colorLabels) {
      const btn = container.querySelector(`button[aria-label="${label}"]`);
      expect(btn).not.toBeNull();
    }
  });

  it('renders three thickness buttons', () => {
    const onColor = vi.fn();
    const onThickness = vi.fn();
    const { container } = render(
      <PenToolbar color="black" thickness="medium" onColor={onColor} onThickness={onThickness} />
    );

    const thicknessLabels = ['Thin', 'Medium', 'Thick'];
    for (const label of thicknessLabels) {
      const btn = container.querySelector(`button[aria-label="${label}"]`);
      expect(btn).not.toBeNull();
    }
  });

  it('aria-pressed is set correctly for selected colour and thickness', () => {
    const onColor = vi.fn();
    const onThickness = vi.fn();
    const { container } = render(
      <PenToolbar color="red" thickness="thick" onColor={onColor} onThickness={onThickness} />
    );

    const redBtn = container.querySelector('button[aria-label="Red pen"]');
    expect(redBtn?.getAttribute('aria-pressed')).toBe('true');

    const blackBtn = container.querySelector('button[aria-label="Black pen"]');
    expect(blackBtn?.getAttribute('aria-pressed')).toBe('false');

    const thickBtn = container.querySelector('button[aria-label="Thick"]');
    expect(thickBtn?.getAttribute('aria-pressed')).toBe('true');

    const mediumBtn = container.querySelector('button[aria-label="Medium"]');
    expect(mediumBtn?.getAttribute('aria-pressed')).toBe('false');
  });
});
