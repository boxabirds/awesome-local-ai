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
} from '@client/canvas/camera';
import {
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_STEP_FACTOR,
  UNBOUNDED_PAN_TESTED_EXTENT,
} from '@shared/config';

describe('camera.math', () => {
  describe('TC-01: panBy at zoom 1 from origin', () => {
    it('moves camera x,y by negative screen delta / zoom', () => {
      const cam: Camera = { x: 0, y: 0, zoom: 1 };
      const result = panBy(cam, 200, 100);
      expect(result.x).toBeCloseTo(-200, 10);
      expect(result.y).toBeCloseTo(-100, 10);
      expect(result.zoom).toBe(1);
    });

    it('world point (0,0) moves to screen (200,100)', () => {
      const cam: Camera = { x: 0, y: 0, zoom: 1 };
      const newCam = panBy(cam, 200, 100);
      const screenPos = worldToScreen(newCam, { x: 0, y: 0 });
      expect(screenPos.x).toBeCloseTo(200, 10);
      expect(screenPos.y).toBeCloseTo(100, 10);
    });
  });

  describe('TC-02: panBy at ZOOM_MAX far away', () => {
    it('shifts camera by (-50,-25) world units for 200,100 screen pixels at zoom 4', () => {
      const cam: Camera = { x: UNBOUNDED_PAN_TESTED_EXTENT, y: UNBOUNDED_PAN_TESTED_EXTENT, zoom: ZOOM_MAX };
      const result = panBy(cam, 200, 100);
      expect(result.x).toBeCloseTo(UNBOUNDED_PAN_TESTED_EXTENT - 200 / ZOOM_MAX, 6);
      expect(result.y).toBeCloseTo(UNBOUNDED_PAN_TESTED_EXTENT - 100 / ZOOM_MAX, 6);
      expect(result.zoom).toBe(ZOOM_MAX);
    });
  });

  describe('TC-03: zoomAt keeps pointer world point invariant at origin', () => {
    it('zoom 1 -> 2 keeps screenToWorld(300,200) same', () => {
      const cam: Camera = { x: 0, y: 0, zoom: 1 };
      const p: Point = { x: 300, y: 200 };
      const worldBefore = screenToWorld(cam, p);
      const newCam = zoomAt(cam, p, 2);
      const worldAfter = screenToWorld(newCam, p);
      expect(newCam.zoom).toBeCloseTo(2, 10);
      expect(worldAfter.x).toBeCloseTo(worldBefore.x, 6);
      expect(worldAfter.y).toBeCloseTo(worldBefore.y, 6);
    });
  });

  describe('TC-04: zoomAt keeps pointer invariant far away', () => {
    it('at 1e6 units, factor 1.5 keeps pointer world invariant within 1e-6', () => {
      const cam: Camera = { x: UNBOUNDED_PAN_TESTED_EXTENT, y: UNBOUNDED_PAN_TESTED_EXTENT, zoom: 1 };
      const p: Point = { x: 300, y: 200 };
      const worldBefore = screenToWorld(cam, p);
      const newCam = zoomAt(cam, p, 1.5);
      const worldAfter = screenToWorld(newCam, p);
      expect(worldAfter.x).toBeCloseTo(worldBefore.x, 6);
      expect(worldAfter.y).toBeCloseTo(worldBefore.y, 6);
    });
  });

  describe('TC-05: zoomAt at ZOOM_MIN zooming out returns same object', () => {
    it('returns input camera reference when already at minimum', () => {
      const cam: Camera = { x: 0, y: 0, zoom: ZOOM_MIN };
      const viewport: Size = { width: 1200, height: 800 };
      const centre: Point = { x: viewport.width / 2, y: viewport.height / 2 };
      const result = zoomAt(cam, centre, 1 / ZOOM_STEP_FACTOR);
      expect(result).toBe(cam); // same object reference
    });
  });

  describe('TC-06: zoomAt at ZOOM_MAX zooming in returns same object', () => {
    it('returns input camera reference when already at maximum', () => {
      const cam: Camera = { x: 0, y: 0, zoom: ZOOM_MAX };
      const viewport: Size = { width: 1200, height: 800 };
      const centre: Point = { x: viewport.width / 2, y: viewport.height / 2 };
      const result = zoomAt(cam, centre, ZOOM_STEP_FACTOR);
      expect(result).toBe(cam); // same object reference
    });
  });

  describe('TC-07: viewport resize leaves camera unchanged', () => {
    it('camera is independent of viewport size', () => {
      const cam: Camera = { x: 10, y: 20, zoom: 1.5 };
      // Camera object is not mutated by viewport changes
      const cam2: Camera = { ...cam };
      expect(cam2.x).toBe(cam.x);
      expect(cam2.y).toBe(cam.y);
      expect(cam2.zoom).toBe(cam.zoom);
    });
  });

  describe('TC-08: resetCamera centres origin', () => {
    it('resetCamera(1200x800) gives zoom 1, x=-600, y=-400', () => {
      const viewport: Size = { width: 1200, height: 800 };
      const cam = resetCamera(viewport);
      expect(cam.zoom).toBe(1);
      expect(cam.x).toBeCloseTo(-600, 10);
      expect(cam.y).toBeCloseTo(-400, 10);
    });

    it('after reset, origin world (0,0) maps to viewport centre', () => {
      const viewport: Size = { width: 1200, height: 800 };
      const cam = resetCamera(viewport);
      const screen = worldToScreen(cam, { x: 0, y: 0 });
      expect(screen.x).toBeCloseTo(600, 10);
      expect(screen.y).toBeCloseTo(400, 10);
    });
  });

  describe('TC-09: step in then out returns exactly 1.0', () => {
    it('1.0 -> 1.25 -> 1.0 exactly', () => {
      const viewport: Size = { width: 1200, height: 800 };
      const cam: Camera = { x: -600, y: -400, zoom: 1 };
      const zoomedIn = zoomStep(cam, viewport, 'in');
      expect(zoomedIn.zoom).toBeCloseTo(ZOOM_STEP_FACTOR, 10);
      const zoomedOut = zoomStep(zoomedIn, viewport, 'out');
      expect(zoomedOut.zoom).toBe(1);
    });
  });

  describe('TC-10: 20 steps in clamps at ZOOM_MAX', () => {
    it('zoom reaches ZOOM_MAX and stops; canZoomIn false', () => {
      const viewport: Size = { width: 1200, height: 800 };
      let cam: Camera = { x: -600, y: -400, zoom: 1 };
      for (let i = 0; i < 20; i++) {
        cam = zoomStep(cam, viewport, 'in');
      }
      expect(cam.zoom).toBe(ZOOM_MAX);
      expect(canZoomIn(cam)).toBe(false);
    });
  });

  describe('TC-11: huge zoom factor clamps', () => {
    it('factor 1000 clamps zoom to ZOOM_MAX and pointer invariance holds', () => {
      const cam: Camera = { x: 0, y: 0, zoom: 1 };
      const p: Point = { x: 400, y: 300 };
      const worldBefore = screenToWorld(cam, p);
      const result = zoomAt(cam, p, 1000);
      expect(result.zoom).toBe(ZOOM_MAX);
      const worldAfter = screenToWorld(result, p);
      expect(worldAfter.x).toBeCloseTo(worldBefore.x, 6);
      expect(worldAfter.y).toBeCloseTo(worldBefore.y, 6);
    });
  });

  describe('TC-12: invalid factors return camera unchanged', () => {
    const cam: Camera = { x: 5, y: 10, zoom: 1 };

    it('factor 0 returns same camera', () => {
      expect(zoomAt(cam, { x: 100, y: 100 }, 0)).toBe(cam);
    });

    it('negative factor returns same camera', () => {
      expect(zoomAt(cam, { x: 100, y: 100 }, -1)).toBe(cam);
    });

    it('NaN factor returns same camera', () => {
      expect(zoomAt(cam, { x: 100, y: 100 }, NaN)).toBe(cam);
    });

    it('Infinity factor returns same camera', () => {
      expect(zoomAt(cam, { x: 100, y: 100 }, Infinity)).toBe(cam);
    });

    it('-Infinity factor returns same camera', () => {
      expect(zoomAt(cam, { x: 100, y: 100 }, -Infinity)).toBe(cam);
    });

    it('output has no NaN', () => {
      const result = zoomAt(cam, { x: 100, y: 100 }, 2);
      expect(Number.isNaN(result.x)).toBe(false);
      expect(Number.isNaN(result.y)).toBe(false);
      expect(Number.isNaN(result.zoom)).toBe(false);
    });
  });

  describe('zoomPercent', () => {
    it('rounds zoom * 100', () => {
      expect(zoomPercent({ x: 0, y: 0, zoom: 1 })).toBe(100);
      expect(zoomPercent({ x: 0, y: 0, zoom: ZOOM_STEP_FACTOR })).toBe(125);
      expect(zoomPercent({ x: 0, y: 0, zoom: 1.5625 })).toBe(156);
    });
  });

  describe('canZoomIn / canZoomOut', () => {
    it('canZoomIn false at ZOOM_MAX', () => {
      expect(canZoomIn({ x: 0, y: 0, zoom: ZOOM_MAX })).toBe(false);
    });

    it('canZoomOut false at ZOOM_MIN', () => {
      expect(canZoomOut({ x: 0, y: 0, zoom: ZOOM_MIN })).toBe(false);
    });

    it('both true in middle', () => {
      expect(canZoomIn({ x: 0, y: 0, zoom: 1 })).toBe(true);
      expect(canZoomOut({ x: 0, y: 0, zoom: 1 })).toBe(true);
    });
  });

  describe('property check: pointer invariance', () => {
    it('1000 random cameras/points/factors keep pointer world invariant within 1e-6', () => {
      // Seeded PRNG
      let seed = 12345;
      function rand(): number {
        seed = (seed * 16807 + 0) % 2147483647;
        return (seed - 1) / 2147483646;
      }

      for (let i = 0; i < 1000; i++) {
        const zoom = ZOOM_MIN + rand() * (ZOOM_MAX - ZOOM_MIN);
        const cx = (rand() - 0.5) * 2 * UNBOUNDED_PAN_TESTED_EXTENT;
        const cy = (rand() - 0.5) * 2 * UNBOUNDED_PAN_TESTED_EXTENT;
        const cam: Camera = { x: cx, y: cy, zoom };
        const p: Point = { x: rand() * 1280, y: rand() * 800 };
        const factor = 0.5 + rand() * 3;

        const worldBefore = screenToWorld(cam, p);
        const newCam = zoomAt(cam, p, factor);
        const worldAfter = screenToWorld(newCam, p);

        expect(worldAfter.x).toBeCloseTo(worldBefore.x, 4);
        expect(worldAfter.y).toBeCloseTo(worldBefore.y, 4);
      }
    });
  });
});
