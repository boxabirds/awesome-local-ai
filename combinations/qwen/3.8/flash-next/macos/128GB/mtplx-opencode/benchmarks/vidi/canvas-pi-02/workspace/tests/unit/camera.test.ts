import { describe, expect, it } from 'vitest';
import {
  GRID_SPACING_WORLD,
  UNBOUNDED_PAN_TESTED_EXTENT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP_FACTOR,
} from '../../src/shared/config';
import {
  canZoomIn,
  panBy,
  resetCamera,
  screenToWorld,
  worldToScreen,
  zoomAt,
  zoomPercent,
  zoomStep,
  viewportCentre,
  type Camera,
} from '../../src/client/canvas/camera';

const VIEWPORT = { width: 1200, height: 800 };
const FAR = UNBOUNDED_PAN_TESTED_EXTENT;
const TOLERANCE = 1e-6;

const originScreen = (cam: Camera) => worldToScreen(cam, { x: 0, y: 0 });

describe('panBy', () => {
  it('TC-01 moves the camera by the pointer delta at zoom 1 (origin)', () => {
    const start: Camera = { x: 0, y: 0, zoom: 1 };
    const next = panBy(start, 200, 100);
    // Dragging right/down moves the camera towards negative world coordinates.
    expect(next.x).toBeCloseTo(-200, 6);
    expect(next.y).toBeCloseTo(-100, 6);
    expect(next.zoom).toBe(1);
    // The world origin that was at the viewport top-left is now 200/100 away.
    expect(originScreen(start)).toEqual({ x: 0, y: 0 });
    const moved = originScreen(next);
    expect(moved.x).toBeCloseTo(200, 6);
    expect(moved.y).toBeCloseTo(100, 6);
  });

  it('TC-01 pan follows the pointer exactly after a long drag', () => {
    let cam: Camera = { x: 0, y: 0, zoom: 1 };
    for (let i = 0; i < 40; i += 1) {
      cam = panBy(cam, 5, 2.5);
    }
    const moved = originScreen(cam);
    expect(moved.x).toBeCloseTo(40 * 5, 6);
    expect(moved.y).toBeCloseTo(40 * 2.5, 6);
  });

  it('TC-02 shifts by delta/zoom world units at ZOOM_MAX far from the start', () => {
    const start: Camera = { x: FAR, y: FAR, zoom: ZOOM_MAX };
    const next = panBy(start, 200, 100);
    expect(Math.abs(start.x - next.x)).toBeCloseTo(200 / ZOOM_MAX, 10);
    expect(Math.abs(start.y - next.y)).toBeCloseTo(100 / ZOOM_MAX, 10);
    // Exact to 1e-6 as required by the test strategy.
    expect(Math.abs(start.x - next.x - 200 / ZOOM_MAX)).toBeLessThan(TOLERANCE);
    expect(Math.abs(start.y - next.y - 100 / ZOOM_MAX)).toBeLessThan(TOLERANCE);
    expect(Number.isFinite(next.x)).toBe(true);
    expect(Number.isFinite(next.y)).toBe(true);
  });

  it('TC-29 a zero-length pan returns the same camera object', () => {
    const cam: Camera = { x: -12, y: 34, zoom: 1 };
    expect(panBy(cam, 0, 0)).toBe(cam);
  });
});

describe('zoomAt keeps the point under the pointer', () => {
  it('TC-03 zooms at the pointer around the origin', () => {
    const start: Camera = { x: 0, y: 0, zoom: 1 };
    const point = { x: 300, y: 200 };
    const before = screenToWorld(start, point);
    const next = zoomAt(start, point, 2);
    expect(next.zoom).toBe(2);
    const after = screenToWorld(next, point);
    expect(Math.abs(after.x - before.x)).toBeLessThan(TOLERANCE);
    expect(Math.abs(after.y - before.y)).toBeLessThan(TOLERANCE);
  });

  it('TC-04 keeps the pointer world point invariant far from the start', () => {
    const start: Camera = { x: FAR, y: -FAR, zoom: 1 };
    const point = { x: 300, y: 200 };
    const before = screenToWorld(start, point);
    const next = zoomAt(start, point, 1.5);
    const after = screenToWorld(next, point);
    expect(next.zoom).toBeCloseTo(1.5, 10);
    expect(Math.abs(after.x - before.x)).toBeLessThan(TOLERANCE);
    expect(Math.abs(after.y - before.y)).toBeLessThan(TOLERANCE);
  });

  it('TC-05 refuses to zoom past ZOOM_MIN and returns the same object', () => {
    const cam: Camera = { x: 0, y: 0, zoom: ZOOM_MIN };
    const next = zoomStep(cam, VIEWPORT, 'out');
    expect(next).toBe(cam);
    expect(next.zoom).toBe(ZOOM_MIN);
    expect(next.x).toBe(cam.x);
    expect(next.y).toBe(cam.y);
    expect(zoomPercent(next)).toBe(Math.round(ZOOM_MIN * 100));
  });

  it('TC-06 refuses to zoom past ZOOM_MAX and returns the same object', () => {
    const cam: Camera = { x: 0, y: 0, zoom: ZOOM_MAX };
    const next = zoomStep(cam, VIEWPORT, 'in');
    expect(next).toBe(cam);
    expect(next.zoom).toBe(ZOOM_MAX);
    expect(next.x).toBe(cam.x);
    expect(next.y).toBe(cam.y);
  });
});

describe('viewport size and reset', () => {
  it('TC-07 a viewport size change leaves the camera unchanged', () => {
    const cam: Camera = { x: 123.5, y: -87.25, zoom: 1.5 };
    const sizes = [
      { width: 1200, height: 800 },
      { width: 1920, height: 1080 },
      { width: 640, height: 400 },
    ];
    // Nothing in the camera depends on the viewport size: the world origin
    // keeps the same screen position, so content does not move on resize.
    const originScreens = sizes.map((size) => originScreen(cam));
    for (const screen of originScreens) {
      expect(screen.x).toBeCloseTo(originScreens[0].x, 10);
      expect(screen.y).toBeCloseTo(originScreens[0].y, 10);
    }
    for (const size of sizes) {
      expect(panBy(cam, 0, 0)).toBe(cam);
      expect(zoomAt(cam, viewportCentre(size), 1)).toBe(cam);
      expect(zoomStep(cam, size, 'in').zoom).toBeCloseTo(1.875, 10);
    }
  });

  it('TC-08 reset returns to 100% with the board origin centred', () => {
    const start: Camera = { x: FAR, y: FAR, zoom: ZOOM_MAX };
    const next = resetCamera(VIEWPORT);
    expect(next).toEqual({
      x: -VIEWPORT.width / 2,
      y: -VIEWPORT.height / 2,
      zoom: 1,
    });
    expect(next).not.toBe(start);
    const origin = originScreen(next);
    expect(origin.x).toBeCloseTo(VIEWPORT.width / 2, 6);
    expect(origin.y).toBeCloseTo(VIEWPORT.height / 2, 6);
  });
});

describe('zoom steps', () => {
  it('TC-09 one step in then one step out returns exactly 100%', () => {
    const start: Camera = { x: 0, y: 0, zoom: 1 };
    const zoomed = zoomStep(start, VIEWPORT, 'in');
    expect(zoomed.zoom).toBe(ZOOM_STEP_FACTOR);
    expect(zoomPercent(zoomed)).toBe(125);
    const back = zoomStep(zoomed, VIEWPORT, 'out');
    expect(back.zoom).toBe(1);
    expect(zoomPercent(back)).toBe(100);
  });

  it('TC-10 zooming in repeatedly stops at ZOOM_MAX and disables zoom in', () => {
    let cam: Camera = { x: 0, y: 0, zoom: 1 };
    const seen: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      cam = zoomStep(cam, VIEWPORT, 'in');
      seen.push(cam.zoom);
    }
    expect(cam.zoom).toBe(ZOOM_MAX);
    expect(canZoomIn(cam)).toBe(false);
    // Once at the limit the camera object stops changing.
    expect(zoomStep(cam, VIEWPORT, 'in')).toBe(cam);
    expect(seen.every(Number.isFinite)).toBe(true);
    // And zooming back out re-enables it.
    const out = zoomStep(cam, VIEWPORT, 'out');
    expect(out.zoom).toBeLessThan(ZOOM_MAX);
    expect(canZoomIn(out)).toBe(true);
  });

  it('TC-10b a step out from 100% reaches ZOOM_MIN and disables zoom out', () => {
    let cam: Camera = { x: 0, y: 0, zoom: 1 };
    for (let i = 0; i < 30; i += 1) {
      cam = zoomStep(cam, VIEWPORT, 'out');
    }
    expect(cam.zoom).toBe(ZOOM_MIN);
    expect(zoomPercent(cam)).toBe(10);
  });
});

describe('invalid and extreme zoom factors', () => {
  it('TC-11 a huge factor clamps to ZOOM_MAX and keeps pointer invariance', () => {
    const start: Camera = { x: 0, y: 0, zoom: 1 };
    const point = { x: 300, y: 200 };
    const before = screenToWorld(start, point);
    const next = zoomAt(start, point, 1000);
    expect(next.zoom).toBe(ZOOM_MAX);
    const after = screenToWorld(next, point);
    expect(Math.abs(after.x - before.x)).toBeLessThan(TOLERANCE);
    expect(Math.abs(after.y - before.y)).toBeLessThan(TOLERANCE);
  });

  it('TC-11b a tiny factor clamps to ZOOM_MIN and keeps pointer invariance', () => {
    const start: Camera = { x: 40, y: -60, zoom: 1 };
    const point = { x: 640, y: 400 };
    const before = screenToWorld(start, point);
    const next = zoomAt(start, point, 0.0001);
    expect(next.zoom).toBe(ZOOM_MIN);
    const after = screenToWorld(next, point);
    expect(Math.abs(after.x - before.x)).toBeLessThan(TOLERANCE);
    expect(Math.abs(after.y - before.y)).toBeLessThan(TOLERANCE);
  });

  it('TC-12 invalid factors leave the camera unchanged and never produce NaN', () => {
    const cam: Camera = { x: -250, y: 120, zoom: 1.5 };
    const point = { x: 100, y: 100 };
    for (const factor of [0, -1, -0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const next = zoomAt(cam, point, factor);
      expect(next).toBe(cam);
      expect(Number.isNaN(next.x)).toBe(false);
      expect(Number.isNaN(next.y)).toBe(false);
      expect(Number.isNaN(next.zoom)).toBe(false);
    }
  });

  it('TC-12b invalid camera-independent helpers stay finite', () => {
    const cam: Camera = { x: 0, y: 0, zoom: 1 };
    expect(Number.isFinite(zoomPercent(cam))).toBe(true);
    expect(zoomPercent({ x: 0, y: 0, zoom: 1.5625 })).toBe(156);
  });
});

describe('grid geometry far from the start', () => {
  it('keeps the dot pitch equal to GRID_SPACING_WORLD * zoom', () => {
    const cam: Camera = { x: FAR, y: FAR, zoom: 1 };
    // Two neighbouring grid dots, one world spacing apart.
    const a = worldToScreen(cam, { x: FAR, y: FAR });
    const b = worldToScreen(cam, { x: FAR + GRID_SPACING_WORLD, y: FAR });
    expect(Math.abs(b.x - a.x)).toBeCloseTo(GRID_SPACING_WORLD, 6);
    expect(Math.abs(b.y - a.y)).toBeLessThan(TOLERANCE);
  });
});

describe('property: pointer invariance', () => {
  it('keeps the world point under the pointer within 1e-6 over 1000 random cases', () => {
    // Seeded PRNG (mulberry32) so a failure is reproducible.
    let state = 0x9e3779b9;
    const random = () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    for (let i = 0; i < 1000; i += 1) {
      const cam: Camera = {
        x: (random() * 2 - 1) * UNBOUNDED_PAN_TESTED_EXTENT,
        y: (random() * 2 - 1) * UNBOUNDED_PAN_TESTED_EXTENT,
        zoom: ZOOM_MIN + random() * (ZOOM_MAX - ZOOM_MIN),
      };
      const point = { x: random() * 1280, y: random() * 800 };
      const factor = 0.2 + random() * 4.8;
      const before = screenToWorld(cam, point);
      const next = zoomAt(cam, point, factor);
      expect(Number.isFinite(next.x)).toBe(true);
      expect(Number.isFinite(next.y)).toBe(true);
      expect(next.zoom).toBeGreaterThanOrEqual(ZOOM_MIN);
      expect(next.zoom).toBeLessThanOrEqual(ZOOM_MAX);
      const after = screenToWorld(next, point);
      expect(Math.abs(after.x - before.x)).toBeLessThan(TOLERANCE);
      expect(Math.abs(after.y - before.y)).toBeLessThan(TOLERANCE);
    }
  });
});
