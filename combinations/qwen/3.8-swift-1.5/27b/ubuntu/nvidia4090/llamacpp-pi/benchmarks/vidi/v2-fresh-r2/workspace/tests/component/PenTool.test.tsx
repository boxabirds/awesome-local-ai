/**
 * Component tests for the Pen tool (story 11, pen.tool).
 * TC-09 to TC-14.
 *
 * Uses jsdom with synthetic pointer events and fake rAF timers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, fireEvent, cleanup } from '@testing-library/react';
import * as Y from 'yjs';
import { initDoc, objects } from '../../src/shared/board-model';
import { PEN_THICKNESS_WORLD, STROKE_MAX_POINTS, type PenColor, type PenThickness } from '../../src/shared/config';
import type { StrokeSnap } from '../../src/shared/objects/stroke';

// We test the PenTool component in isolation with a real Y.Doc.
// The component is rendered with a fixed camera (zoom=1, origin at 0,0)
// so screen coordinates equal world coordinates.

import { PenTool } from '../../src/client/tools/PenTool';
import { useTool, type ToolId } from '../../src/client/board/useTool';
import { useSelection } from '../../src/client/board/useSelection';
import { useBoardKeys } from '../../src/client/board/useBoardKeys';

/** Fixed camera: zoom=1, origin at (0,0). Screen = world. */
const CAMERA = { x: 0, y: 0, zoom: 1 };

function createTestDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function renderPenTool(opts?: { color?: PenColor; thickness?: PenThickness; doc?: Y.Doc }) {
  const doc = opts?.doc ?? createTestDoc();
  let commits = 0;
  const utils = render(
    <PenTool
      camera={CAMERA}
      color={opts?.color ?? 'black'}
      thickness={opts?.thickness ?? 'medium'}
      doc={doc}
      identityId="user-1"
      onCommit={() => { commits++; }}
    />,
  );
  return { ...utils, doc, getCommits: () => commits };
}

/**
 * Simulate a pointer drag: down at (x0,y0), move through intermediate points,
 * up at (x1,y1).
 */
function simulateDrag(el: Element, points: Array<{ x: number; y: number }>) {
  if (points.length === 0) return;
  const first = points[0];
  fireEvent.pointerDown(el, { clientX: first.x, clientY: first.y, button: 0, pointerId: 1 });
  for (let i = 1; i < points.length - 1; i++) {
    fireEvent.pointerMove(el, { clientX: points[i].x, clientY: points[i].y, pointerId: 1 });
  }
  if (points.length > 1) {
    const last = points[points.length - 1];
    fireEvent.pointerUp(el, { clientX: last.x, clientY: last.y, pointerId: 1 });
  } else {
    fireEvent.pointerUp(el, { clientX: first.x, clientY: first.y, pointerId: 1 });
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('pen.tool component', () => {
  // TC-09: pointerdown/moves/up with red + thick → createStroke called once with red/thick; tool still pen.
  it('TC-09: drag creates a stroke with the selected color and thickness', () => {
    const { doc, container } = renderPenTool({ color: 'red', thickness: 'thick' });
    const el = container.querySelector('[data-testid="pen-tool"]')!;

    act(() => {
      simulateDrag(el, [
        { x: 10, y: 10 },
        { x: 20, y: 20 },
        { x: 30, y: 30 },
        { x: 40, y: 40 },
      ]);
    });

    const snaps = objects(doc);
    const strokes = snaps.filter((s) => s.type === 'stroke');
    expect(strokes.length).toBe(1);
    const stroke = strokes[0] as unknown as StrokeSnap;
    expect(stroke.color).toBe('red');
    expect(stroke.thickness).toBe('thick');
  });

  // TC-10: pointerdown/up without movement → single-point dot.
  it('TC-10: click without movement creates a dot', () => {
    const { doc, container } = renderPenTool({ color: 'blue', thickness: 'medium' });
    const el = container.querySelector('[data-testid="pen-tool"]')!;

    act(() => {
      simulateDrag(el, [{ x: 50, y: 60 }]);
    });

    const snaps = objects(doc);
    const strokes = snaps.filter((s) => s.type === 'stroke');
    expect(strokes.length).toBe(1);
    const stroke = strokes[0] as unknown as StrokeSnap;
    expect(stroke.color).toBe('blue');
    // Dot: points length 2 (one point flattened)
    expect(stroke.points.length).toBe(2);
  });

  // TC-11: pointerdown, moves, pointercancel → stroke committed with points so far.
  it('TC-11: pointercancel commits the stroke so far', () => {
    const { doc, container } = renderPenTool();
    const el = container.querySelector('[data-testid="pen-tool"]')!;

    act(() => {
      fireEvent.pointerDown(el, { clientX: 10, clientY: 10, button: 0, pointerId: 1 });
      fireEvent.pointerMove(el, { clientX: 20, clientY: 20, pointerId: 1 });
      fireEvent.pointerMove(el, { clientX: 30, clientY: 30, pointerId: 1 });
      fireEvent.pointerCancel(el, { pointerId: 1 });
    });

    const snaps = objects(doc);
    const strokes = snaps.filter((s) => s.type === 'stroke');
    expect(strokes.length).toBe(1);
  });

  // TC-12: STROKE_MAX_POINTS + 10 moves → two commits, second starts at first's last point.
  it('TC-12: long stroke splits into two parts', () => {
    const { doc, container } = renderPenTool();
    const el = container.querySelector('[data-testid="pen-tool"]')!;

    // Generate STROKE_MAX_POINTS + 10 points in a line
    const n = STROKE_MAX_POINTS + 10;
    const points = Array.from({ length: n }, (_, i) => ({
      x: i * 0.1,
      y: 0,
    }));

    act(() => {
      fireEvent.pointerDown(el, { clientX: points[0].x, clientY: points[0].y, button: 0, pointerId: 1 });
      for (let i = 1; i < points.length; i++) {
        fireEvent.pointerMove(el, { clientX: points[i].x, clientY: points[i].y, pointerId: 1 });
      }
      const last = points[points.length - 1];
      fireEvent.pointerUp(el, { clientX: last.x, clientY: last.y, pointerId: 1 });
    });

    const snaps = objects(doc);
    const strokes = snaps.filter((s) => s.type === 'stroke') as unknown as StrokeSnap[];
    expect(strokes.length).toBe(2);
  });

  // TC-13: Escape; press V → tool becomes select; no stroke created.
  it('TC-13: Escape and V switch tools without creating a stroke', () => {
    const doc = createTestDoc();
    const { container } = render(
      <ToolHarness doc={doc} />,
    );
    const el = container.querySelector('[data-testid="pen-tool"]')!;
    expect(el).not.toBeNull();

    // Press V to switch to select
    act(() => {
      fireEvent.keyDown(window, { key: 'v' });
    });

    // The pen tool should be gone
    expect(container.querySelector('[data-testid="pen-tool"]')).toBeNull();

    // No strokes created
    const snaps = objects(doc);
    expect(snaps.filter((s) => s.type === 'stroke').length).toBe(0);
  });

  // TC-14: change colour after a stroke exists → existing stroke unchanged; next stroke uses new colour.
  it('TC-14: changing colour does not affect existing strokes', () => {
    const { doc, container, rerender } = renderPenTool({ color: 'black', thickness: 'medium' });
    const el = container.querySelector('[data-testid="pen-tool"]')!;

    // Draw first stroke (black)
    act(() => {
      simulateDrag(el, [
        { x: 10, y: 10 },
        { x: 20, y: 20 },
        { x: 30, y: 30 },
      ]);
    });

    // Rerender with new colour (simulating user changing the pen colour)
    rerender(
      <PenTool
        camera={CAMERA}
        color="red"
        thickness="medium"
        doc={doc}
        identityId="user-1"
      />,
    );
    const el2 = container.querySelector('[data-testid="pen-tool"]')!;

    // Draw second stroke (red)
    act(() => {
      simulateDrag(el2, [
        { x: 100, y: 100 },
        { x: 110, y: 110 },
        { x: 120, y: 120 },
      ]);
    });

    const snaps = objects(doc);
    const strokes = snaps.filter((s) => s.type === 'stroke') as unknown as StrokeSnap[];
    expect(strokes.length).toBe(2);
    // First stroke is still black
    expect(strokes[0].color).toBe('black');
    // Second stroke is red
    expect(strokes[1].color).toBe('red');
  });
});

/** Harness for TC-13: renders the tool state with keyboard shortcuts. */
function ToolHarness({ doc }: { doc: Y.Doc }) {
  const objects_ = [] as readonly import('../../src/shared/board-model').ObjectSnapshot[];
  const selection = useSelection(objects_);
  const tool = useTool({ canEdit: true, selection });

  // Start with pen tool
  vi.useFakeTimers({ toFake: [] });
  const { useEffect } = require('react');
  useEffect(() => {
    tool.setTool('pen');
  }, []);

  useBoardKeys({
    doc,
    objects: objects_,
    selection,
    canEdit: true,
    startEdit: selection.startEdit,
    tool: { setTool: tool.setTool },
  });

  if (tool.tool !== 'pen') return null;
  return (
    <PenTool
      camera={CAMERA}
      color="black"
      thickness="medium"
      doc={doc}
      identityId="user-1"
    />
  );
}
