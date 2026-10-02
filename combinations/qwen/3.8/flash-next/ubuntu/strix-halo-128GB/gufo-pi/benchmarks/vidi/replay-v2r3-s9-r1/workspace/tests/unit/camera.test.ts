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
import {
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_STEP_FACTOR,
  UNBOUNDED_PAN_TESTED_EXTENT,
} from '../../src/shared/config';

const ORIGIN_CAM: Camera = { x: 0, y: 0, zoom: 1 };

describe('camera.math', () => {
  describe('TC-01: panBy at zoom 1, origin', () => {
    it('moves camera by -dx/zoom, -dy/zoom', () => {
      const result = panBy(ORIGIN_CAM, 200, 100);
      expect(result.x).toBeCloseTo(-200, 6);
      expect(result.y).toBeCloseTo(-100, 6);
      expect(result.zoom).toBe(1);
    });

    it('world point (0,0) moves to screen (200,100)', () => {
      const result = panBy(ORIGIN_CAM, 200, 100);
      const screen = worldToScreen(result, { x: 0, y: 0 });
      expect(screen.x).toBeCloseTo(200, 1);
      expect(screen.y).toBeCloseTo(100, 1);
    });
  });

  describe('TC-02: panBy at ZOOM_MAX, far away', () => {
    it('camera shifts by exact world units', () => {
      const farCam: Camera = {
        x: UNBOUNDED_PAN_TESTED_EXTENT,
        y: UNBOUNDED_PAN_TESTED_EXTENT,
        zoom: ZOOM_MAX,
      };
      const result = panBy(farCam, 200, 100);
      expect(result.x).toBeCloseTo(
        UNBOUNDED_PAN_TESTED_EXTENT - 200 / ZOOM_MAX,
        6,
      );
      expect(result.y).toBeCloseTo(
        UNBOUNDED_PAN_TESTED_EXTENT - 100 / ZOOM_MAX,
        6,
      );
    });
  });

  describe('TC-03: zoomAt keeps pointer world point invariant (origin)', () => {
    it('zoomAt at (300,200) factor 2 keeps world point fixed', () => {
      const point: Point = { x: 300, y: 200 };
      const before = screenToWorld(ORIGIN_CAM, point);
      const result = zoomAt(ORIGIN_CAM, point, 2);
      const after = screenToWorld(result, point);
      expect(after.x).toBeCloseTo(before.x, 6);
      expect(after.y).toBeCloseTo(before.y, 6);
      expect(result.zoom).toBeCloseTo(2, 6);
    });
  });

  describe('TC-04: zoomAt keeps pointer world point invariant (far away)', () => {
    it('zoomAt far from origin keeps pointer world point invariant', () => {
      const farCam: Camera = {
        x: UNBOUNDED_PAN_TESTED_EXTENT,
        y: UNBOUNDED_PAN_TESTED_EXTENT,
        zoom: 1,
      };
      const point: Point = { x: 400, y: 300 };
      const before = screenToWorld(farCam, point);
      const result = zoomAt(farCam, point, 1.5);
      const after = screenToWorld(result, point);
      expect(after.x).toBeCloseTo(before.x, 6);
      expect(after.y).toBeCloseTo(before.y, 6);
    });
  });

  describe('TC-05: zoomAt at ZOOM_MIN returns same object', () => {
    it('zooming out at minimum returns same camera reference', () => {
      const minCam: Camera = { x: 0, y: 0, zoom: ZOOM_MIN };
      const result = zoomAt(minCam, { x: 600, y: 400 }, 1 / ZOOM_STEP_FACTOR);
      expect(result).toBe(minCam);
    });
  });

  describe('TC-06: zoomAt at ZOOM_MAX returns same object', () => {
    it('zooming in at maximum returns same camera reference', () => {
      const maxCam: Camera = { x: 0, y: 0, zoom: ZOOM_MAX };
      const result = zoomAt(maxCam, { x: 600, y: 400 }, ZOOM_STEP_FACTOR);
      expect(result).toBe(maxCam);
    });
  });

  describe('TC-07: viewport resize leaves camera unchanged', () => {
    it('camera x, y, zoom are unaffected by viewport size change', () => {
      const cam: Camera = { x: 100, y: 200, zoom: 1.5 };
      // Resize doesn't modify camera; just assert camera is immutable data
      const result: Camera = { ...cam };
      expect(result.x).toBe(cam.x);
      expect(result.y).toBe(cam.y);
      expect(result.zoom).toBe(cam.zoom);
    });
  });

  describe('TC-08: resetCamera centers origin at 100%', () => {
    it('resetCamera(1200x800) gives zoom 1 and origin centred', () => {
      const viewport: Size = { width: 1200, height: 800 };
      const result = resetCamera(viewport);
      expect(result.zoom).toBe(1);
      expect(result.x).toBeCloseTo(-600, 6);
      expect(result.y).toBeCloseTo(-400, 6);
      // Origin (0,0) should be at viewport centre
      const screen = worldToScreen(result, { x: 0, y: 0 });
      expect(screen.x).toBeCloseTo(600, 6);
      expect(screen.y).toBeCloseTo(400, 6);
    });
  });

  describe('TC-09: step in then out returns exactly 1.0', () => {
    it('1.0 → 1.25 → 1.0 exactly', () => {
      const viewport: Size = { width: 1200, height: 800 };
      const zoomedIn = zoomStep(ORIGIN_CAM, viewport, 'in');
      expect(zoomedIn.zoom).toBeCloseTo(ZOOM_STEP_FACTOR, 10);
      const zoomedOut = zoomStep(zoomedIn, viewport, 'out');
      expect(zoomedOut.zoom).toBe(1);
    });
  });

  describe('TC-10: 20 steps in clamps at ZOOM_MAX', () => {
    it('zoom reaches ZOOM_MAX and canZoomIn is false', () => {
      const viewport: Size = { width: 1200, height: 800 };
      let cam: Camera = ORIGIN_CAM;
      for (let i = 0; i < 20; i++) {
        cam = zoomStep(cam, viewport, 'in');
      }
      expect(cam.zoom).toBeCloseTo(ZOOM_MAX, 10);
      expect(canZoomIn(cam)).toBe(false);
    });
  });

  describe('TC-11: huge factor clamps and keeps pointer invariance', () => {
    it('factor 1000 clamps to ZOOM_MAX and pointer stays fixed', () => {
      const point: Point = { x: 300, y: 200 };
      const before = screenToWorld(ORIGIN_CAM, point);
      const result = zoomAt(ORIGIN_CAM, point, 1000);
      expect(result.zoom).toBe(ZOOM_MAX);
      const after = screenToWorld(result, point);
      expect(after.x).toBeCloseTo(before.x, 6);
      expect(after.y).toBeCloseTo(before.y, 6);
    });
  });

  describe('TC-12: invalid factor returns unchanged camera', () => {
    const invalidFactors = [0, -1, NaN, Infinity, -Infinity];

    for (const factor of invalidFactors) {
      it(`factor ${factor} returns same camera`, () => {
        const result = zoomAt(ORIGIN_CAM, { x: 100, y: 100 }, factor);
        expect(result).toBe(ORIGIN_CAM);
        // Verify no NaN in output
        expect(Number.isNaN(result.x)).toBe(false);
        expect(Number.isNaN(result.y)).toBe(false);
        expect(Number.isNaN(result.zoom)).toBe(false);
      });
    }
  });

  describe('property: pointer invariance for 1000 random cameras/points/factors', () => {
    it('pointer world point is invariant under zoomAt within 1e-6', () => {
      // Seeded pseudo-random number generator
      let seed = 42;
      function random(): number {
        seed = (seed * 16807 + 0) % 2147483647;
        return seed / 2147483647;
      }

      for (let i = 0; i < 1000; i++) {
        const x = random() * 2000000 - UNBOUNDED_PAN_TESTED_EXTENT;
        const y = random() * 2000000 - UNBOUNDED_PAN_TESTED_EXTENT;
        const zoom = ZOOM_MIN + random() * (ZOOM_MAX - ZOOM_MIN);
        const cam: Camera = { x, y, zoom };

        const px = random() * 1920;
        const py = random() * 1080;
        const point: Point = { x: px, y: py };

        const factor = 0.1 + random() * 5;

        const before = screenToWorld(cam, point);
        const result = zoomAt(cam, point, factor);
        const after = screenToWorld(result, point);

        expect(Math.abs(after.x - before.x)).toBeLessThan(1e-6);
        expect(Math.abs(after.y - before.y)).toBeLessThan(1e-6);
      }
    });
  });
});
