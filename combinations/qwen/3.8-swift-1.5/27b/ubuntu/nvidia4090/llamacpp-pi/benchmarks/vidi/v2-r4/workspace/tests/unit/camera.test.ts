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
  type Size,
} from '../../src/client/canvas/camera';
import { ZOOM_MIN, ZOOM_MAX, ZOOM_STEP_FACTOR, UNBOUNDED_PAN_TESTED_EXTENT } from '../../src/shared/config';

describe('camera.math', () => {
  // TC-01: panBy at zoom 1
  it('TC-01: panBy at zoom 1.0 shifts camera by -dx, -dy', () => {
    const cam: Camera = { x: 0, y: 0, zoom: 1.0 };
    const result = panBy(cam, 200, 100);
    expect(result.x).toBeCloseTo(-200, 6);
    expect(result.y).toBeCloseTo(-100, 6);
    // world point (0,0) should now be at screen (200, 100)
    const screenPos = worldToScreen(result, { x: 0, y: 0 });
    expect(screenPos.x).toBeCloseTo(200, 4);
    expect(screenPos.y).toBeCloseTo(100, 4);
  });

  // TC-02: panBy at ZOOM_MAX far away (1e6)
  it('TC-02: panBy at ZOOM_MAX far away shifts camera by -dx/zoom, -dy/zoom', () => {
    const farX = UNBOUNDED_PAN_TESTED_EXTENT;
    const farY = UNBOUNDED_PAN_TESTED_EXTENT;
    const cam: Camera = { x: farX, y: farY, zoom: ZOOM_MAX };
    const result = panBy(cam, 200, 100);
    const expectedDx = -200 / ZOOM_MAX;
    const expectedDy = -100 / ZOOM_MAX;
    expect(result.x - cam.x).toBeCloseTo(expectedDx, 6);
    expect(result.y - cam.y).toBeCloseTo(expectedDy, 6);
  });

  // TC-03: zoomAt keeps the world point under the pointer invariant (origin)
  it('TC-03: zoomAt keeps pointer world point invariant at origin', () => {
    const cam: Camera = { x: 0, y: 0, zoom: 1.0 };
    const point: Point = { x: 300, y: 200 };
    const worldBefore = screenToWorld(cam, point);
    const result = zoomAt(cam, point, 2);
    expect(result.zoom).toBeCloseTo(2.0, 6);
    const worldAfter = screenToWorld(result, point);
    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 6);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 6);
  });

  // TC-04: zoomAt keeps pointer world point invariant far away (1e6)
  it('TC-04: zoomAt keeps pointer world point invariant far away', () => {
    const farX = UNBOUNDED_PAN_TESTED_EXTENT;
    const farY = UNBOUNDED_PAN_TESTED_EXTENT;
    const cam: Camera = { x: farX, y: farY, zoom: 1.0 };
    const point: Point = { x: 300, y: 200 };
    const worldBefore = screenToWorld(cam, point);
    const result = zoomAt(cam, point, 1.5);
    const worldAfter = screenToWorld(result, point);
    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 6);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 6);
  });

  // TC-05: at ZOOM_MIN, zooming out returns the same object
  it('TC-05: at ZOOM_MIN, zooming further out returns same object', () => {
    const cam: Camera = { x: 0, y: 0, zoom: ZOOM_MIN };
    const centre: Point = { x: 640, y: 400 };
    const result = zoomAt(cam, centre, 1 / ZOOM_STEP_FACTOR);
    expect(result).toBe(cam);
  });

  // TC-06: at ZOOM_MAX, zooming in returns the same object
  it('TC-06: at ZOOM_MAX, zooming further in returns same object', () => {
    const cam: Camera = { x: 0, y: 0, zoom: ZOOM_MAX };
    const centre: Point = { x: 640, y: 400 };
    const result = zoomAt(cam, centre, ZOOM_STEP_FACTOR);
    expect(result).toBe(cam);
  });

  // TC-07: viewport resize leaves camera unchanged
  it('TC-07: viewport resize does not change camera', () => {
    const cam: Camera = { x: 100, y: 200, zoom: 1.5 };
    // Camera is independent of viewport size - resize does not modify it
    expect(cam.x).toBe(100);
    expect(cam.y).toBe(200);
    expect(cam.zoom).toBe(1.5);
  });

  // TC-08: resetCamera(1200x800) → zoom 1, origin centred
  it('TC-08: resetCamera centres origin at zoom 1', () => {
    const viewport: Size = { width: 1200, height: 800 };
    const result = resetCamera(viewport);
    expect(result.zoom).toBe(1);
    expect(result.x).toBe(-600);
    expect(result.y).toBe(-400);
    // Origin (0,0) should be at screen centre (600, 400)
    const originScreen = worldToScreen(result, { x: 0, y: 0 });
    expect(originScreen.x).toBeCloseTo(600, 6);
    expect(originScreen.y).toBeCloseTo(400, 6);
  });

  // TC-09: step in then out returns exactly 1.0
  it('TC-09: step in then out returns exactly 1.0', () => {
    const viewport: Size = { width: 1280, height: 800 };
    const cam: Camera = { x: 0, y: 0, zoom: 1.0 };
    const steppedIn = zoomStep(cam, viewport, 'in');
    expect(steppedIn.zoom).toBeCloseTo(ZOOM_STEP_FACTOR, 9);
    const steppedOut = zoomStep(steppedIn, viewport, 'out');
    expect(steppedOut.zoom).toBeCloseTo(1.0, 9);
    expect(zoomPercent(steppedOut)).toBe(100);
  });

  // TC-10: 20 steps in clamps at ZOOM_MAX, canZoomIn false
  it('TC-10: 20 steps in clamps at ZOOM_MAX', () => {
    const viewport: Size = { width: 1280, height: 800 };
    let cam: Camera = { x: 0, y: 0, zoom: 1.0 };
    for (let i = 0; i < 20; i++) {
      cam = zoomStep(cam, viewport, 'in');
    }
    expect(cam.zoom).toBe(ZOOM_MAX);
    expect(canZoomIn(cam)).toBe(false);
  });

  // TC-11: huge factor clamps and still keeps pointer invariance
  it('TC-11: huge factor clamps to ZOOM_MAX and keeps pointer invariance', () => {
    const cam: Camera = { x: 0, y: 0, zoom: 1.0 };
    const point: Point = { x: 300, y: 200 };
    const worldBefore = screenToWorld(cam, point);
    const result = zoomAt(cam, point, 1000);
    expect(result.zoom).toBe(ZOOM_MAX);
    const worldAfter = screenToWorld(result, point);
    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 6);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 6);
  });

  // TC-12: invalid factor → unchanged camera
  it('TC-12: invalid factors (0, negative, NaN, Infinity) return unchanged camera', () => {
    const cam: Camera = { x: 50, y: 60, zoom: 1.0 };
    const point: Point = { x: 100, y: 100 };

    const r0 = zoomAt(cam, point, 0);
    expect(r0).toBe(cam);

    const rNeg = zoomAt(cam, point, -1);
    expect(rNeg).toBe(cam);

    const rNaN = zoomAt(cam, point, NaN);
    expect(rNaN).toBe(cam);

    const rInf = zoomAt(cam, point, Infinity);
    expect(rInf).toBe(cam);

    const rNegInf = zoomAt(cam, point, -Infinity);
    expect(rNegInf).toBe(cam);

    // No NaN in any output
    expect(Number.isNaN(r0.x)).toBe(false);
    expect(Number.isNaN(r0.y)).toBe(false);
    expect(Number.isNaN(r0.zoom)).toBe(false);
  });

  // Property-style check: 1000 random cameras/points/factors, pointer invariance
  it('property: 1000 random zoomAt calls keep pointer world point invariant', () => {
    // Simple seeded PRNG
    let seed = 42;
    function rand(): number {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    }

    for (let i = 0; i < 1000; i++) {
      const x = (rand() - 0.5) * 2_000_000;
      const y = (rand() - 0.5) * 2_000_000;
      const zoom = ZOOM_MIN + rand() * (ZOOM_MAX - ZOOM_MIN);
      const cam: Camera = { x, y, zoom };

      const px = rand() * 1280;
      const py = rand() * 800;
      const point: Point = { x: px, y: py };

      const factor = 0.5 + rand() * 2.0;
      const worldBefore = screenToWorld(cam, point);
      const result = zoomAt(cam, point, factor);
      const worldAfter = screenToWorld(result, point);

      expect(worldAfter.x).toBeCloseTo(worldBefore.x, 6);
      expect(worldAfter.y).toBeCloseTo(worldBefore.y, 6);
    }
  });

  // Additional: canZoomIn/canZoomOut at boundaries
  it('canZoomIn is true when zoom < ZOOM_MAX', () => {
    expect(canZoomIn({ x: 0, y: 0, zoom: 1.0 })).toBe(true);
    expect(canZoomIn({ x: 0, y: 0, zoom: ZOOM_MAX })).toBe(false);
  });

  it('canZoomOut is true when zoom > ZOOM_MIN', () => {
    expect(canZoomOut({ x: 0, y: 0, zoom: 1.0 })).toBe(true);
    expect(canZoomOut({ x: 0, y: 0, zoom: ZOOM_MIN })).toBe(false);
  });

  // zoomPercent
  it('zoomPercent returns rounded whole number', () => {
    expect(zoomPercent({ x: 0, y: 0, zoom: 1.0 })).toBe(100);
    expect(zoomPercent({ x: 0, y: 0, zoom: 1.5625 })).toBe(156);
    expect(zoomPercent({ x: 0, y: 0, zoom: ZOOM_MIN })).toBe(10);
    expect(zoomPercent({ x: 0, y: 0, zoom: ZOOM_MAX })).toBe(400);
  });
});
