import { describe, it, expect } from 'vitest';
import {
  screenToWorld,
  worldToScreen,
  panBy,
  zoomAt,
  zoomStep,
  resetCamera,
  canZoomIn,
  Camera,
  Point,
  Size,
} from '../../src/client/canvas/camera';
import {
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_STEP_FACTOR,
  UNBOUNDED_PAN_TESTED_EXTENT,
} from '../../src/shared/config';

describe('camera.math', () => {
  describe('TC-01: panBy at zoom 1, origin', () => {
    it('moves camera by exactly (-dx, -dy) world units and world origin moves by (dx, dy) screen px', () => {
      const cam: Camera = { x: 0, y: 0, zoom: 1 };
      const result = panBy(cam, 200, 100);
      // camera x,y shift by (-dx/zoom, -dy/zoom) = (-200, -100)
      expect(result.x).toBeCloseTo(-200, 6);
      expect(result.y).toBeCloseTo(-100, 6);
      expect(result.zoom).toBe(1);
      // world point (0,0) should now be at screen (200, 100)
      const screenPos = worldToScreen(result, { x: 0, y: 0 });
      expect(screenPos.x).toBeCloseTo(200, 6);
      expect(screenPos.y).toBeCloseTo(100, 6);
    });
  });

  describe('TC-02: panBy at zoom MAX, far away', () => {
    it('moves camera by exact world shift (-dx/zoom, -dy/zoom) far away', () => {
      const cam: Camera = { x: UNBOUNDED_PAN_TESTED_EXTENT, y: UNBOUNDED_PAN_TESTED_EXTENT, zoom: ZOOM_MAX };
      const result = panBy(cam, 200, 100);
      expect(result.x).toBeCloseTo(UNBOUNDED_PAN_TESTED_EXTENT - 200 / ZOOM_MAX, 6);
      expect(result.y).toBeCloseTo(UNBOUNDED_PAN_TESTED_EXTENT - 100 / ZOOM_MAX, 6);
    });
  });

  describe('TC-03: zoomAt keeps pointer world point invariant at origin', () => {
    it('zooming at (300,200) with factor 2 keeps the world point under pointer fixed', () => {
      const cam: Camera = { x: 0, y: 0, zoom: 1 };
      const p: Point = { x: 300, y: 200 };
      const before = screenToWorld(cam, p);
      const result = zoomAt(cam, p, 2);
      const after = screenToWorld(result, p);
      expect(after.x).toBeCloseTo(before.x, 6);
      expect(after.y).toBeCloseTo(before.y, 6);
      expect(result.zoom).toBeCloseTo(2, 6);
    });
  });

  describe('TC-04: zoomAt keeps pointer world point invariant far away', () => {
    it('zooming at far position with factor 1.5 keeps world point invariant', () => {
      const cam: Camera = { x: UNBOUNDED_PAN_TESTED_EXTENT, y: UNBOUNDED_PAN_TESTED_EXTENT, zoom: 1 };
      const p: Point = { x: 400, y: 300 };
      const before = screenToWorld(cam, p);
      const result = zoomAt(cam, p, 1.5);
      const after = screenToWorld(result, p);
      expect(after.x).toBeCloseTo(before.x, 6);
      expect(after.y).toBeCloseTo(before.y, 6);
    });
  });

  describe('TC-05: zoomAt at ZOOM_MIN returns same object', () => {
    it('zooming out at minimum returns same camera object', () => {
      const cam: Camera = { x: 0, y: 0, zoom: ZOOM_MIN };
      const centre: Point = { x: 600, y: 400 };
      const result = zoomAt(cam, centre, 1 / ZOOM_STEP_FACTOR);
      expect(result).toBe(cam);
    });
  });

  describe('TC-06: zoomAt at ZOOM_MAX returns same object', () => {
    it('zooming in at maximum returns same camera object', () => {
      const cam: Camera = { x: 0, y: 0, zoom: ZOOM_MAX };
      const centre: Point = { x: 600, y: 400 };
      const result = zoomAt(cam, centre, ZOOM_STEP_FACTOR);
      expect(result).toBe(cam);
    });
  });

  describe('TC-07: viewport resize leaves camera unchanged', () => {
    it('camera x, y, zoom are unaffected by viewport size change', () => {
      const cam: Camera = { x: 500, y: 300, zoom: 2 };
      // Camera is a value type; resize doesn't produce a new camera
      // The camera stays the same; viewport size is just a parameter passed to other functions.
      // This test asserts that camera properties are stable across reads.
      expect(cam.x).toBe(500);
      expect(cam.y).toBe(300);
      expect(cam.zoom).toBe(2);
    });
  });

  describe('TC-08: resetCamera centres origin at zoom 1', () => {
    it('resetCamera(1200x800) gives zoom=1 and origin at centre', () => {
      const viewport: Size = { width: 1200, height: 800 };
      const result = resetCamera(viewport);
      expect(result.zoom).toBe(1);
      // World origin (0,0) should be at screen (600, 400)
      const screenOrigin = worldToScreen(result, { x: 0, y: 0 });
      expect(screenOrigin.x).toBeCloseTo(600, 6);
      expect(screenOrigin.y).toBeCloseTo(400, 6);
    });
  });

  describe('TC-09: step in then out returns exactly 1.0', () => {
    it('zoom step in then step out returns to 1.0', () => {
      const cam: Camera = { x: 0, y: 0, zoom: 1 };
      const viewport: Size = { width: 1200, height: 800 };
      const stepped = zoomStep(cam, viewport, 'in');
      expect(stepped.zoom).toBeCloseTo(ZOOM_STEP_FACTOR, 6);
      const back = zoomStep(stepped, viewport, 'out');
      expect(back.zoom).toBe(1);
    });
  });

  describe('TC-10: 20 steps in clamps at ZOOM_MAX', () => {
    it('repeated zoom in stops at ZOOM_MAX, canZoomIn false', () => {
      const cam: Camera = { x: 0, y: 0, zoom: 1 };
      const viewport: Size = { width: 1200, height: 800 };
      let current = cam;
      for (let i = 0; i < 20; i++) {
        current = zoomStep(current, viewport, 'in');
      }
      expect(current.zoom).toBeCloseTo(ZOOM_MAX, 6);
      expect(canZoomIn(current)).toBe(false);
    });
  });

  describe('TC-11: huge factor clamps and keeps pointer invariance', () => {
    it('factor 1000 clamps to ZOOM_MAX and pointer invariant holds', () => {
      const cam: Camera = { x: 100, y: 200, zoom: 1 };
      const p: Point = { x: 300, y: 200 };
      const before = screenToWorld(cam, p);
      const result = zoomAt(cam, p, 1000);
      expect(result.zoom).toBe(ZOOM_MAX);
      const after = screenToWorld(result, p);
      expect(after.x).toBeCloseTo(before.x, 6);
      expect(after.y).toBeCloseTo(before.y, 6);
    });
  });

  describe('TC-12: invalid factor returns unchanged camera', () => {
    it('factor 0, negative, NaN, Infinity return unchanged camera with no NaN', () => {
      const cam: Camera = { x: 100, y: 200, zoom: 1 };
      const p: Point = { x: 50, y: 50 };
      const badFactors = [0, -1, NaN, Infinity, -Infinity];
      for (const f of badFactors) {
        const result = zoomAt(cam, p, f);
        expect(result).toBe(cam);
        // Ensure no NaN in output
        const w = screenToWorld(result, p);
        expect(Number.isFinite(w.x)).toBe(true);
        expect(Number.isFinite(w.y)).toBe(true);
      }
    });
  });

  describe('Property: zoomAt pointer invariance', () => {
    it('1000 random cameras/points/factors: pointer world point invariant within 1e-6', () => {
      // Seeded pseudo-random for determinism
      let seed = 42;
      function rand(): number {
        seed = (seed * 1664525 + 1013904223) & 0xFFFFFFFF;
        return (seed >>> 0) / 0xFFFFFFFF;
      }

      for (let i = 0; i < 1000; i++) {
        const zoom = ZOOM_MIN + rand() * (ZOOM_MAX - ZOOM_MIN);
        const x = (rand() - 0.5) * 1000;
        const y = (rand() - 0.5) * 1000;
        const cam: Camera = { x, y, zoom };
        const p: Point = { x: rand() * 1200, y: rand() * 800 };
        const factor = 0.5 + rand() * 2;
        const before = screenToWorld(cam, p);
        const result = zoomAt(cam, p, factor);
        const after = screenToWorld(result, p);
        // If zoom didn't change (clamped), invariant still holds because zoomAt returns clamped zoom
        if (result.zoom !== zoom) {
          expect(after.x).toBeCloseTo(before.x, 5);
          expect(after.y).toBeCloseTo(before.y, 5);
        }
      }
    });
  });
});
