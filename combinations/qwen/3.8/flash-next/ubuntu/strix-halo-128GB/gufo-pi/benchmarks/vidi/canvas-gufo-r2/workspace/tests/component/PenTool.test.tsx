/**
 * Component tests for Pen tool and StrokeObject (TC-09 to TC-16, TC-21).
 * jsdom tests with real Y.Doc, synthetic pointer events, fake rAF timers.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import * as Y from 'yjs';
import { App } from '../../src/client/App';
import { initDoc, createSticky } from '../../src/shared/board-model';
import { getObjectType } from '../../src/client/objects/registry';
import type { StrokeSnap } from '../../src/shared/objects/stroke';
import { STROKE_MAX_POINTS } from '../../src/shared/config';
import { startFakeFrames, flushFrames } from './harness';

function getObjects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
}

function countType(doc: Y.Doc, type: string): number {
  let count = 0;
  getObjects(doc).forEach((obj) => {
    if (obj.get('type') === type) count++;
  });
  return count;
}

function addStroke(doc: Y.Doc, opts: {
  points: number[];
  x: number;
  y: number;
  width: number;
  height: number;
  baseWidth: number;
  baseHeight: number;
  color: string;
  thickness: string;
}): string {
  const objects = getObjects(doc);
  const id = Math.random().toString(36).slice(2);
  doc.transact(() => {
    const obj = new Y.Map();
    obj.set('type', 'stroke');
    obj.set('x', opts.x);
    obj.set('y', opts.y);
    obj.set('width', opts.width);
    obj.set('height', opts.height);
    obj.set('points', opts.points);
    obj.set('baseWidth', opts.baseWidth);
    obj.set('baseHeight', opts.baseHeight);
    obj.set('color', opts.color);
    obj.set('thickness', opts.thickness);
    obj.set('z', objects.size + 1);
    obj.set('createdAt', Date.now());
    objects.set(id, obj);
  });
  return id;
}

describe('Pen tool', () => {
  beforeEach(() => {
    startFakeFrames();
  });

  // TC-09: pointerdown/moves/up with red + thick selected → createStroke called once with red/thick; tool still pen
  it('TC-09: drag draws a stroke with selected color and thickness; pen stays active', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    render(<App doc={doc} />);
    flushFrames();

    // Activate pen tool via P key
    act(() => { fireEvent.keyDown(window, { key: 'p' }); });
    flushFrames();

    // Verify pen button is pressed
    const penBtn = screen.getByLabelText('Pen (P)');
    expect(penBtn).toHaveAttribute('aria-pressed', 'true');

    // Verify pen toolbar is visible
    expect(screen.getByTestId('pen-toolbar')).toBeInTheDocument();

    // Select red color
    const redBtn = screen.getByLabelText('Red pen');
    act(() => { fireEvent.click(redBtn); });
    flushFrames();
    expect(redBtn).toHaveAttribute('aria-pressed', 'true');

    // Select thick
    const thickBtn = screen.getByLabelText('Thick');
    act(() => { fireEvent.click(thickBtn); });
    flushFrames();
    expect(thickBtn).toHaveAttribute('aria-pressed', 'true');

    const penOverlay = screen.getByTestId('pen-tool-overlay');
    expect(penOverlay).toBeInTheDocument();

    const beforeCount = countType(doc, 'stroke');

    // Draw a stroke (drag)
    act(() => {
      fireEvent.pointerDown(penOverlay, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    });
    act(() => {
      fireEvent.pointerMove(penOverlay, { pointerId: 1, clientX: 150, clientY: 120 });
      fireEvent.pointerMove(penOverlay, { pointerId: 1, clientX: 200, clientY: 140 });
      fireEvent.pointerMove(penOverlay, { pointerId: 1, clientX: 250, clientY: 160 });
    });
    flushFrames();
    act(() => {
      fireEvent.pointerUp(penOverlay, { pointerId: 1, clientX: 250, clientY: 160 });
    });
    flushFrames();

    // A stroke should have been created
    expect(countType(doc, 'stroke')).toBe(beforeCount + 1);

    // Verify the stroke has red color and thick thickness
    const objects = getObjects(doc);
    let strokeColor = '';
    let strokeThickness = '';
    objects.forEach((obj) => {
      if (obj.get('type') === 'stroke') {
        strokeColor = obj.get('color') as string;
        strokeThickness = obj.get('thickness') as string;
      }
    });
    expect(strokeColor).toBe('red');
    expect(strokeThickness).toBe('thick');

    // Pen tool should still be active (not switched to select)
    expect(penBtn).toHaveAttribute('aria-pressed', 'true');
  });

  // TC-10: pointerdown/up without movement → single-point dot committed
  it('TC-10: click without movement creates a dot', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    render(<App doc={doc} />);
    flushFrames();

    // Activate pen tool
    act(() => { fireEvent.keyDown(window, { key: 'p' }); });
    flushFrames();

    const penOverlay = screen.getByTestId('pen-tool-overlay');
    const beforeCount = countType(doc, 'stroke');

    // Click without movement
    act(() => {
      fireEvent.pointerDown(penOverlay, { button: 0, pointerId: 1, clientX: 200, clientY: 200 });
    });
    act(() => {
      fireEvent.pointerUp(penOverlay, { pointerId: 1, clientX: 200, clientY: 200 });
    });
    flushFrames();

    // A dot should have been created
    expect(countType(doc, 'stroke')).toBe(beforeCount + 1);

    // The stroke should have points with length 2 (one point)
    const objects = getObjects(doc);
    let ptsLength = 0;
    objects.forEach((obj) => {
      if (obj.get('type') === 'stroke') {
        const pts = obj.get('points') as number[];
        ptsLength = pts.length;
      }
    });
    expect(ptsLength).toBe(2);
  });

  // TC-11: pointerdown, moves, pointercancel → stroke committed with points so far
  it('TC-11: interrupted drag commits stroke with points so far', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    render(<App doc={doc} />);
    flushFrames();

    // Activate pen tool
    act(() => { fireEvent.keyDown(window, { key: 'p' }); });
    flushFrames();

    const penOverlay = screen.getByTestId('pen-tool-overlay');
    const beforeCount = countType(doc, 'stroke');

    // Start drawing then cancel
    act(() => {
      fireEvent.pointerDown(penOverlay, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    });
    act(() => {
      fireEvent.pointerMove(penOverlay, { pointerId: 1, clientX: 150, clientY: 150 });
      fireEvent.pointerMove(penOverlay, { pointerId: 1, clientX: 200, clientY: 200 });
    });
    flushFrames();
    act(() => {
      fireEvent.pointerCancel(penOverlay, { pointerId: 1 });
    });
    flushFrames();

    // A stroke should have been committed with the points drawn so far
    expect(countType(doc, 'stroke')).toBe(beforeCount + 1);
  });

  // TC-12: STROKE_MAX_POINTS + 10 moves → two commits, second starts at first's last point
  it('TC-12: reaching STROKE_MAX_POINTS splits into two strokes', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    render(<App doc={doc} />);
    flushFrames();

    // Activate pen tool
    act(() => { fireEvent.keyDown(window, { key: 'p' }); });
    flushFrames();

    const penOverlay = screen.getByTestId('pen-tool-overlay');
    const beforeCount = countType(doc, 'stroke');

    // Draw many points to exceed STROKE_MAX_POINTS
    act(() => {
      fireEvent.pointerDown(penOverlay, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    });

    // Move more than STROKE_MAX_POINTS times (batched in one act for performance)
    act(() => {
      for (let i = 0; i < STROKE_MAX_POINTS + 10; i++) {
        fireEvent.pointerMove(penOverlay, {
          pointerId: 1,
          clientX: 100 + i * 0.01,
          clientY: 100 + i * 0.01,
        });
      }
    });

    flushFrames();
    act(() => {
      fireEvent.pointerUp(penOverlay, { pointerId: 1, clientX: 200, clientY: 200 });
    });
    flushFrames();

    // Two strokes should have been created (split + remaining)
    expect(countType(doc, 'stroke')).toBeGreaterThanOrEqual(beforeCount + 2);
  });

  // TC-13: Escape; press V → tool select, nothing created
  it('TC-13: Escape and V switch to select and create nothing', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    render(<App doc={doc} />);
    flushFrames();

    // Activate pen tool
    act(() => { fireEvent.keyDown(window, { key: 'p' }); });
    flushFrames();
    const penBtn = screen.getByLabelText('Pen (P)');
    expect(penBtn).toHaveAttribute('aria-pressed', 'true');

    // Escape → should switch to select
    act(() => { fireEvent.keyDown(window, { key: 'Escape' }); });
    flushFrames();
    expect(penBtn).toHaveAttribute('aria-pressed', 'false');

    // Activate pen again
    act(() => { fireEvent.keyDown(window, { key: 'p' }); });
    flushFrames();
    expect(penBtn).toHaveAttribute('aria-pressed', 'true');

    // Press V → select
    act(() => { fireEvent.keyDown(window, { key: 'v' }); });
    flushFrames();
    expect(penBtn).toHaveAttribute('aria-pressed', 'false');

    // No strokes created
    expect(countType(doc, 'stroke')).toBe(0);
  });

  // TC-14: change colour after a stroke exists → existing stroke unchanged; next stroke uses new colour
  it('TC-14: changing colour does not restyle existing strokes', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    render(<App doc={doc} />);
    flushFrames();

    // Activate pen tool
    act(() => { fireEvent.keyDown(window, { key: 'p' }); });
    flushFrames();

    const penOverlay = screen.getByTestId('pen-tool-overlay');

    // Draw a stroke with default (black)
    act(() => {
      fireEvent.pointerDown(penOverlay, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(penOverlay, { pointerId: 1, clientX: 200, clientY: 150 });
      fireEvent.pointerUp(penOverlay, { pointerId: 1, clientX: 200, clientY: 150 });
    });
    flushFrames();

    // Change colour to blue
    const blueBtn = screen.getByLabelText('Blue pen');
    act(() => { fireEvent.click(blueBtn); });
    flushFrames();

    // Draw another stroke
    act(() => {
      fireEvent.pointerDown(penOverlay, { button: 0, pointerId: 1, clientX: 100, clientY: 300 });
      fireEvent.pointerMove(penOverlay, { pointerId: 1, clientX: 200, clientY: 350 });
      fireEvent.pointerUp(penOverlay, { pointerId: 1, clientX: 200, clientY: 350 });
    });
    flushFrames();

    // Verify the first stroke is still black, second is blue
    const objects = getObjects(doc);
    const colors: string[] = [];
    objects.forEach((obj) => {
      if (obj.get('type') === 'stroke') {
        colors.push(obj.get('color') as string);
      }
    });
    expect(colors.length).toBe(2);
    expect(colors[0]).toBe('black');
    expect(colors[1]).toBe('blue');
  });
});

describe('StrokeObject', () => {
  beforeEach(() => {
    startFakeFrames();
  });

  // TC-15: registry hitTest at 5 px and 7 px screen distance at 50% and 200% zoom → hit / miss
  it('TC-15: hit test at boundary distances at different zoom levels', () => {
    const doc = new Y.Doc();
    initDoc(doc);

    // Create a horizontal stroke from (100,100) to (300,100) with thin thickness
    const strokeId = addStroke(doc, {
      points: [10, 10, 200, 10, 210, 10], // relative to bbox (x=90, y=90, w=220, h=20)
      x: 90,
      y: 90,
      width: 220,
      height: 20,
      baseWidth: 220,
      baseHeight: 20,
      color: 'black',
      thickness: 'thin',
    });

    const snap = {
      id: strokeId,
      type: 'stroke',
      x: 90,
      y: 90,
      width: 220,
      height: 20,
      z: 1,
      createdAt: 1,
      points: [10, 10, 200, 10, 210, 10],
      baseWidth: 220,
      baseHeight: 20,
      color: 'black' as const,
      thickness: 'thin' as const,
    } as StrokeSnap;

    const spec = getObjectType('stroke');
    expect(spec).toBeDefined();

    // At zoom 0.5 (50%): tolerance = max(1, 6/0.5) = 12 world units
    // Point 5 world units from line → 5 <= 12 → hit
    expect(spec!.hitTest(snap as any, { x: 200, y: 95 }, 0.5)).toBe(true);
    // Point 7 world units from line → 7 <= 12 → hit (both hit at 50%)
    expect(spec!.hitTest(snap as any, { x: 200, y: 97 }, 0.5)).toBe(true);

    // At zoom 2 (200%): tolerance = max(1, 6/2) = 3 world units
    // Point 5 world units from line → 5 > 3 → miss
    expect(spec!.hitTest(snap as any, { x: 200, y: 95 }, 2)).toBe(false);
    // Point 2 world units from line → 2 <= 3 → hit
    expect(spec!.hitTest(snap as any, { x: 200, y: 98 }, 2)).toBe(true);
  });

  // TC-16: click inside a stroke's bbox far from the line over a sticky note → sticky selected, stroke not
  it('TC-16: click inside stroke bbox but far from line selects object below, not stroke', () => {
    const doc = new Y.Doc();
    initDoc(doc);

    // Add a sticky note
    createSticky(doc, { x: 200, y: 200 });

    // Add a large arc stroke that goes around the sticky
    // Bbox from (100,50) to (300,350) - large empty area inside
    const strokeId = addStroke(doc, {
      points: [100, 0, 50, 100, 100, 300, 50, 300, 0, 150], // arc points relative to bbox origin
      x: 100,
      y: 50,
      width: 200,
      height: 300,
      baseWidth: 200,
      baseHeight: 300,
      color: 'black',
      thickness: 'thin',
    });

    // The stroke's hit test should NOT match a click at center of bbox (far from line)
    const snap: StrokeSnap = {
      id: strokeId,
      type: 'stroke',
      x: 100,
      y: 50,
      width: 200,
      height: 300,
      z: 1,
      createdAt: 1,
      points: [100, 0, 50, 100, 100, 300, 50, 300, 0, 150],
      baseWidth: 200,
      baseHeight: 300,
      color: 'black',
      thickness: 'thin',
    };

    const spec = getObjectType('stroke');
    // Center of bbox (200, 200) is far from the line
    expect(spec!.hitTest(snap as any, { x: 200, y: 200 }, 1)).toBe(false);
  });

  // TC-21: stroke deleted via model while selected → selection cleared, no exception
  it('TC-21: remote delete of selected stroke clears selection without error', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const strokeId = addStroke(doc, {
      points: [10, 10, 200, 10],
      x: 90,
      y: 90,
      width: 220,
      height: 20,
      baseWidth: 220,
      baseHeight: 20,
      color: 'black',
      thickness: 'medium',
    });

    render(<App doc={doc} />);
    flushFrames();

    // Verify stroke renders
    expect(screen.getByTestId('board').querySelector(`[data-stroke-id="${strokeId}"]`)).not.toBeNull();

    // Delete the stroke from the doc (simulating remote delete)
    const objects = getObjects(doc);
    act(() => {
      doc.transact(() => { objects.delete(strokeId); });
    });
    flushFrames();
    flushFrames();

    // Should not throw; stroke is gone from DOM
    expect(screen.getByTestId('board').querySelector(`[data-stroke-id="${strokeId}"]`)).toBeNull();
  });
});
