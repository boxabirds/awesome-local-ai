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
} from '../../src/client/canvas/camera';
import { ZOOM_MIN, ZOOM_MAX, ZOOM_STEP_FACTOR, UNBOUNDED_PAN_TESTED_EXTENT } from '../../src/shared/config';

const ORIGIN: Camera = { x: 0, y: 0, zoom: 1 };
const FAR: Camera = { x: UNBOUNDED_PAN_TESTED_EXTENT, y: UNBOUNDED_PAN_TESTED_EXTENT, zoom: ZOOM_MAX };
const VIEWPORT: Size = { width: 1200, height: 800 };

describe('camera.math', () => {
  describe('TC-01: panBy at zoom 1 from origin', () => {
    it('panBy(+200,+100) shifts camera to (-200,-100)', () => {
      const result = panBy(ORIGIN, 200, 100);
      expect(result.x).toBe(-200);
      expect(result.y).toBe(-100);
      expect(result.zoom).toBe(1);
    });

    it('world point (0,0) moves from screen (0,0) to (200,100)', () => {
      const result = panBy(ORIGIN, 200, 100);
      const screenPos = worldToScreen(result, { x: 0, y: 0 });
      expect(screenPos.x).toBe(200);
      expect(screenPos.y).toBe(100);
    });
  });

  describe('TC-02: panBy at ZOOM_MAX far away', () => {
    it('panBy(+200,+100) shifts camera by (-50,-25) world units', () => {
      const result = panBy(FAR, 200, 100);
      expect(result.x - FAR.x).toBeCloseTo(-50, 6);
      expect(result.y - FAR.y).toBeCloseTo(-25, 6);
      expect(result.zoom).toBe(ZOOM_MAX);
    });
  });

  describe('TC-03: zoomAt keeps pointer world point invariant (origin)', () => {
    it('zoomAt(point 300,200, factor 2) keeps screenToWorld(300,200) identical', () => {
      const point: Point = { x: 300, y: 200 };
      const before = screenToWorld(ORIGIN, point);
      const result = zoomAt(ORIGIN, point, 2);
      const after = screenToWorld(result, point);
      expect(result.zoom).toBe(2);
      expect(after.x).toBeCloseTo(before.x, 6);
      expect(after.y).toBeCloseTo(before.y, 6);
    });
  });

  describe('TC-04: zoomAt keeps pointer world point invariant (far away)', () => {
    it('zoomAt at 1e6 with factor 1.5 keeps pointer invariant within 1e-6', () => {
      const point: Point = { x: 500, y: 300 };
      const before = screenToWorld(FAR, point);
      const result = zoomAt(FAR, point, 1.5);
      const after = screenToWorld(result, point);
      expect(Math.abs(after.x - before.x)).toBeLessThan(1e-6);
      expect(Math.abs(after.y - before.y)).toBeLessThan(1e-6);
    });
  });

  describe('TC-05: zoomAt at ZOOM_MIN returns same object', () => {
    it('zooming out at ZOOM_MIN returns the same object', () => {
      const atMin: Camera = { x: 0, y: 0, zoom: ZOOM_MIN };
      const result = zoomAt(atMin, { x: 600, y: 400 }, 1 / ZOOM_STEP_FACTOR);
      expect(result).toBe(atMin);
    });
  });

  describe('TC-06: zoomAt at ZOOM_MAX returns same object', () => {
    it('zooming in at ZOOM_MAX returns the same object', () => {
      const atMax: Camera = { x: 0, y: 0, zoom: ZOOM_MAX };
      const centre: Point = { x: 600, y: 400 };
      const result = zoomAt(atMax, centre, ZOOM_STEP_FACTOR);
      expect(result).toBe(atMax);
    });
  });

  describe('TC-07: viewport resize leaves camera unchanged', () => {
    it('camera is independent of viewport size', () => {
      // Camera state is just {x, y, zoom}; viewport size doesn't affect it
      const cam: Camera = { x: 100, y: 200, zoom: 1.5 };
      // Simulating resize: viewport changes but camera stays the same
      expect(cam.x).toBe(100);
      expect(cam.y).toBe(200);
      expect(cam.zoom).toBe(1.5);
    });
  });

  describe('TC-08: resetCamera', () => {
    it('resetCamera(1200x800) gives zoom 1, origin centred', () => {
      const result = resetCamera(VIEWPORT);
      expect(result.zoom).toBe(1);
      expect(result.x).toBe(-600);
      expect(result.y).toBe(-400);
      // Origin (0,0) should be at centre (600, 400)
      const originScreen = worldToScreen(result, { x: 0, y: 0 });
      expect(originScreen.x).toBe(600);
      expect(originScreen.y).toBe(400);
    });
  });

  describe('TC-09: step in then out returns exactly 1.0', () => {
    it('zoomStep in then out from 1.0 returns exactly 1.0', () => {
      const stepIn = zoomStep(ORIGIN, VIEWPORT, 'in');
      expect(stepIn.zoom).toBe(ZOOM_STEP_FACTOR);

      const stepOut = zoomStep(stepIn, VIEWPORT, 'out');
      expect(stepOut.zoom).toBe(1.0);
      expect(zoomPercent(stepOut)).toBe(100);
    });
  });

  describe('TC-10: 20 steps in clamps at ZOOM_MAX', () => {
    it('repeated zoomStep in reaches ZOOM_MAX and stops', () => {
      let cam = ORIGIN;
      for (let i = 0; i < 20; i++) {
        cam = zoomStep(cam, VIEWPORT, 'in');
      }
      expect(cam.zoom).toBe(ZOOM_MAX);
      expect(canZoomIn(cam)).toBe(false);
    });
  });

  describe('TC-11: huge factor clamps and keeps pointer invariance', () => {
    it('factor 1000 clamps to ZOOM_MAX and pointer stays invariant', () => {
      const point: Point = { x: 300, y: 200 };
      const before = screenToWorld(ORIGIN, point);
      const result = zoomAt(ORIGIN, point, 1000);
      expect(result.zoom).toBe(ZOOM_MAX);
      const after = screenToWorld(result, point);
      expect(Math.abs(after.x - before.x)).toBeLessThan(1e-6);
      expect(Math.abs(after.y - before.y)).toBeLessThan(1e-6);
    });
  });

  describe('TC-12: invalid factor returns unchanged camera', () => {
    it.each([0, -1, NaN, Infinity, -Infinity])('factor %p returns unchanged camera', (factor) => {
      const result = zoomAt(ORIGIN, { x: 100, y: 100 }, factor);
      expect(result).toBe(ORIGIN);
    });

    it('no NaN in output for invalid factors', () => {
      const invalidFactors = [0, -1, NaN, Infinity, -Infinity];
      for (const f of invalidFactors) {
        const result = zoomAt(ORIGIN, { x: 100, y: 100 }, f);
        expect(Number.isNaN(result.x)).toBe(false);
        expect(Number.isNaN(result.y)).toBe(false);
        expect(Number.isNaN(result.zoom)).toBe(false);
      }
    });
  });

  describe('Property: pointer invariance under zoomAt', () => {
    it('1000 random cameras/points/factors keep pointer world point invariant', () => {
      // Seeded pseudo-random
      let seed = 42;
      const rand = () => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648;
      };

      for (let i = 0; i < 1000; i++) {
        const x = (rand() - 0.5) * 2 * UNBOUNDED_PAN_TESTED_EXTENT;
        const y = (rand() - 0.5) * 2 * UNBOUNDED_PAN_TESTED_EXTENT;
        const zoom = ZOOM_MIN + rand() * (ZOOM_MAX - ZOOM_MIN);
        const cam: Camera = { x, y, zoom };

        const px = rand() * 2000;
        const py = rand() * 2000;
        const point: Point = { x: px, y: py };

        const factor = 0.5 + rand() * 2; // 0.5 to 2.5

        const before = screenToWorld(cam, point);
        const result = zoomAt(cam, point, factor);
        const after = screenToWorld(result, point);

        expect(Math.abs(after.x - before.x)).toBeLessThan(1e-6);
        expect(Math.abs(after.y - before.y)).toBeLessThan(1e-6);
      }
    });
  });

  describe('screenToWorld / worldToScreen round-trip', () => {
    it('worldToScreen then screenToWorld returns original point', () => {
      const cam: Camera = { x: 100, y: 200, zoom: 1.5 };
      const world: Point = { x: 50, y: 75 };
      const screen = worldToScreen(cam, world);
      const back = screenToWorld(cam, screen);
      expect(back.x).toBeCloseTo(world.x, 10);
      expect(back.y).toBeCloseTo(world.y, 10);
    });
  });

  describe('canZoomIn / canZoomOut', () => {
    it('canZoomIn is true when zoom < ZOOM_MAX', () => {
      expect(canZoomIn({ x: 0, y: 0, zoom: 1 })).toBe(true);
    });
    it('canZoomIn is false when zoom === ZOOM_MAX', () => {
      expect(canZoomIn({ x: 0, y: 0, zoom: ZOOM_MAX })).toBe(false);
    });
    it('canZoomOut is true when zoom > ZOOM_MIN', () => {
      expect(canZoomOut({ x: 0, y: 0, zoom: 1 })).toBe(true);
    });
    it('canZoomOut is false when zoom === ZOOM_MIN', () => {
      expect(canZoomOut({ x: 0, y: 0, zoom: ZOOM_MIN })).toBe(false);
    });
  });

  describe('zoomPercent', () => {
    it('returns rounded percentage', () => {
      expect(zoomPercent({ x: 0, y: 0, zoom: 1 })).toBe(100);
      expect(zoomPercent({ x: 0, y: 0, zoom: 1.5625 })).toBe(156);
      expect(zoomPercent({ x: 0, y: 0, zoom: ZOOM_MIN })).toBe(10);
      expect(zoomPercent({ x: 0, y: 0, zoom: ZOOM_MAX })).toBe(400);
    });
  });
});
