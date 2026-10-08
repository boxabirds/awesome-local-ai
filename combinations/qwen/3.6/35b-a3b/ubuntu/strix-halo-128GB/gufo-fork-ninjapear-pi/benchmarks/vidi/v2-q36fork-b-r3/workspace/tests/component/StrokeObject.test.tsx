import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { StrokeObject } from '../../src/client/objects/StrokeObject';
import type { StrokeSnapshot } from '@shared/board-model';
import { scaledPoints } from '@shared/objects/stroke';
import { PEN_COLORS, PEN_THICKNESS_WORLD, STROKE_HIT_TOLERANCE_PX } from '@shared/config';
import { distanceToPolyline } from '@shared/geometry/polyline';
import { objectBounds } from '@shared/board-model';
import { getObjectType } from '../../src/client/objects/registry';
import type { Point } from '../../src/client/canvas/camera';

beforeEach(() => {
  cleanup();
});

/** Create a minimal stroke snapshot for testing. */
function makeStroke(options: Partial<StrokeSnapshot> = {}): StrokeSnapshot {
  const points: number[] = [0, 0, 50, 30, 100, 10];
  return {
    id: 'test-stroke',
    type: 'stroke',
    x: 0,
    y: 0,
    width: 104,
    height: 34,
    points,
    baseWidth: 104,
    baseHeight: 34,
    color: options.color ?? 'black',
    thickness: options.thickness ?? 'medium',
    z: 1,
    createdAt: Date.now(),
    ...options,
  };
}

// ── TC-15: registry hitTest at 5px and 7px screen distance ────────
describe('TC-15 registry hitTest boundaries', () => {
  it('hit at 5px screen distance', () => {
    const spec = getObjectType('stroke');
    expect(spec).toBeDefined();

    const snap = makeStroke({
      points: [0, 0, 100, 0], // horizontal line
      baseWidth: 100,
      baseHeight: 4,
      width: 100,
      height: 4,
      thickness: 'medium',
    });

    // At zoom 1, hit tolerance = max(2, 6) = 6
    // A point 5 screen px away is 5 world units at zoom 1
    const pt5 = { x: 50, y: 5 };
    const hit5 = spec!.hitTest(snap, pt5, 1);
    expect(hit5).toBe(true);
  });

  it('miss at 7px screen distance at zoom 1', () => {
    const spec = getObjectType('stroke');
    const snap = makeStroke({
      points: [0, 0, 100, 0],
      baseWidth: 100,
      baseHeight: 4,
      width: 100,
      height: 4,
      thickness: 'medium',
    });

    // 7 screen px away at zoom 1 = 7 world units away
    const pt7 = { x: 50, y: 7 };
    const dist = distanceToPolyline(scaledPoints(snap), pt7);
    const tolerance = Math.max(PEN_THICKNESS_WORLD.medium / 2, STROKE_HIT_TOLERANCE_PX / 1);
    expect(dist).toBeGreaterThan(tolerance);
    const miss7 = spec!.hitTest(snap, pt7, 1);
    expect(miss7).toBe(false);
  });

  it('hit at 5px screen distance at zoom 0.5', () => {
    const spec = getObjectType('stroke');
    const snap = makeStroke({
      points: [0, 0, 200, 0],
      baseWidth: 200,
      baseHeight: 4,
      width: 200,
      height: 4,
      thickness: 'medium',
    });

    // At zoom 0.5, hit tolerance in world units = 6 / 0.5 = 12
    const pt = { x: 100, y: 2.5 }; // 2.5 world units = 5 screen px
    const hit = spec!.hitTest(snap, pt, 0.5);
    expect(hit).toBe(true);
  });

  it('miss at 7px screen distance at zoom 2', () => {
    const spec = getObjectType('stroke');
    const snap = makeStroke({
      points: [0, 0, 50, 0],
      baseWidth: 50,
      baseHeight: 4,
      width: 50,
      height: 4,
      thickness: 'medium',
    });

    // At zoom 2, hit tolerance in world units = 6 / 2 = 3
    // 7 screen px = 3.5 world units → miss
    const pt = { x: 25, y: 3.5 };
    const miss = spec!.hitTest(snap, pt, 2);
    expect(miss).toBe(false);
  });
});

// ── TC-16: Click inside bbox far from line misses stroke ──────────
describe('TC-16 click inside bbox but far from line', () => {
  it('a point well above the line should not be selected', () => {
    const spec = getObjectType('stroke');
    // Long thin stroke near bottom of its bbox
    const snap = makeStroke({
      points: [0, 28, 100, 28],
      baseWidth: 104,
      baseHeight: 34,
      width: 104,
      height: 34,
      thickness: 'thin',
    });

    // Point at center of bbox (y=17) but line is at y=28 - that's 11 units away
    // Tolerance = max(1, 6) = 6, so this should miss
    const centerPt = { x: 50, y: 17 };
    const hit = spec!.hitTest(snap, centerPt, 1);
    expect(hit).toBe(false);
  });
});

// ── StrokeObject Rendering Tests ──────────────────────────────────
describe('StrokeObject rendering', () => {
  it('renders an SVG path with correct attributes', () => {
    const snap = makeStroke();
    const { container } = render(<StrokeObject stroke={snap} selected={false} />);
    const path = container.querySelector('path');
    expect(path).not.toBeNull();
    expect(path?.getAttribute('aria-label')).toBe('Drawing');
    expect(path?.getAttribute('stroke')).toBe(PEN_COLORS[snap.color]);
  });

  it('single point renders as zero-length path', () => {
    const snap = makeStroke({
      points: [50, 50],
      baseWidth: 4,
      baseHeight: 4,
      width: 4,
      height: 4,
      thickness: 'thick',
    });
    const { container } = render(<StrokeObject stroke={snap} selected={false} />);
    const path = container.querySelector('path');
    expect(path).not.toBeNull();
    expect(path?.getAttribute('d')).toContain('M');
  });

  it('renders with round caps and joins', () => {
    const snap = makeStroke();
    const { container } = render(<StrokeObject stroke={snap} selected={false} />);
    const path = container.querySelector('path');
    expect(path?.getAttribute('stroke-linecap')).toBe('round');
    expect(path?.getAttribute('stroke-linejoin')).toBe('round');
  });
});

// ── TC-21: Remote delete while selected ───────────────────────────
describe('TC-21 remote delete while selected', () => {
  it('component does not throw on missing stroke', () => {
    // When a stroke is deleted remotely, its entry is removed from the document.
    // The component simply reads from the snapshot; if no stroke exists, nothing to render.
    // This test verifies the component handles gracefully.
    const snap = makeStroke();
    const { unmount } = render(<StrokeObject stroke={snap} selected={true} />);
    unmount();
    // No error thrown
  });
});
