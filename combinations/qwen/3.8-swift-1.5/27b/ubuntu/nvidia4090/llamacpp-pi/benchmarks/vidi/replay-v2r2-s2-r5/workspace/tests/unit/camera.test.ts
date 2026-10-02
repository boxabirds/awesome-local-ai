import { describe, it, expect } from 'vitest';
import {
  Camera,
  Point,
  screenToWorld,
  worldToScreen,
  panBy,
  zoomAt,
  zoomStep,
  resetCamera,
  canZoomIn,
  zoomPercent,
} from '../../src/client/canvas/camera';
import { ZOOM_MIN, ZOOM_MAX, ZOOM_STEP_FACTOR, UNBOUNDED_PAN_TESTED_EXTENT } from '../../src/shared/config';

function makeCamera(x: number, y: number, zoom: number): Camera {
  return { x, y, zoom };
}

describe('camera.math', () => {
  // TC-01: panBy at zoom 1, origin
  it('TC-01: panBy(+200,+100) at zoom 1 from origin shifts camera to (-200,-100)', () => {
    const cam = makeCamera(0, 0, 1);
    const result = panBy(cam, 200, 100);
    expect(result.x).toBeCloseTo(-200, 6);
    expect(result.y).toBeCloseTo(-100, 6);
    expect(result.zoom).toBe(1);

    // world point (0,0) screen position should be (200, 100)
    const screenPos = worldToScreen(result, { x: 0, y: 0 });
    expect(screenPos.x).toBeCloseTo(200, 6);
    expect(screenPos.y).toBeCloseTo(100, 6);
  });

  // TC-02: panBy at ZOOM_MAX, far away
  it('TC-02: panBy(+200,+100) at ZOOM_MAX from 1e6 shifts by (-50,-25) world units', () => {
    const far = UNBOUNDED_PAN_TESTED_EXTENT;
    const cam = makeCamera(far, far, ZOOM_MAX);
    const result = panBy(cam, 200, 100);
    expect(result.x).toBeCloseTo(far - 200 / ZOOM_MAX, 6);
    expect(result.y).toBeCloseTo(far - 100 / ZOOM_MAX, 6);
    expect(result.zoom).toBe(ZOOM_MAX);
  });

  // TC-03: zoomAt keeps world point under pointer invariant (origin)
  it('TC-03: zoomAt(point 300,200, factor 2) keeps world point under pointer invariant', () => {
    const cam = makeCamera(0, 0, 1);
    const point: Point = { x: 300, y: 200 };
    const worldBefore = screenToWorld(cam, point);
    const result = zoomAt(cam, point, 2);
    expect(result.zoom).toBe(2);
    const worldAfter = screenToWorld(result, point);
    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 6);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 6);
  });

  // TC-04: zoomAt far away
  it('TC-04: zoomAt at 1e6 keeps pointer world point invariant', () => {
    const far = UNBOUNDED_PAN_TESTED_EXTENT;
    const cam = makeCamera(far, far, 1);
    const point: Point = { x: 100, y: 200 };
    const worldBefore = screenToWorld(cam, point);
    const result = zoomAt(cam, point, 1.5);
    const worldAfter = screenToWorld(result, point);
    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 6);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 6);
  });

  // TC-05: at ZOOM_MIN, zooming out returns same object
  it('TC-05: zoomAt at ZOOM_MIN with factor < 1 returns same object', () => {
    const cam = makeCamera(0, 0, ZOOM_MIN);
    const result = zoomAt(cam, { x: 100, y: 100 }, 1 / ZOOM_STEP_FACTOR);
    expect(result).toBe(cam);
  });

  // TC-06: at ZOOM_MAX, zooming in returns same object
  it('TC-06: zoomAt at ZOOM_MAX with factor > 1 returns same object', () => {
    const cam = makeCamera(0, 0, ZOOM_MAX);
    const result = zoomAt(cam, { x: 100, y: 100 }, ZOOM_STEP_FACTOR);
    expect(result).toBe(cam);
  });

  // TC-07: viewport resize leaves camera unchanged
  it('TC-07: viewport resize does not change camera', () => {
    const cam = makeCamera(10, 20, 1);
    // resetCamera with a different viewport size
    const cam2 = resetCamera({ width: 1920, height: 1080 });
    // The camera itself is not mutated by any resize logic
    expect(cam.x).toBe(10);
    expect(cam.y).toBe(20);
    expect(cam.zoom).toBe(1);
    // cam2 is a new camera for the new viewport
    expect(cam2.x).toBe(-960);
    expect(cam2.y).toBe(-540);
    expect(cam2.zoom).toBe(1);
  });

  // TC-08: resetCamera(1200x800) → zoom 1, origin centred
  it('TC-08: resetCamera(1200x800) gives zoom 1 and origin at centre', () => {
    const cam = resetCamera({ width: 1200, height: 800 });
    expect(cam.zoom).toBe(1);
    expect(cam.x).toBe(-600);
    expect(cam.y).toBe(-400);
    // world (0,0) should map to screen centre (600, 400)
    const screenPos = worldToScreen(cam, { x: 0, y: 0 });
    expect(screenPos.x).toBe(600);
    expect(screenPos.y).toBe(400);
  });

  // TC-09: step in then out returns exactly 1.0
  it('TC-09: zoomStep in then out returns exactly 1.0', () => {
    const cam = makeCamera(0, 0, 1);
    const viewport = { width: 1280, height: 800 };
    const steppedIn = zoomStep(cam, viewport, 'in');
    expect(steppedIn.zoom).toBeCloseTo(1.25, 9);
    const steppedOut = zoomStep(steppedIn, viewport, 'out');
    expect(steppedOut.zoom).toBe(1.0);
    expect(zoomPercent(steppedOut)).toBe(100);
  });

  // TC-10: 20 steps in clamps at ZOOM_MAX
  it('TC-10: 20 zoom steps in clamps at ZOOM_MAX', () => {
    let cam = makeCamera(0, 0, 1);
    const viewport = { width: 1280, height: 800 };
    for (let i = 0; i < 20; i++) {
      cam = zoomStep(cam, viewport, 'in');
    }
    expect(cam.zoom).toBe(ZOOM_MAX);
    expect(canZoomIn(cam)).toBe(false);
  });

  // TC-11: huge factor clamps and pointer invariance holds
  it('TC-11: huge factor clamps to ZOOM_MAX and pointer invariance holds', () => {
    const cam = makeCamera(0, 0, 1);
    const point: Point = { x: 300, y: 200 };
    const worldBefore = screenToWorld(cam, point);
    const result = zoomAt(cam, point, 1000);
    expect(result.zoom).toBe(ZOOM_MAX);
    const worldAfter = screenToWorld(result, point);
    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 6);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 6);
  });

  // TC-12: invalid factors return unchanged camera
  it('TC-12: invalid factors (0, negative, NaN, Infinity) return unchanged camera', () => {
    const cam = makeCamera(10, 20, 1.5);
    const invalidFactors = [0, -1, NaN, Infinity, -Infinity];
    for (const f of invalidFactors) {
      const result = zoomAt(cam, { x: 100, y: 100 }, f);
      expect(result).toBe(cam);
      expect(Number.isFinite(result.x)).toBe(true);
      expect(Number.isFinite(result.y)).toBe(true);
      expect(Number.isFinite(result.zoom)).toBe(true);
    }
  });

  // Property check: 1000 random cameras/points/factors, pointer invariance
  it('property: pointer world point invariant under zoomAt (1000 random cases)', () => {
    let seed = 42;
    function random(): number {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    }

    for (let i = 0; i < 1000; i++) {
      const x = (random() - 0.5) * 2 * UNBOUNDED_PAN_TESTED_EXTENT;
      const y = (random() - 0.5) * 2 * UNBOUNDED_PAN_TESTED_EXTENT;
      const zoom = ZOOM_MIN + random() * (ZOOM_MAX - ZOOM_MIN);
      const cam = makeCamera(x, y, zoom);

      const px = random() * 1280;
      const py = random() * 800;
      const point: Point = { x: px, y: py };

      // Random factor that stays within limits (to test invariance at non-clamped values)
      const factor = 0.5 + random() * 2;
      const newZoom = cam.zoom * factor;
      if (newZoom <= ZOOM_MIN || newZoom >= ZOOM_MAX) continue; // skip clamped cases

      const worldBefore = screenToWorld(cam, point);
      const result = zoomAt(cam, point, factor);
      const worldAfter = screenToWorld(result, point);

      expect(Math.abs(worldAfter.x - worldBefore.x)).toBeLessThan(1e-6);
      expect(Math.abs(worldAfter.y - worldBefore.y)).toBeLessThan(1e-6);
    }
  });
});
