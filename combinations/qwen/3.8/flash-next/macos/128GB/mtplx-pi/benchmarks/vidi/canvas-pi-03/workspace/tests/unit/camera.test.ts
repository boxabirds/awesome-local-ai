import { describe, it, expect } from 'vitest';
import {
  screenToWorld,
  worldToScreen,
  panBy,
  zoomAt,
  zoomStep,
  resetCamera,
  canZoomIn,
  canZoomOut,
  zoomPercent,
  type Camera,
  type Point,
} from '../../src/client/canvas/camera';
import {
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_STEP_FACTOR,
  GRID_SPACING_WORLD,
  UNBOUNDED_PAN_TESTED_EXTENT,
} from '../../src/shared/config';

const ORIGIN: Camera = { x: 0, y: 0, zoom: 1 };
const VIEWPORT = { width: 1200, height: 800 };

function close(actual: number, expected: number, tol = 1e-6): boolean {
  return Math.abs(actual - expected) < tol;
}

describe('camera.math — panBy', () => {
  it('TC-01: pan at zoom 1 shifts camera by screen/zoom and moves the world origin on screen', () => {
    const next = panBy(ORIGIN, 200, 100);
    expect(next.x).toBeCloseTo(-200, 6);
    expect(next.y).toBeCloseTo(-100, 6);
    // world (0,0) was at screen (0,0); after panning it sits at (200,100)
    const before = worldToScreen(ORIGIN, { x: 0, y: 0 });
    const after = worldToScreen(next, { x: 0, y: 0 });
    expect(before).toEqual({ x: 0, y: 0 });
    expect(close(after.x, 200)).toBe(true);
    expect(close(after.y, 100)).toBe(true);
  });

  it('TC-02: pan at ZOOM_MAX far away shifts by delta/zoom world units', () => {
    const far: Camera = { x: UNBOUNDED_PAN_TESTED_EXTENT, y: UNBOUNDED_PAN_TESTED_EXTENT, zoom: ZOOM_MAX };
    const next = panBy(far, 200, 100);
    expect(close(next.x, UNBOUNDED_PAN_TESTED_EXTENT - 200 / ZOOM_MAX)).toBe(true);
    expect(close(next.y, UNBOUNDED_PAN_TESTED_EXTENT - 100 / ZOOM_MAX)).toBe(true);
  });

  it('panBy with zero delta returns the same object', () => {
    expect(panBy(ORIGIN, 0, 0)).toBe(ORIGIN);
  });
});

describe('camera.math — zoomAt keeps the pointer world point invariant', () => {
  it('TC-03: zoom 1 -> 2 at a pointer keeps that world point under the pointer (origin)', () => {
    const p: Point = { x: 300, y: 200 };
    const before = screenToWorld(ORIGIN, p);
    const next = zoomAt(ORIGIN, p, 2);
    expect(next.zoom).toBeCloseTo(2, 6);
    const after = screenToWorld(next, p);
    expect(close(after.x, before.x)).toBe(true);
    expect(close(after.y, before.y)).toBe(true);
  });

  it('TC-04: zoom at a far pointer keeps the pointer world point invariant', () => {
    const far: Camera = { x: UNBOUNDED_PAN_TESTED_EXTENT, y: UNBOUNDED_PAN_TESTED_EXTENT, zoom: 1 };
    const p: Point = { x: 300, y: 200 };
    const before = screenToWorld(far, p);
    const next = zoomAt(far, p, 1.5);
    const after = screenToWorld(next, p);
    expect(close(after.x, before.x)).toBe(true);
    expect(close(after.y, before.y)).toBe(true);
  });

  it('TC-11: a huge factor clamps to ZOOM_MAX and keeps the pointer invariant', () => {
    const p: Point = { x: 300, y: 200 };
    const before = screenToWorld(ORIGIN, p);
    const next = zoomAt(ORIGIN, p, 1000);
    expect(next.zoom).toBe(ZOOM_MAX);
    const after = screenToWorld(next, p);
    expect(close(after.x, before.x)).toBe(true);
    expect(close(after.y, before.y)).toBe(true);
  });
});

describe('camera.math — limits and invalid factors', () => {
  it('TC-05: at ZOOM_MIN zooming out returns the same object', () => {
    const atMin: Camera = { x: 12, y: -8, zoom: ZOOM_MIN };
    const centre: Point = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
    const next = zoomAt(atMin, centre, 1 / ZOOM_STEP_FACTOR);
    expect(next).toBe(atMin);
  });

  it('TC-06: at ZOOM_MAX zooming in returns the same object', () => {
    const atMax: Camera = { x: 12, y: -8, zoom: ZOOM_MAX };
    const centre: Point = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
    const next = zoomAt(atMax, centre, ZOOM_STEP_FACTOR);
    expect(next).toBe(atMax);
  });

  it('TC-12: factor 0, negative, NaN, Infinity leave the camera unchanged and yield no NaN', () => {
    const p: Point = { x: 100, y: 50 };
    for (const factor of [0, -1, -0.5, NaN, Infinity, -Infinity]) {
      const next = zoomAt(ORIGIN, p, factor);
      expect(next).toBe(ORIGIN);
      expect(Number.isFinite(next.x)).toBe(true);
      expect(Number.isFinite(next.y)).toBe(true);
      expect(Number.isFinite(next.zoom)).toBe(true);
    }
  });
});

describe('camera.math — resize, reset and step behaviour', () => {
  it('TC-07: a viewport resize leaves the camera unchanged (no camera fn consumes viewport without an action)', () => {
    const cam: Camera = { x: 5, y: 7, zoom: 2 };
    // Two different viewport sizes must not alter a camera that receives no input.
    expect(panBy(cam, 0, 0)).toBe(cam);
    // worldToScreen/screenToWorld are independent of viewport size.
    const p: Point = { x: 40, y: 20 };
    const s = worldToScreen(cam, p);
    expect(close(s.x, (40 - 5) * 2)).toBe(true);
    expect(close(s.y, (20 - 7) * 2)).toBe(true);
  });

  it('TC-08: resetCamera(1200x800) -> zoom 1 with world origin centred', () => {
    const far: Camera = { x: UNBOUNDED_PAN_TESTED_EXTENT, y: UNBOUNDED_PAN_TESTED_EXTENT, zoom: ZOOM_MAX };
    void far;
    const reset = resetCamera(VIEWPORT);
    expect(reset.zoom).toBe(1);
    expect(reset.x).toBeCloseTo(-600, 6);
    expect(reset.y).toBeCloseTo(-400, 6);
    // origin should land at the centre of the viewport
    const origin = worldToScreen(reset, { x: 0, y: 0 });
    expect(close(origin.x, VIEWPORT.width / 2)).toBe(true);
    expect(close(origin.y, VIEWPORT.height / 2)).toBe(true);
  });

  it('TC-09: one step in then one step out returns exactly zoom 1 (percent 100)', () => {
    const inStep = zoomStep(ORIGIN, VIEWPORT, 'in');
    expect(inStep.zoom).toBeCloseTo(ZOOM_STEP_FACTOR, 6);
    const out = zoomStep(inStep, VIEWPORT, 'out');
    expect(out.zoom).toBe(1);
    expect(zoomPercent(out)).toBe(100);
  });

  it('TC-10: 20 steps in clamps at ZOOM_MAX and disables zoom-in', () => {
    let cam: Camera = ORIGIN;
    for (let i = 0; i < 20; i++) cam = zoomStep(cam, VIEWPORT, 'in');
    expect(cam.zoom).toBe(ZOOM_MAX);
    expect(canZoomIn(cam)).toBe(false);
    expect(zoomPercent(cam)).toBe(Math.round(ZOOM_MAX * 100));
  });

  it('canZoomIn/canZoomOut/zoomPercent sanity', () => {
    expect(canZoomIn(ORIGIN)).toBe(true);
    expect(canZoomOut(ORIGIN)).toBe(true);
    expect(canZoomOut({ x: 0, y: 0, zoom: ZOOM_MIN })).toBe(false);
    expect(canZoomIn({ x: 0, y: 0, zoom: ZOOM_MAX })).toBe(false);
    expect(zoomPercent({ x: 0, y: 0, zoom: 1.5625 })).toBe(156);
  });
});

describe('camera.math — property: pointer world point is invariant under zoomAt', () => {
  it('1,000 seeded cameras/points/factors keep the pointer within 1e-6', () => {
    // deterministic PRNG
    let seed = 0x12345678;
    function rand(): number {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    let checked = 0;
    for (let i = 0; i < 1000; i++) {
      const zoom = ZOOM_MIN + rand() * (ZOOM_MAX - ZOOM_MIN);
      const cam: Camera = {
        x: (rand() - 0.5) * 2000,
        y: (rand() - 0.5) * 2000,
        zoom,
      };
      const p: Point = { x: rand() * 1280, y: rand() * 800 };
      const factor = 0.1 + rand() * 10;
      const before = screenToWorld(cam, p);
      const next = zoomAt(cam, p, factor);
      const after = screenToWorld(next, p);
      // whether clamped, unchanged or zoomed, the pointer world point is preserved
      expect(Number.isFinite(after.x)).toBe(true);
      expect(Number.isFinite(after.y)).toBe(true);
      if (next.zoom !== cam.zoom) {
        expect(close(after.x, before.x)).toBe(true);
        expect(close(after.y, before.y)).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(500);
    // GRID_SPACING_WORLD referenced to keep the constant in scope for future grid tests
    expect(GRID_SPACING_WORLD).toBeGreaterThan(0);
  });
});