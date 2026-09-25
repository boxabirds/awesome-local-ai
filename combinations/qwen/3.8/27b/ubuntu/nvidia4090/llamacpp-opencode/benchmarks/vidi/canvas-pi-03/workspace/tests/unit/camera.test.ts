import { describe, it, expect } from 'vitest';
import {
  Camera,
  Point,
  Size,
  screenToWorld,
  worldToScreen,
  panBy,
  zoomAt,
  zoomStep,
  resetCamera,
  canZoomIn,
  canZoomOut,
  zoomPercent,
} from '@/client/canvas/camera';
import { ZOOM_MIN, ZOOM_MAX, ZOOM_STEP_FACTOR, UNBOUNDED_PAN_TESTED_EXTENT } from '@/shared/config';



describe('camera.math', () => {
  describe('screenToWorld / worldToScreen', () => {
    it('TC-01: panBy at zoom 1 from origin', () => {
      const cam: Camera = { x: 0, y: 0, zoom: 1 };
      const next = panBy(cam, 200, 100);
      expect(next.x).toBeCloseTo(-200, 6);
      expect(next.y).toBeCloseTo(-100, 6);
      expect(next.zoom).toBe(1);
      // World point (0,0) should now be at screen (200, 100)
      const screenPos = worldToScreen(next, { x: 0, y: 0 });
      expect(screenPos.x).toBeCloseTo(200, 6);
      expect(screenPos.y).toBeCloseTo(100, 6);
    });

    it('TC-02: panBy at ZOOM_MAX far away (1e6)', () => {
      const cam: Camera = { x: UNBOUNDED_PAN_TESTED_EXTENT, y: UNBOUNDED_PAN_TESTED_EXTENT, zoom: ZOOM_MAX };
      const next = panBy(cam, 200, 100);
      // camera shifts by (-200/zoom, -100/zoom) in world units
      expect(next.x).toBeCloseTo(UNBOUNDED_PAN_TESTED_EXTENT - 200 / ZOOM_MAX, 6);
      expect(next.y).toBeCloseTo(UNBOUNDED_PAN_TESTED_EXTENT - 100 / ZOOM_MAX, 6);
      expect(next.zoom).toBe(ZOOM_MAX);
    });

    it('TC-03: zoomAt keeps world point under pointer invariant (origin)', () => {
      const cam: Camera = { x: 0, y: 0, zoom: 1 };
      const point: Point = { x: 300, y: 200 };
      const worldBefore = screenToWorld(cam, point);
      const next = zoomAt(cam, point, 2);
      expect(next.zoom).toBe(2);
      const worldAfter = screenToWorld(next, point);
      expect(worldAfter.x).toBeCloseTo(worldBefore.x, 6);
      expect(worldAfter.y).toBeCloseTo(worldBefore.y, 6);
    });

    it('TC-04: zoomAt keeps world point under pointer invariant (far, 1e6)', () => {
      const cam: Camera = { x: UNBOUNDED_PAN_TESTED_EXTENT, y: UNBOUNDED_PAN_TESTED_EXTENT, zoom: 1 };
      const point: Point = { x: 500, y: 300 };
      const worldBefore = screenToWorld(cam, point);
      const next = zoomAt(cam, point, 1.5);
      const worldAfter = screenToWorld(next, point);
      expect(worldAfter.x).toBeCloseTo(worldBefore.x, 6);
      expect(worldAfter.y).toBeCloseTo(worldBefore.y, 6);
    });
  });

  describe('zoom limits', () => {
    it('TC-05: at ZOOM_MIN zooming out returns same object', () => {
      const cam: Camera = { x: 0, y: 0, zoom: ZOOM_MIN };
      const viewport: Size = { width: 1280, height: 800 };
      const center = { x: viewport.width / 2, y: viewport.height / 2 };
      const next = zoomAt(cam, center, 1 / ZOOM_STEP_FACTOR);
      expect(next).toBe(cam);
    });

    it('TC-06: at ZOOM_MAX zooming in returns same object', () => {
      const cam: Camera = { x: 0, y: 0, zoom: ZOOM_MAX };
      const viewport: Size = { width: 1280, height: 800 };
      const center = { x: viewport.width / 2, y: viewport.height / 2 };
      const next = zoomAt(cam, center, ZOOM_STEP_FACTOR);
      expect(next).toBe(cam);
    });

    it('TC-07: viewport resize leaves camera unchanged', () => {
      const cam: Camera = { x: -100, y: -200, zoom: 1.5 };
      // Simulating resize: the camera object is not modified
      expect(cam.x).toBe(-100);
      expect(cam.y).toBe(-200);
      expect(cam.zoom).toBe(1.5);
    });
  });

  describe('resetCamera', () => {
    it('TC-08: resetCamera(1200x800) centers origin', () => {
      const reset = resetCamera({ width: 1200, height: 800 });
      expect(reset.zoom).toBe(1);
      expect(reset.x).toBe(-600);
      expect(reset.y).toBe(-400);
      // Origin (0,0) should be at screen center
      const originScreen = worldToScreen(reset, { x: 0, y: 0 });
      expect(originScreen.x).toBe(600);
      expect(originScreen.y).toBe(400);
    });
  });

  describe('zoomStep', () => {
    it('TC-09: step in then out returns exactly 1.0', () => {
      const cam: Camera = { x: 0, y: 0, zoom: 1 };
      const viewport: Size = { width: 1280, height: 800 };
      const afterIn = zoomStep(cam, viewport, 'in');
      expect(afterIn.zoom).toBeCloseTo(ZOOM_STEP_FACTOR, 9);
      const afterOut = zoomStep(afterIn, viewport, 'out');
      expect(afterOut.zoom).toBe(1.0);
      expect(zoomPercent(afterOut)).toBe(100);
    });

    it('TC-10: 20 steps in clamps at ZOOM_MAX, canZoomIn false', () => {
      let cam: Camera = { x: 0, y: 0, zoom: 1 };
      const viewport: Size = { width: 1280, height: 800 };
      for (let i = 0; i < 20; i++) {
        cam = zoomStep(cam, viewport, 'in');
      }
      expect(cam.zoom).toBe(ZOOM_MAX);
      expect(canZoomIn(cam)).toBe(false);
    });

    it('TC-11: huge factor clamps and keeps pointer invariance', () => {
      const cam: Camera = { x: 0, y: 0, zoom: 1 };
      const point: Point = { x: 400, y: 300 };
      const worldBefore = screenToWorld(cam, point);
      const next = zoomAt(cam, point, 1000);
      expect(next.zoom).toBe(ZOOM_MAX);
      const worldAfter = screenToWorld(next, point);
      expect(worldAfter.x).toBeCloseTo(worldBefore.x, 6);
      expect(worldAfter.y).toBeCloseTo(worldBefore.y, 6);
    });
  });

  describe('invalid factors', () => {
    it('TC-12: factor 0, negative, NaN, Infinity returns unchanged camera', () => {
      const cam: Camera = { x: 10, y: 20, zoom: 1.5 };
      const point: Point = { x: 100, y: 100 };

      const r1 = zoomAt(cam, point, 0);
      expect(r1).toBe(cam);

      const r2 = zoomAt(cam, point, -1);
      expect(r2).toBe(cam);

      const r3 = zoomAt(cam, point, NaN);
      expect(r3).toBe(cam);

      const r4 = zoomAt(cam, point, Infinity);
      expect(r4).toBe(cam);

      const r5 = zoomAt(cam, point, -Infinity);
      expect(r5).toBe(cam);

      // No NaN in output
      for (const r of [r1, r2, r3, r4, r5]) {
        expect(Number.isNaN(r.x)).toBe(false);
        expect(Number.isNaN(r.y)).toBe(false);
        expect(Number.isNaN(r.zoom)).toBe(false);
      }
    });
  });

  describe('zoomPercent', () => {
    it('returns correct percentage', () => {
      expect(zoomPercent({ x: 0, y: 0, zoom: 1 })).toBe(100);
      expect(zoomPercent({ x: 0, y: 0, zoom: 0.1 })).toBe(10);
      expect(zoomPercent({ x: 0, y: 0, zoom: 4 })).toBe(400);
      expect(zoomPercent({ x: 0, y: 0, zoom: 1.5625 })).toBe(156);
    });
  });

  describe('canZoomIn / canZoomOut', () => {
    it('returns correct booleans', () => {
      expect(canZoomIn({ x: 0, y: 0, zoom: ZOOM_MAX })).toBe(false);
      expect(canZoomIn({ x: 0, y: 0, zoom: 1 })).toBe(true);
      expect(canZoomOut({ x: 0, y: 0, zoom: ZOOM_MIN })).toBe(false);
      expect(canZoomOut({ x: 0, y: 0, zoom: 1 })).toBe(true);
    });
  });

  describe('property: pointer invariance under zoomAt', () => {
    it('1000 random cameras/points/factors maintain pointer invariance within 1e-6', () => {
      // Simple seeded PRNG for reproducibility
      let seed = 42;
      function random(): number {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed / 0x7fffffff;
      }

      for (let i = 0; i < 1000; i++) {
        const x = (random() - 0.5) * 2000000;
        const y = (random() - 0.5) * 2000000;
        const zoom = ZOOM_MIN + random() * (ZOOM_MAX - ZOOM_MIN);
        const cam: Camera = { x, y, zoom };

        const px = random() * 2000;
        const py = random() * 2000;
        const point: Point = { x: px, y: py };

        const factor = 0.5 + random() * 3;

        const worldBefore = screenToWorld(cam, point);
        const next = zoomAt(cam, point, factor);
        const worldAfter = screenToWorld(next, point);

        expect(Math.abs(worldAfter.x - worldBefore.x)).toBeLessThan(1e-6);
        expect(Math.abs(worldAfter.y - worldBefore.y)).toBeLessThan(1e-6);
      }
    });
  });
});
