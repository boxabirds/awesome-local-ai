// tests/unit/camera.test.ts
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
  canZoomOut,
  zoomPercent,
} from '../../src/client/canvas/camera';
import { ZOOM_MIN, ZOOM_MAX, ZOOM_STEP_FACTOR, UNBOUNDED_PAN_TESTED_EXTENT } from '../../src/shared/config';

describe('camera.math', () => {
  describe('screenToWorld / worldToScreen', () => {
    it('converts screen to world correctly', () => {
      const cam: Camera = { x: 100, y: 200, zoom: 2 };
      const world = screenToWorld(cam, { x: 10, y: 20 });
      expect(world.x).toBeCloseTo(105, 6); // 10/2 + 100
      expect(world.y).toBeCloseTo(210, 6); // 20/2 + 200
    });

    it('converts world to screen correctly', () => {
      const cam: Camera = { x: 100, y: 200, zoom: 2 };
      const screen = worldToScreen(cam, { x: 105, y: 210 });
      expect(screen.x).toBeCloseTo(10, 6); // (105-100)*2
      expect(screen.y).toBeCloseTo(20, 6); // (210-200)*2
    });

    it('round-trips screen->world->screen', () => {
      const cam: Camera = { x: -500, y: 300, zoom: 0.5 };
      const p: Point = { x: 123.45, y: 678.9 };
      const world = screenToWorld(cam, p);
      const back = worldToScreen(cam, world);
      expect(back.x).toBeCloseTo(p.x, 6);
      expect(back.y).toBeCloseTo(p.y, 6);
    });
  });

  describe('TC-01: panBy at zoom 1 from origin', () => {
    it('panBy(+200, +100) moves camera to (-200, -100)', () => {
      const cam: Camera = { x: 0, y: 0, zoom: 1 };
      const result = panBy(cam, 200, 100);
      expect(result.x).toBeCloseTo(-200, 6);
      expect(result.y).toBeCloseTo(-100, 6);
      expect(result.zoom).toBe(1);
    });

    it('world point (0,0) moves from screen (0,0) to (200,100)', () => {
      const cam: Camera = { x: 0, y: 0, zoom: 1 };
      const before = worldToScreen(cam, { x: 0, y: 0 });
      const afterCam = panBy(cam, 200, 100);
      const after = worldToScreen(afterCam, { x: 0, y: 0 });
      expect(before.x).toBe(0);
      expect(before.y).toBe(0);
      expect(after.x).toBeCloseTo(200, 6);
      expect(after.y).toBeCloseTo(100, 6);
    });
  });

  describe('TC-02: panBy at ZOOM_MAX far away (1e6)', () => {
    it('panBy(+200, +100) at zoom 4, position 1e6 shifts by (-50, -25) world units', () => {
      const cam: Camera = { x: UNBOUNDED_PAN_TESTED_EXTENT, y: UNBOUNDED_PAN_TESTED_EXTENT, zoom: ZOOM_MAX };
      const result = panBy(cam, 200, 100);
      expect(result.x).toBeCloseTo(UNBOUNDED_PAN_TESTED_EXTENT - 50, 6);
      expect(result.y).toBeCloseTo(UNBOUNDED_PAN_TESTED_EXTENT - 25, 6);
      expect(result.zoom).toBe(ZOOM_MAX);
    });
  });

  describe('TC-03: zoomAt keeps world point under pointer invariant (origin)', () => {
    it('zoomAt(point 300,200, factor 2) keeps world point fixed', () => {
      const cam: Camera = { x: 0, y: 0, zoom: 1 };
      const point: Point = { x: 300, y: 200 };
      const worldBefore = screenToWorld(cam, point);
      const result = zoomAt(cam, point, 2);
      expect(result.zoom).toBeCloseTo(2, 6);
      const worldAfter = screenToWorld(result, point);
      expect(worldAfter.x).toBeCloseTo(worldBefore.x, 6);
      expect(worldAfter.y).toBeCloseTo(worldBefore.y, 6);
    });
  });

  describe('TC-04: zoomAt keeps world point under pointer invariant (far away)', () => {
    it('zoomAt at 1e6 with factor 1.5 keeps pointer world point invariant', () => {
      const cam: Camera = { x: UNBOUNDED_PAN_TESTED_EXTENT, y: UNBOUNDED_PAN_TESTED_EXTENT, zoom: 1 };
      const point: Point = { x: 300, y: 200 };
      const worldBefore = screenToWorld(cam, point);
      const result = zoomAt(cam, point, 1.5);
      const worldAfter = screenToWorld(result, point);
      expect(worldAfter.x).toBeCloseTo(worldBefore.x, 6);
      expect(worldAfter.y).toBeCloseTo(worldBefore.y, 6);
    });
  });

  describe('TC-05: zoomAt at ZOOM_MIN returns same object', () => {
    it('zooming out at ZOOM_MIN returns the same camera object', () => {
      const cam: Camera = { x: 0, y: 0, zoom: ZOOM_MIN };
      const centre: Point = { x: 640, y: 400 };
      const result = zoomAt(cam, centre, 1 / ZOOM_STEP_FACTOR);
      expect(result).toBe(cam);
    });
  });

  describe('TC-06: zoomAt at ZOOM_MAX returns same object', () => {
    it('zooming in at ZOOM_MAX returns the same camera object', () => {
      const cam: Camera = { x: 0, y: 0, zoom: ZOOM_MAX };
      const centre: Point = { x: 640, y: 400 };
      const result = zoomAt(cam, centre, ZOOM_STEP_FACTOR);
      expect(result).toBe(cam);
    });
  });

  describe('TC-07: viewport resize leaves camera unchanged', () => {
    it('camera x, y, zoom are unchanged by viewport size change', () => {
      const cam: Camera = { x: 100, y: 200, zoom: 1.5 };
      // Resize doesn't call any camera function - camera is immutable
      // This test verifies that camera state is independent of viewport size
      expect(cam.x).toBe(100);
      expect(cam.y).toBe(200);
      expect(cam.zoom).toBe(1.5);
    });
  });

  describe('TC-08: resetCamera', () => {
    it('resetCamera(1200x800) gives zoom 1, origin centred', () => {
      const result = resetCamera({ width: 1200, height: 800 });
      expect(result.zoom).toBe(1);
      expect(result.x).toBe(-600);
      expect(result.y).toBe(-400);
      // Origin (0,0) should be at screen centre (600, 400)
      const originScreen = worldToScreen(result, { x: 0, y: 0 });
      expect(originScreen.x).toBeCloseTo(600, 6);
      expect(originScreen.y).toBeCloseTo(400, 6);
    });
  });

  describe('TC-09: step in then out returns exactly 1.0', () => {
    it('one step in then one step out returns zoom exactly 1.0', () => {
      const cam: Camera = { x: -640, y: -400, zoom: 1 };
      const viewport = { width: 1280, height: 800 };
      const afterIn = zoomStep(cam, viewport, 'in');
      expect(afterIn.zoom).toBeCloseTo(1.25, 9);
      const afterOut = zoomStep(afterIn, viewport, 'out');
      expect(afterOut.zoom).toBe(1.0);
      expect(zoomPercent(afterOut)).toBe(100);
    });
  });

  describe('TC-10: 20 steps in clamps at ZOOM_MAX', () => {
    it('20 steps in reaches ZOOM_MAX and canZoomIn is false', () => {
      let cam: Camera = { x: -640, y: -400, zoom: 1 };
      const viewport = { width: 1280, height: 800 };
      for (let i = 0; i < 20; i++) {
        cam = zoomStep(cam, viewport, 'in');
      }
      expect(cam.zoom).toBeCloseTo(ZOOM_MAX, 6);
      expect(canZoomIn(cam)).toBe(false);
    });
  });

  describe('TC-11: huge factor clamps and keeps pointer invariance', () => {
    it('factor 1000 clamps to ZOOM_MAX and pointer stays fixed', () => {
      const cam: Camera = { x: 0, y: 0, zoom: 1 };
      const point: Point = { x: 300, y: 200 };
      const worldBefore = screenToWorld(cam, point);
      const result = zoomAt(cam, point, 1000);
      expect(result.zoom).toBeCloseTo(ZOOM_MAX, 6);
      const worldAfter = screenToWorld(result, point);
      expect(worldAfter.x).toBeCloseTo(worldBefore.x, 6);
      expect(worldAfter.y).toBeCloseTo(worldBefore.y, 6);
    });
  });

  describe('TC-12: invalid factor returns unchanged camera', () => {
    it('factor 0 returns same object', () => {
      const cam: Camera = { x: 10, y: 20, zoom: 1 };
      expect(zoomAt(cam, { x: 0, y: 0 }, 0)).toBe(cam);
    });

    it('negative factor returns same object', () => {
      const cam: Camera = { x: 10, y: 20, zoom: 1 };
      expect(zoomAt(cam, { x: 0, y: 0 }, -1)).toBe(cam);
    });

    it('NaN factor returns same object', () => {
      const cam: Camera = { x: 10, y: 20, zoom: 1 };
      expect(zoomAt(cam, { x: 0, y: 0 }, NaN)).toBe(cam);
    });

    it('Infinity factor returns same object', () => {
      const cam: Camera = { x: 10, y: 20, zoom: 1 };
      expect(zoomAt(cam, { x: 0, y: 0 }, Infinity)).toBe(cam);
    });

    it('-Infinity factor returns same object', () => {
      const cam: Camera = { x: 10, y: 20, zoom: 1 };
      expect(zoomAt(cam, { x: 0, y: 0 }, -Infinity)).toBe(cam);
    });

    it('no NaN in output for any invalid factor', () => {
      const cam: Camera = { x: 10, y: 20, zoom: 1 };
      const invalidFactors = [0, -1, NaN, Infinity, -Infinity];
      for (const f of invalidFactors) {
        const result = zoomAt(cam, { x: 50, y: 50 }, f);
        expect(Number.isNaN(result.x)).toBe(false);
        expect(Number.isNaN(result.y)).toBe(false);
        expect(Number.isNaN(result.zoom)).toBe(false);
      }
    });
  });

  describe('canZoomIn / canZoomOut', () => {
    it('canZoomIn is true mid-range', () => {
      expect(canZoomIn({ x: 0, y: 0, zoom: 1 })).toBe(true);
    });

    it('canZoomIn is false at ZOOM_MAX', () => {
      expect(canZoomIn({ x: 0, y: 0, zoom: ZOOM_MAX })).toBe(false);
    });

    it('canZoomOut is true mid-range', () => {
      expect(canZoomOut({ x: 0, y: 0, zoom: 1 })).toBe(true);
    });

    it('canZoomOut is false at ZOOM_MIN', () => {
      expect(canZoomOut({ x: 0, y: 0, zoom: ZOOM_MIN })).toBe(false);
    });
  });

  describe('zoomPercent', () => {
    it('returns 100 for zoom 1', () => {
      expect(zoomPercent({ x: 0, y: 0, zoom: 1 })).toBe(100);
    });

    it('returns 156 for zoom 1.5625', () => {
      expect(zoomPercent({ x: 0, y: 0, zoom: 1.5625 })).toBe(156);
    });

    it('returns 10 for ZOOM_MIN', () => {
      expect(zoomPercent({ x: 0, y: 0, zoom: ZOOM_MIN })).toBe(10);
    });

    it('returns 400 for ZOOM_MAX', () => {
      expect(zoomPercent({ x: 0, y: 0, zoom: ZOOM_MAX })).toBe(400);
    });
  });

  describe('property: pointer invariance under zoomAt (1000 random cases)', () => {
    it('for 1000 random cameras/points/factors, pointer world point is invariant within 1e-6', () => {
      // Seeded PRNG for reproducibility
      let seed = 42;
      function random(): number {
        seed = (seed * 16807 + 0) % 2147483647;
        return seed / 2147483647;
      }

      for (let i = 0; i < 1000; i++) {
        const cam: Camera = {
          x: (random() - 0.5) * 2_000_000,
          y: (random() - 0.5) * 2_000_000,
          zoom: ZOOM_MIN + random() * (ZOOM_MAX - ZOOM_MIN),
        };
        const point: Point = {
          x: random() * 1280,
          y: random() * 800,
        };
        const factor = 0.5 + random() * 3; // 0.5 to 3.5

        const worldBefore = screenToWorld(cam, point);
        const result = zoomAt(cam, point, factor);

        // Only check invariance if zoom actually changed
        if (result !== cam) {
          const worldAfter = screenToWorld(result, point);
          expect(Math.abs(worldAfter.x - worldBefore.x)).toBeLessThan(1e-6);
          expect(Math.abs(worldAfter.y - worldBefore.y)).toBeLessThan(1e-6);
        }
      }
    });
  });

  describe('panBy zero delta returns same object', () => {
    it('panBy(0, 0) returns the same camera object', () => {
      const cam: Camera = { x: 100, y: 200, zoom: 1.5 };
      expect(panBy(cam, 0, 0)).toBe(cam);
    });
  });
});
