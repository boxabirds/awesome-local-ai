import { describe, it, expect } from 'vitest';
import {
  type Camera,
  type Point,
  type Size,
  screenToWorld,
  worldToScreen,
  panBy,
  zoomAt,
  zoomStep,
  resetCamera,
  canZoomIn,
  canZoomOut,
  zoomPercent,
} from '../../src/client/canvas/camera';
import {
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_STEP_FACTOR,
  UNBOUNDED_PAN_TESTED_EXTENT,
} from '../../src/shared/config';

const ORIGIN: Camera = { x: 0, y: 0, zoom: 1 };
const VIEWPORT: Size = { width: 1280, height: 800 };

function mulberry32(seed: number): () => number {
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
  it('TC-01: panBy(+200,+100) at zoom 1 from origin shifts camera by (-200,-100) and the world origin moves to (200,100) on screen', () => {
    const next = panBy(ORIGIN, 200, 100);
    expect(next.x).toBeCloseTo(-200, 6);
    expect(next.y).toBeCloseTo(-100, 6);
    expect(next.zoom).toBe(1);
    const screen = worldToScreen(next, { x: 0, y: 0 });
    expect(screen.x).toBeCloseTo(200, 6);
    expect(screen.y).toBeCloseTo(100, 6);
  });

  it('TC-02: panBy(+200,+100) at ZOOM_MAX far away shifts camera by (-50,-25) world units', () => {
    const far: Camera = { x: UNBOUNDED_PAN_TESTED_EXTENT, y: UNBOUNDED_PAN_TESTED_EXTENT, zoom: ZOOM_MAX };
    const next = panBy(far, 200, 100);
    expect(next.x).toBeCloseTo(UNBOUNDED_PAN_TESTED_EXTENT - 200 / ZOOM_MAX, 6);
    expect(next.y).toBeCloseTo(UNBOUNDED_PAN_TESTED_EXTENT - 100 / ZOOM_MAX, 6);
    expect(Math.abs(next.x - (UNBOUNDED_PAN_TESTED_EXTENT - 200 / ZOOM_MAX))).toBeLessThan(1e-6);
    expect(Math.abs(next.y - (UNBOUNDED_PAN_TESTED_EXTENT - 100 / ZOOM_MAX))).toBeLessThan(1e-6);
  });

  it('TC-03: zoomAt(point (300,200), factor 2) keeps the world point under the pointer invariant', () => {
    const p: Point = { x: 300, y: 200 };
    const before = screenToWorld(ORIGIN, p);
    const next = zoomAt(ORIGIN, p, 2);
    expect(next.zoom).toBeCloseTo(2, 6);
    const after = screenToWorld(next, p);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('TC-04: zoomAt(factor 1.5) far away keeps the pointer world point invariant within 1e-6', () => {
    const p: Point = { x: 400, y: 300 };
    const far: Camera = { x: UNBOUNDED_PAN_TESTED_EXTENT, y: UNBOUNDED_PAN_TESTED_EXTENT, zoom: 1 };
    const before = screenToWorld(far, p);
    const next = zoomAt(far, p, 1.5);
    const after = screenToWorld(next, p);
    expect(Math.abs(after.x - before.x)).toBeLessThan(1e-6);
    expect(Math.abs(after.y - before.y)).toBeLessThan(1e-6);
  });

  it('TC-05: zooming out at ZOOM_MIN returns the same object and leaves camera unchanged', () => {
    const atMin: Camera = { x: 0, y: 0, zoom: ZOOM_MIN };
    const centre: Point = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
    const next = zoomAt(atMin, centre, 1 / ZOOM_STEP_FACTOR);
    expect(next).toBe(atMin);
    expect(next.zoom).toBe(ZOOM_MIN);
    expect(next.x).toBe(atMin.x);
    expect(next.y).toBe(atMin.y);
  });

  it('TC-06: zooming in at ZOOM_MAX returns the same object and leaves camera unchanged', () => {
    const atMax: Camera = { x: 0, y: 0, zoom: ZOOM_MAX };
    const centre: Point = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
    const next = zoomAt(atMax, centre, ZOOM_STEP_FACTOR);
    expect(next).toBe(atMax);
    expect(next.zoom).toBe(ZOOM_MAX);
    expect(next.x).toBe(atMax.x);
    expect(next.y).toBe(atMax.y);
  });

  it('TC-07: viewport resize leaves an existing camera unchanged (camera maths does not depend on viewport size)', () => {
    const cam: Camera = { x: 100, y: -50, zoom: 1.5 };
    const snapshot: Camera = { ...cam };
    // Resize only affects zoomStep/reset inputs; existing camera transforms must not depend on size.
    screenToWorld(cam, { x: 10, y: 20 });
    worldToScreen(cam, { x: 10, y: 20 });
    panBy(cam, 40, -40);
    // A reset for a different viewport size produces its own camera; the original is untouched.
    resetCamera({ width: 640, height: 480 });
    resetCamera({ width: 1920, height: 1080 });
    expect(cam).toEqual(snapshot);
  });

  it('TC-08: resetCamera(1200x800) returns zoom 1 with world origin centred', () => {
    const cam = resetCamera({ width: 1200, height: 800 });
    expect(cam.zoom).toBe(1);
    expect(cam.x).toBe(-600);
    expect(cam.y).toBe(-400);
    const screen = worldToScreen(cam, { x: 0, y: 0 });
    expect(screen.x).toBeCloseTo(600, 6);
    expect(screen.y).toBeCloseTo(400, 6);
  });

  it('TC-09: one step in then one step out returns exactly 1.0 and label 100', () => {
    const inStep = zoomStep(ORIGIN, VIEWPORT, 'in');
    expect(inStep.zoom).toBeCloseTo(ZOOM_STEP_FACTOR, 6);
    expect(zoomPercent(inStep)).toBe(125);
    const outStep = zoomStep(inStep, VIEWPORT, 'out');
    expect(outStep.zoom).toBe(1);
    expect(zoomPercent(outStep)).toBe(100);
  });

  it('TC-10: 20 steps in clamps at ZOOM_MAX and canZoomIn is false', () => {
    let cam: Camera = ORIGIN;
    for (let i = 0; i < 20; i++) cam = zoomStep(cam, VIEWPORT, 'in');
    expect(cam.zoom).toBe(ZOOM_MAX);
    expect(canZoomIn(cam)).toBe(false);
    expect(canZoomOut(cam)).toBe(true);
  });

  it('TC-11: a huge zoom factor clamps to ZOOM_MAX and keeps pointer invariance', () => {
    const p: Point = { x: 500, y: 250 };
    const before = screenToWorld(ORIGIN, p);
    const next = zoomAt(ORIGIN, p, 1000);
    expect(next.zoom).toBe(ZOOM_MAX);
    const after = screenToWorld(next, p);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('TC-12: invalid factors (0, negative, NaN, ±Infinity) return the camera unchanged with no NaN', () => {
    const bad = [0, -1, -ZOOM_STEP_FACTOR, NaN, Infinity, -Infinity];
    for (const factor of bad) {
      const next = zoomAt(ORIGIN, { x: 100, y: 100 }, factor);
      expect(next).toBe(ORIGIN);
      expect(Number.isFinite(next.x)).toBe(true);
      expect(Number.isFinite(next.y)).toBe(true);
      expect(Number.isFinite(next.zoom)).toBe(true);
    }
  });

  it('property: 1,000 random cameras/points/factors keep the pointer world point invariant within 1e-6', () => {
    const rand = mulberry32(20260917);
    for (let i = 0; i < 1000; i++) {
      const zoom = ZOOM_MIN + rand() * (ZOOM_MAX - ZOOM_MIN);
      const cam: Camera = {
        x: (rand() * 2 - 1) * UNBOUNDED_PAN_TESTED_EXTENT,
        y: (rand() * 2 - 1) * UNBOUNDED_PAN_TESTED_EXTENT,
        zoom,
      };
      const p: Point = { x: rand() * VIEWPORT.width, y: rand() * VIEWPORT.height };
      const factor = Math.exp((rand() * 2 - 1) * 2);
      const before = screenToWorld(cam, p);
      const next = zoomAt(cam, p, factor);
      const after = screenToWorld(next, p);
      expect(Math.abs(after.x - before.x)).toBeLessThan(1e-6);
      expect(Math.abs(after.y - before.y)).toBeLessThan(1e-6);
    }
  });
});
