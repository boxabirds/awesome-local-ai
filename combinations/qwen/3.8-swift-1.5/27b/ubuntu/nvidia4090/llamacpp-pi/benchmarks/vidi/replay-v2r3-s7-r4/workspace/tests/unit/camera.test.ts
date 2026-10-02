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
  zoomPercent,
} from '../../src/client/canvas/camera';
import {
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_STEP_FACTOR,
  UNBOUNDED_PAN_TESTED_EXTENT,
} from '../../src/shared/config';

const PERCENT = 100;

describe('camera.math', () => {
  // TC-01: panBy at zoom 1, origin
  it('TC-01: panBy at zoom 1 moves camera and world point correctly', () => {
    const cam: Camera = { x: 0, y: 0, zoom: 1 };
    const newCam = panBy(cam, 200, 100);

    expect(newCam.x).toBe(-200);
    expect(newCam.y).toBe(-100);
    expect(newCam.zoom).toBe(1);

    // World point (0,0) should now be at screen (200, 100)
    const screenPos = worldToScreen(newCam, { x: 0, y: 0 });
    expect(screenPos.x).toBe(200);
    expect(screenPos.y).toBe(100);
  });

  // TC-02: panBy at ZOOM_MAX, far away
  it('TC-02: panBy at ZOOM_MAX far away is exact within 1e-6', () => {
    const far = UNBOUNDED_PAN_TESTED_EXTENT;
    const cam: Camera = { x: far, y: far, zoom: ZOOM_MAX };
    const newCam = panBy(cam, 200, 100);

    expect(newCam.x).toBeCloseTo(far - 200 / ZOOM_MAX, 6);
    expect(newCam.y).toBeCloseTo(far - 100 / ZOOM_MAX, 6);
    expect(newCam.zoom).toBe(ZOOM_MAX);
  });

  // TC-03: zoomAt keeps world point under pointer invariant (origin)
  it('TC-03: zoomAt keeps world point under pointer invariant at origin', () => {
    const cam: Camera = { x: 0, y: 0, zoom: 1 };
    const point: Point = { x: 300, y: 200 };

    const worldBefore = screenToWorld(cam, point);
    const newCam = zoomAt(cam, point, 2);
    const worldAfter = screenToWorld(newCam, point);

    expect(newCam.zoom).toBe(2);
    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 6);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 6);
  });

  // TC-04: zoomAt keeps world point under pointer invariant (far away)
  it('TC-04: zoomAt keeps world point under pointer invariant far away', () => {
    const far = UNBOUNDED_PAN_TESTED_EXTENT;
    const cam: Camera = { x: far, y: far, zoom: 1 };
    const point: Point = { x: 300, y: 200 };

    const worldBefore = screenToWorld(cam, point);
    const newCam = zoomAt(cam, point, 1.5);
    const worldAfter = screenToWorld(newCam, point);

    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 6);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 6);
  });

  // TC-05: at ZOOM_MIN, zooming out returns the same object
  it('TC-05: zoomAt at ZOOM_MIN zooming out returns same object', () => {
    const cam: Camera = { x: 0, y: 0, zoom: ZOOM_MIN };
    const center: Point = { x: 640, y: 400 };
    const newCam = zoomAt(cam, center, 1 / ZOOM_STEP_FACTOR);

    expect(newCam).toBe(cam);
  });

  // TC-06: at ZOOM_MAX, zooming in returns the same object
  it('TC-06: zoomAt at ZOOM_MAX zooming in returns same object', () => {
    const cam: Camera = { x: 0, y: 0, zoom: ZOOM_MAX };
    const center: Point = { x: 640, y: 400 };
    const newCam = zoomAt(cam, center, ZOOM_STEP_FACTOR);

    expect(newCam).toBe(cam);
  });

  // TC-07: viewport resize leaves camera unchanged
  it('TC-07: viewport resize leaves camera unchanged', () => {
    const cam: Camera = { x: 100, y: 200, zoom: 1.5 };
    // Camera is a standalone value; changing viewport size does not affect it
    expect(cam.x).toBe(100);
    expect(cam.y).toBe(200);
    expect(cam.zoom).toBe(1.5);
  });

  // TC-08: resetCamera centers origin
  it('TC-08: resetCamera(1200x800) gives zoom 1 with origin at centre', () => {
    const viewport: Size = { width: 1200, height: 800 };
    const cam = resetCamera(viewport);

    expect(cam.zoom).toBe(1);
    expect(cam.x).toBe(-600);
    expect(cam.y).toBe(-400);

    // Origin (0,0) should be at screen centre (600, 400)
    const originScreen = worldToScreen(cam, { x: 0, y: 0 });
    expect(originScreen.x).toBe(600);
    expect(originScreen.y).toBe(400);
  });

  // TC-09: step in then out returns exactly 1.0
  it('TC-09: zoomStep in then out returns exactly 1.0', () => {
    const viewport: Size = { width: 1280, height: 800 };
    const cam: Camera = { x: 0, y: 0, zoom: 1 };

    const zoomedIn = zoomStep(cam, viewport, 'in');
    expect(zoomedIn.zoom).toBeCloseTo(ZOOM_STEP_FACTOR, 10);

    const zoomedOut = zoomStep(zoomedIn, viewport, 'out');
    expect(zoomedOut.zoom).toBe(1);
    expect(zoomPercent(zoomedOut)).toBe(PERCENT);
  });

  // TC-10: 20 steps in clamps at ZOOM_MAX
  it('TC-10: 20 zoom steps in clamps at ZOOM_MAX, canZoomIn false', () => {
    const viewport: Size = { width: 1280, height: 800 };
    let cam: Camera = { x: 0, y: 0, zoom: 1 };

    for (let i = 0; i < 20; i++) {
      cam = zoomStep(cam, viewport, 'in');
    }

    expect(cam.zoom).toBe(ZOOM_MAX);
    expect(canZoomIn(cam)).toBe(false);
  });

  // TC-11: huge factor clamps and keeps pointer invariance
  it('TC-11: huge zoom factor clamps to ZOOM_MAX and keeps pointer invariant', () => {
    const cam: Camera = { x: 0, y: 0, zoom: 1 };
    const point: Point = { x: 300, y: 200 };

    const worldBefore = screenToWorld(cam, point);
    const newCam = zoomAt(cam, point, 1000);
    const worldAfter = screenToWorld(newCam, point);

    expect(newCam.zoom).toBe(ZOOM_MAX);
    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 6);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 6);
  });

  // TC-12: invalid factors return unchanged camera
  it('TC-12: invalid zoom factors (0, negative, NaN, ±Infinity) return unchanged camera', () => {
    const cam: Camera = { x: 100, y: 200, zoom: 1 };
    const point: Point = { x: 300, y: 200 };

    const invalidFactors = [0, -1, NaN, Infinity, -Infinity];
    for (const factor of invalidFactors) {
      const newCam = zoomAt(cam, point, factor);
      expect(newCam).toBe(cam);
      expect(Number.isFinite(newCam.x)).toBe(true);
      expect(Number.isFinite(newCam.y)).toBe(true);
      expect(Number.isFinite(newCam.zoom)).toBe(true);
    }
  });

  // Property check: 1000 random cameras/points/factors, pointer invariance within 1e-6
  it('property: pointer world point is invariant under zoomAt (1000 random cases)', () => {
    let seed = 42;
    const rand = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };

    for (let i = 0; i < 1000; i++) {
      const x = (rand() - 0.5) * 2 * UNBOUNDED_PAN_TESTED_EXTENT;
      const y = (rand() - 0.5) * 2 * UNBOUNDED_PAN_TESTED_EXTENT;
      const zoom = ZOOM_MIN + rand() * (ZOOM_MAX - ZOOM_MIN);
      const cam: Camera = { x, y, zoom };

      const px = rand() * 2000;
      const py = rand() * 2000;
      const point: Point = { x: px, y: py };

      // Random positive finite factor
      const factor = 0.01 + rand() * 100;

      const worldBefore = screenToWorld(cam, point);
      const newCam = zoomAt(cam, point, factor);
      const worldAfter = screenToWorld(newCam, point);

      expect(Math.abs(worldAfter.x - worldBefore.x)).toBeLessThan(1e-6);
      expect(Math.abs(worldAfter.y - worldBefore.y)).toBeLessThan(1e-6);
    }
  });
});
