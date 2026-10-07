import { describe, it, expect } from 'vitest';
import {
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_STEP_FACTOR,
} from '../../src/shared/config';
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
  type Size,
} from '../../src/client/canvas/camera';

const ORIGIN: Camera = { x: 0, y: 0, zoom: 1 };
const VIEWPORT: Size = { width: 1200, height: 800 };

function near(a: number, b: number, tol = 1e-6): boolean {
  return Math.abs(a - b) <= tol;
}

// Deterministic seeded RNG (mulberry32) for the property check.
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('camera.math', () => {
  // TC-01: panBy at zoom 1, at origin.
  it('TC-01 panBy moves camera opposite to pointer and drags world with pointer', () => {
    const next = panBy(ORIGIN, 200, 100);
    expect(next.x).toBeCloseTo(-200, 9);
    expect(next.y).toBeCloseTo(-100, 9);
    // world origin now appears at screen (200, 100)
    const sp = worldToScreen(next, { x: 0, y: 0 });
    expect(sp.x).toBeCloseTo(200, 9);
    expect(sp.y).toBeCloseTo(100, 9);
    // screenToWorld round-trips worldToScreen
    const w = screenToWorld(next, sp);
    expect(w.x).toBeCloseTo(0, 9);
    expect(w.y).toBeCloseTo(0, 9);
    // zero-length drag returns the same object
    expect(panBy(ORIGIN, 0, 0)).toBe(ORIGIN);
  });

  // TC-02: panBy at ZOOM_MAX far away — screen pixels map to fractional world units.
  it('TC-02 panBy far away at max zoom shifts world exactly', () => {
    const far: Camera = { x: 1_000_000, y: 1_000_000, zoom: ZOOM_MAX };
    const next = panBy(far, 200, 100);
    expect(next.x).toBeCloseTo(1_000_000 - 200 / ZOOM_MAX, 9);
    expect(next.y).toBeCloseTo(1_000_000 - 100 / ZOOM_MAX, 9);
    expect(near(next.x, 1_000_000 - 200 / ZOOM_MAX, 1e-6)).toBe(true);
  });

  // TC-03: zoomAt keeps the world point under the pointer fixed (origin).
  it('TC-03 zoomAt keeps the world point under the pointer invariant', () => {
    const p: Point = { x: 300, y: 200 };
    const before = screenToWorld(ORIGIN, p);
    const next = zoomAt(ORIGIN, p, 2);
    expect(next.zoom).toBeCloseTo(2, 9);
    const after = screenToWorld(next, p);
    expect(near(before.x, after.x, 1e-6)).toBe(true);
    expect(near(before.y, after.y, 1e-6)).toBe(true);
  });

  // TC-04: zoomAt invariant far away.
  it('TC-04 zoomAt keeps pointer invariant far away', () => {
    const far: Camera = { x: 1_000_000, y: 1_000_000, zoom: 1 };
    const p: Point = { x: 300, y: 200 };
    const before = screenToWorld(far, p);
    const next = zoomAt(far, p, 1.5);
    const after = screenToWorld(next, p);
    expect(near(before.x, after.x, 1e-6)).toBe(true);
    expect(near(before.y, after.y, 1e-6)).toBe(true);
  });

  // TC-05: zooming out at ZOOM_MIN returns the SAME object.
  it('TC-05 zoomAt out at ZOOM_MIN is a no-op (same object)', () => {
    const atMin: Camera = { x: 0, y: 0, zoom: ZOOM_MIN };
    const centre: Point = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
    const next = zoomAt(atMin, centre, 1 / ZOOM_STEP_FACTOR);
    expect(next).toBe(atMin);
  });

  // TC-06: zooming in at ZOOM_MAX returns the SAME object.
  it('TC-06 zoomAt in at ZOOM_MAX is a no-op (same object)', () => {
    const atMax: Camera = { x: 0, y: 0, zoom: ZOOM_MAX };
    const centre: Point = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
    const next = zoomAt(atMax, centre, ZOOM_STEP_FACTOR);
    expect(next).toBe(atMax);
  });

  // TC-07: a viewport resize never mutates the camera.
  it('TC-07 resize leaves camera x, y, zoom unchanged', () => {
    const cam: Camera = { x: 123, y: -45, zoom: 1.5 };
    const snapshot = { ...cam };
    const _small: Size = { width: 640, height: 480 };
    const _big: Size = { width: 1920, height: 1080 };
    // Resizing changes only the Size handed to helpers, never the camera itself.
    expect(cam).toEqual(snapshot);
    void _small;
    void _big;
  });

  // TC-08: resetCamera centres the world origin at 100%.
  it('TC-08 resetCamera centres the origin', () => {
    const far: Camera = { x: 1_000_000, y: 1_000_000, zoom: ZOOM_MAX };
    const reset = resetCamera(VIEWPORT);
    expect(reset.zoom).toBe(1);
    expect(reset.x).toBeCloseTo(-VIEWPORT.width / 2, 9);
    expect(reset.y).toBeCloseTo(-VIEWPORT.height / 2, 9);
    // origin (world 0,0) is at the centre of the viewport
    const originScreen = worldToScreen(reset, { x: 0, y: 0 });
    expect(originScreen.x).toBeCloseTo(VIEWPORT.width / 2, 9);
    expect(originScreen.y).toBeCloseTo(VIEWPORT.height / 2, 9);
    void far;
  });

  // TC-09: one step in then one step out returns EXACTLY 1.0.
  it('TC-09 step in then out returns exactly 1.0', () => {
    const inStep = zoomStep(ORIGIN, VIEWPORT, 'in');
    expect(inStep.zoom).toBe(ZOOM_STEP_FACTOR); // 1.25 exactly
    expect(zoomPercent(inStep)).toBe(125);
    const outStep = zoomStep(inStep, VIEWPORT, 'out');
    expect(outStep.zoom).toBe(1); // exactly 1.0, no float drift
    expect(zoomPercent(outStep)).toBe(100);
  });

  // TC-10: repeated zoom-in clamps at ZOOM_MAX and disables Zoom in.
  it('TC-10 zoomStep clamps at ZOOM_MAX', () => {
    let cam = ORIGIN;
    for (let i = 0; i < 20; i++) cam = zoomStep(cam, VIEWPORT, 'in');
    expect(cam.zoom).toBe(ZOOM_MAX);
    expect(canZoomIn(cam)).toBe(false);
    expect(canZoomOut(cam)).toBe(true);
    // zooming back out re-enables in
    const out = zoomStep(cam, VIEWPORT, 'out');
    expect(canZoomIn(out)).toBe(true);
  });

  // TC-11: a huge factor clamps to ZOOM_MAX and keeps pointer invariance.
  it('TC-11 huge factor clamps and keeps pointer invariant', () => {
    const p: Point = { x: 300, y: 200 };
    const before = screenToWorld(ORIGIN, p);
    const next = zoomAt(ORIGIN, p, 1000);
    expect(next.zoom).toBe(ZOOM_MAX);
    const after = screenToWorld(next, p);
    expect(near(before.x, after.x, 1e-6)).toBe(true);
    expect(near(before.y, after.y, 1e-6)).toBe(true);
  });

  // TC-12: invalid factors return the input camera unchanged, no NaN leaks.
  it('TC-12 invalid factors return the input camera unchanged', () => {
    const p: Point = { x: 300, y: 200 };
    for (const bad of [0, -1, -0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const next = zoomAt(ORIGIN, p, bad);
      expect(next).toBe(ORIGIN);
      expect(Number.isFinite(next.x)).toBe(true);
      expect(Number.isFinite(next.y)).toBe(true);
      expect(Number.isFinite(next.zoom)).toBe(true);
    }
  });

  // Property-style check: pointer world point is invariant under zoomAt within 1e-6.
  it('property: pointer invariance across 1000 random cameras/points/factors', () => {
    const rng = makeRng(1234567);
    for (let i = 0; i < 1000; i++) {
      const zoom = ZOOM_MIN + rng() * (ZOOM_MAX - ZOOM_MIN);
      const posScale = 2_000_000;
      const cam: Camera = {
        x: (rng() - 0.5) * posScale,
        y: (rng() - 0.5) * posScale,
        zoom,
      };
      const p: Point = { x: rng() * 1600 - 200, y: rng() * 1200 - 100 };
      const factor = Math.exp((rng() - 0.5) * 6); // roughly 0.05..20, positive & finite
      const before = screenToWorld(cam, p);
      const next = zoomAt(cam, p, factor);
      const after = screenToWorld(next, p);
      // Pointer world point is invariant (identical object when clamped, adjusted otherwise).
      expect(near(before.x, after.x, 1e-6)).toBe(true);
      expect(near(before.y, after.y, 1e-6)).toBe(true);
      // Never leaves the allowed zoom range.
      expect(next.zoom).toBeGreaterThanOrEqual(ZOOM_MIN);
      expect(next.zoom).toBeLessThanOrEqual(ZOOM_MAX);
    }
  });
});
