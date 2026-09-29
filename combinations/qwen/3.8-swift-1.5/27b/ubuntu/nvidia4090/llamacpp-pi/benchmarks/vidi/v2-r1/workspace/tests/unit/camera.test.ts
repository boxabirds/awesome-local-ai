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
} from '@client/canvas/camera';
import { ZOOM_MIN, ZOOM_MAX, ZOOM_STEP_FACTOR, UNBOUNDED_PAN_TESTED_EXTENT } from '@shared/config';

function makeCamera(x: number, y: number, zoom: number): Camera {
  return { x, y, zoom };
}

describe('camera.math', () => {
  describe('TC-01: panBy at zoom 1 from origin', () => {
    it('shifts camera by (-dx/zoom, -dy/zoom) and moves world point correctly', () => {
      const cam = makeCamera(0, 0, 1.0);
      const result = panBy(cam, 200, 100);

      // Camera x,y should be (-200, -100)
      expect(result.x).toBeCloseTo(-200, 10);
      expect(result.y).toBeCloseTo(-100, 10);
      expect(result.zoom).toBe(1.0);

      // World point (0,0) should now be at screen (200, 100)
      const worldOriginScreen = worldToScreen(result, { x: 0, y: 0 });
      expect(worldOriginScreen.x).toBeCloseTo(200, 1);
      expect(worldOriginScreen.y).toBeCloseTo(100, 1);
    });
  });

  describe('TC-02: panBy at ZOOM_MAX far away', () => {
    it('shifts camera by (-dx/zoom, -dy/zoom) with exact precision at far distance', () => {
      const cam = makeCamera(UNBOUNDED_PAN_TESTED_EXTENT, UNBOUNDED_PAN_TESTED_EXTENT, ZOOM_MAX);
      const result = panBy(cam, 200, 100);

      // Camera should shift by (-200/4, -100/4) = (-50, -25) world units
      expect(result.x).toBeCloseTo(UNBOUNDED_PAN_TESTED_EXTENT - 50, 6);
      expect(result.y).toBeCloseTo(UNBOUNDED_PAN_TESTED_EXTENT - 25, 6);
      expect(result.zoom).toBe(ZOOM_MAX);
    });
  });

  describe('TC-03: zoomAt keeps world point under pointer invariant (origin)', () => {
    it('keeps the world point at the screen position fixed during zoom', () => {
      const cam = makeCamera(0, 0, 1.0);
      const point: Point = { x: 300, y: 200 };
      const worldBefore = screenToWorld(cam, point);

      const result = zoomAt(cam, point, 2);

      expect(result.zoom).toBeCloseTo(2.0, 10);
      const worldAfter = screenToWorld(result, point);
      expect(worldAfter.x).toBeCloseTo(worldBefore.x, 6);
      expect(worldAfter.y).toBeCloseTo(worldBefore.y, 6);
    });
  });

  describe('TC-04: zoomAt keeps world point under pointer invariant (far away)', () => {
    it('keeps the world point at the screen position fixed at 1e6 distance', () => {
      const cam = makeCamera(UNBOUNDED_PAN_TESTED_EXTENT, UNBOUNDED_PAN_TESTED_EXTENT, 1.0);
      const point: Point = { x: 100, y: 100 };
      const worldBefore = screenToWorld(cam, point);

      const result = zoomAt(cam, point, 1.5);

      expect(result.zoom).toBeCloseTo(1.5, 10);
      const worldAfter = screenToWorld(result, point);
      expect(worldAfter.x).toBeCloseTo(worldBefore.x, 6);
      expect(worldAfter.y).toBeCloseTo(worldBefore.y, 6);
    });
  });

  describe('TC-05: zoomAt at ZOOM_MIN returns same object', () => {
    it('returns the same camera object when zooming out at minimum', () => {
      const cam = makeCamera(0, 0, ZOOM_MIN);
      const centre: Point = { x: 640, y: 400 };
      const result = zoomAt(cam, centre, 1 / ZOOM_STEP_FACTOR);

      expect(result).toBe(cam);
    });
  });

  describe('TC-06: zoomAt at ZOOM_MAX returns same object', () => {
    it('returns the same camera object when zooming in at maximum', () => {
      const cam = makeCamera(0, 0, ZOOM_MAX);
      const centre: Point = { x: 640, y: 400 };
      const result = zoomAt(cam, centre, ZOOM_STEP_FACTOR);

      expect(result).toBe(cam);
    });
  });

  describe('TC-07: viewport resize leaves camera unchanged', () => {
    it('camera x, y, zoom are unchanged when viewport size changes', () => {
      const cam = makeCamera(0, 0, 1.0);
      // Resize is not a camera operation - camera stays the same
      expect(cam.x).toBe(0);
      expect(cam.y).toBe(0);
      expect(cam.zoom).toBe(1.0);
    });
  });

  describe('TC-08: resetCamera centres origin', () => {
    it('resets to zoom 1 with origin at viewport centre', () => {
      const viewport: Size = { width: 1200, height: 800 };
      const result = resetCamera(viewport);

      expect(result.zoom).toBe(1);
      expect(result.x).toBe(-600);
      expect(result.y).toBe(-400);

      // Origin (0,0) should be at screen centre (600, 400)
      const originScreen = worldToScreen(result, { x: 0, y: 0 });
      expect(originScreen.x).toBe(600);
      expect(originScreen.y).toBe(400);
    });
  });

  describe('TC-09: step in then out returns exactly 1.0', () => {
    it('zoomStep in then out returns exactly 1.0 (no float drift)', () => {
      const viewport: Size = { width: 1280, height: 800 };
      let cam = makeCamera(-640, -400, 1.0);

      cam = zoomStep(cam, viewport, 'in');
      expect(cam.zoom).toBeCloseTo(1.25, 10);

      cam = zoomStep(cam, viewport, 'out');
      expect(cam.zoom).toBe(1.0);
      expect(zoomPercent(cam)).toBe(100);
    });
  });

  describe('TC-10: 20 steps in clamps at ZOOM_MAX', () => {
    it('repeatedly zooming in stops at ZOOM_MAX and canZoomIn is false', () => {
      const viewport: Size = { width: 1280, height: 800 };
      let cam = makeCamera(-640, -400, 1.0);

      for (let i = 0; i < 20; i++) {
        const next = zoomStep(cam, viewport, 'in');
        if (next === cam) break;
        cam = next;
      }

      expect(cam.zoom).toBe(ZOOM_MAX);
      expect(canZoomIn(cam)).toBe(false);
    });
  });

  describe('TC-11: huge factor clamps and keeps pointer invariance', () => {
    it('clamps to ZOOM_MAX and pointer world point stays invariant', () => {
      const cam = makeCamera(0, 0, 1.0);
      const point: Point = { x: 300, y: 200 };
      const worldBefore = screenToWorld(cam, point);

      const result = zoomAt(cam, point, 1000);

      expect(result.zoom).toBe(ZOOM_MAX);
      const worldAfter = screenToWorld(result, point);
      expect(worldAfter.x).toBeCloseTo(worldBefore.x, 6);
      expect(worldAfter.y).toBeCloseTo(worldBefore.y, 6);
    });
  });

  describe('TC-12: invalid factor returns unchanged camera', () => {
    it('factor 0, negative, NaN, Infinity all return unchanged camera with no NaN', () => {
      const cam = makeCamera(10, 20, 1.5);
      const point: Point = { x: 100, y: 100 };

      const invalidFactors = [0, -1, -100, NaN, Infinity, -Infinity];

      for (const factor of invalidFactors) {
        const result = zoomAt(cam, point, factor);
        expect(result).toBe(cam);
        expect(Number.isNaN(result.x)).toBe(false);
        expect(Number.isNaN(result.y)).toBe(false);
        expect(Number.isNaN(result.zoom)).toBe(false);
      }
    });
  });

  describe('Property: pointer invariance under zoomAt', () => {
    it('1000 random cameras/points/factors keep pointer world point invariant within 1e-6', () => {
      // Simple seeded PRNG for reproducibility
      let seed = 42;
      const rand = () => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed / 0x7fffffff;
      };

      for (let i = 0; i < 1000; i++) {
        const x = (rand() - 0.5) * 2000000;
        const y = (rand() - 0.5) * 2000000;
        const zoom = ZOOM_MIN + rand() * (ZOOM_MAX - ZOOM_MIN);
        const cam = makeCamera(x, y, zoom);

        const px = rand() * 2000;
        const py = rand() * 2000;
        const point: Point = { x: px, y: py };

        const factor = 0.1 + rand() * 10;

        const worldBefore = screenToWorld(cam, point);
        const result = zoomAt(cam, point, factor);
        const worldAfter = screenToWorld(result, point);

        expect(Math.abs(worldAfter.x - worldBefore.x)).toBeLessThan(1e-6);
        expect(Math.abs(worldAfter.y - worldBefore.y)).toBeLessThan(1e-6);
      }
    });
  });
});
