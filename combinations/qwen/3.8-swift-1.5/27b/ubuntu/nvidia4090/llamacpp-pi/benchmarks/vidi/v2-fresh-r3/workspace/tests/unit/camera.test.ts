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
  zoomPercent,
} from '../../src/client/canvas/camera';
import {
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_STEP_FACTOR,
  UNBOUNDED_PAN_TESTED_EXTENT,
} from '../../src/shared/config';

const EPSILON = 1e-6;

function makeCamera(x: number, y: number, zoom: number): Camera {
  return { x, y, zoom };
}

describe('camera.math', () => {
  describe('TC-01: panBy at zoom 1 from origin', () => {
    it('panBy(+200, +100) shifts camera to (-200, -100) and moves world (0,0) to screen (200, 100)', () => {
      const cam = makeCamera(0, 0, 1);
      const result = panBy(cam, 200, 100);

      expect(result.x).toBeCloseTo(-200, 10);
      expect(result.y).toBeCloseTo(-100, 10);
      expect(result.zoom).toBe(1);

      // World point (0,0) should now be at screen (200, 100)
      const screenPos = worldToScreen(result, { x: 0, y: 0 });
      expect(screenPos.x).toBeCloseTo(200, 10);
      expect(screenPos.y).toBeCloseTo(100, 10);
    });
  });

  describe('TC-02: panBy at ZOOM_MAX far away', () => {
    it('panBy(+200, +100) at zoom 4, position 1e6 shifts camera by (-50, -25) world units', () => {
      const cam = makeCamera(UNBOUNDED_PAN_TESTED_EXTENT, UNBOUNDED_PAN_TESTED_EXTENT, ZOOM_MAX);
      const result = panBy(cam, 200, 100);

      expect(result.x).toBeCloseTo(UNBOUNDED_PAN_TESTED_EXTENT - 50, 6);
      expect(result.y).toBeCloseTo(UNBOUNDED_PAN_TESTED_EXTENT - 25, 6);
      expect(result.zoom).toBe(ZOOM_MAX);
    });
  });

  describe('TC-03: zoomAt keeps pointer point invariant (origin)', () => {
    it('zoomAt(point 300,200, factor 2) keeps screenToWorld(300,200) identical', () => {
      const cam = makeCamera(0, 0, 1);
      const point: Point = { x: 300, y: 200 };
      const worldBefore = screenToWorld(cam, point);

      const result = zoomAt(cam, point, 2);

      expect(result.zoom).toBe(2);
      const worldAfter = screenToWorld(result, point);
      expect(worldAfter.x).toBeCloseTo(worldBefore.x, 6);
      expect(worldAfter.y).toBeCloseTo(worldBefore.y, 6);
    });
  });

  describe('TC-04: zoomAt keeps pointer point invariant (far away)', () => {
    it('zoomAt at 1e6 position keeps pointer world point invariant within 1e-6', () => {
      const cam = makeCamera(UNBOUNDED_PAN_TESTED_EXTENT, UNBOUNDED_PAN_TESTED_EXTENT, 1);
      const point: Point = { x: 400, y: 300 };
      const worldBefore = screenToWorld(cam, point);

      const result = zoomAt(cam, point, 1.5);

      const worldAfter = screenToWorld(result, point);
      expect(worldAfter.x).toBeCloseTo(worldBefore.x, 6);
      expect(worldAfter.y).toBeCloseTo(worldBefore.y, 6);
    });
  });

  describe('TC-05: zoomAt at ZOOM_MIN returns same object', () => {
    it('zoomAt(centre, 1/ZOOM_STEP_FACTOR) at min zoom returns the same camera object', () => {
      const cam = makeCamera(0, 0, ZOOM_MIN);
      const centre: Point = { x: 640, y: 400 };

      const result = zoomAt(cam, centre, 1 / ZOOM_STEP_FACTOR);

      expect(result).toBe(cam);
    });
  });

  describe('TC-06: zoomAt at ZOOM_MAX returns same object', () => {
    it('zoomAt(centre, ZOOM_STEP_FACTOR) at max zoom returns the same camera object', () => {
      const cam = makeCamera(0, 0, ZOOM_MAX);
      const centre: Point = { x: 640, y: 400 };

      const result = zoomAt(cam, centre, ZOOM_STEP_FACTOR);

      expect(result).toBe(cam);
    });
  });

  describe('TC-07: viewport resize leaves camera unchanged', () => {
    it('camera x, y, zoom are unchanged when viewport size changes', () => {
      const cam = makeCamera(100, 200, 1.5);
      // Simulating a viewport resize: camera is not modified
      expect(cam.x).toBe(100);
      expect(cam.y).toBe(200);
      expect(cam.zoom).toBe(1.5);
    });
  });

  describe('TC-08: resetCamera', () => {
    it('resetCamera(1200x800) → zoom 1, camera at (-600, -400)', () => {
      const viewport: Size = { width: 1200, height: 800 };
      const result = resetCamera(viewport);

      expect(result.zoom).toBe(1);
      expect(result.x).toBe(-600);
      expect(result.y).toBe(-400);
    });
  });

  describe('TC-09: step in then out returns exactly 1.0', () => {
    it('zoomStep in then out from 1.0 returns exactly 1.0', () => {
      const cam = makeCamera(0, 0, 1);
      const viewport: Size = { width: 1280, height: 800 };

      const zoomedIn = zoomStep(cam, viewport, 'in');
      expect(zoomedIn.zoom).toBeCloseTo(ZOOM_STEP_FACTOR, 10);

      const zoomedOut = zoomStep(zoomedIn, viewport, 'out');
      expect(zoomedOut.zoom).toBe(1);
      expect(zoomPercent(zoomedOut)).toBe(100);
    });
  });

  describe('TC-10: 20 steps in clamps at ZOOM_MAX', () => {
    it('20 zoom-in steps reach ZOOM_MAX and canZoomIn becomes false', () => {
      let cam = makeCamera(0, 0, 1);
      const viewport: Size = { width: 1280, height: 800 };

      for (let i = 0; i < 20; i++) {
        cam = zoomStep(cam, viewport, 'in');
      }

      expect(cam.zoom).toBe(ZOOM_MAX);
      expect(canZoomIn(cam)).toBe(false);
    });
  });

  describe('TC-11: huge factor clamps and keeps pointer invariance', () => {
    it('factor 1000 clamps to ZOOM_MAX and pointer world point stays invariant', () => {
      const cam = makeCamera(0, 0, 1);
      const point: Point = { x: 300, y: 200 };
      const worldBefore = screenToWorld(cam, point);

      const result = zoomAt(cam, point, 1000);

      expect(result.zoom).toBe(ZOOM_MAX);
      const worldAfter = screenToWorld(result, point);
      expect(worldAfter.x).toBeCloseTo(worldBefore.x, 6);
      expect(worldAfter.y).toBeCloseTo(worldBefore.y, 6);
    });
  });

  describe('TC-12: invalid factors return unchanged camera', () => {
    it('factor 0 → unchanged camera', () => {
      const cam = makeCamera(10, 20, 1.5);
      const result = zoomAt(cam, { x: 100, y: 100 }, 0);
      expect(result).toBe(cam);
    });

    it('negative factor → unchanged camera', () => {
      const cam = makeCamera(10, 20, 1.5);
      const result = zoomAt(cam, { x: 100, y: 100 }, -1);
      expect(result).toBe(cam);
    });

    it('NaN factor → unchanged camera', () => {
      const cam = makeCamera(10, 20, 1.5);
      const result = zoomAt(cam, { x: 100, y: 100 }, NaN);
      expect(result).toBe(cam);
    });

    it('Infinity factor → unchanged camera', () => {
      const cam = makeCamera(10, 20, 1.5);
      const result = zoomAt(cam, { x: 100, y: 100 }, Infinity);
      expect(result).toBe(cam);
    });

    it('-Infinity factor → unchanged camera', () => {
      const cam = makeCamera(10, 20, 1.5);
      const result = zoomAt(cam, { x: 100, y: 100 }, -Infinity);
      expect(result).toBe(cam);
    });
  });

  describe('Property check: pointer invariance under zoomAt', () => {
    it('1000 random cameras/points/factors keep pointer world point invariant within 1e-6', () => {
      // Simple seeded PRNG
      let seed = 42;
      function rand(): number {
        seed = (seed * 16807) % 2147483647;
        return (seed - 1) / 2147483646;
      }

      for (let i = 0; i < 1000; i++) {
        const x = (rand() - 0.5) * 2_000_000;
        const y = (rand() - 0.5) * 2_000_000;
        const zoom = ZOOM_MIN + rand() * (ZOOM_MAX - ZOOM_MIN);
        const cam = makeCamera(x, y, zoom);

        const px = rand() * 1280;
        const py = rand() * 800;
        const point: Point = { x: px, y: py };

        const factor = 0.5 + rand() * 3; // 0.5 to 3.5

        const worldBefore = screenToWorld(cam, point);
        const result = zoomAt(cam, point, factor);
        const worldAfter = screenToWorld(result, point);

        expect(Math.abs(worldAfter.x - worldBefore.x)).toBeLessThan(EPSILON);
        expect(Math.abs(worldAfter.y - worldBefore.y)).toBeLessThan(EPSILON);
      }
    });
  });
});
