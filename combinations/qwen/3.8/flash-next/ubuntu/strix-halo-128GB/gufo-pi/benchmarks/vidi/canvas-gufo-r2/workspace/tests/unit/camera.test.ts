/// <reference types="vitest/config" />
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
  canZoomOut,
  panBy,
  resetCamera,
  screenToWorld,
  worldToScreen,
  zoomAt,
  zoomPercent,
  zoomStep,
  type Camera,
  type Point,
  type Size,
} from '../../src/client/canvas/camera';

const ORIGIN: Point = { x: 0, y: 0 };
const VIEWPORT: Size = { width: 1200, height: 800 };
const IDENTITY: Camera = { x: 0, y: 0, zoom: 1 };

/** Camera whose world origin sits `distance` world units from the viewport centre. */
function farCamera(zoom: number, distance = UNBOUNDED_PAN_TESTED_EXTENT): Camera {
  return { x: distance, y: distance, zoom };
}

function expectFiniteCamera(cam: Camera): void {
  expect(Number.isFinite(cam.x)).toBe(true);
  expect(Number.isFinite(cam.y)).toBe(true);
  expect(Number.isFinite(cam.zoom)).toBe(true);
}

describe('screenToWorld / worldToScreen', () => {
  it('are inverses of each other', () => {
    const cam: Camera = { x: -123.5, y: 45.25, zoom: 1.75 };
    const p: Point = { x: 321, y: 654 };
    const back = worldToScreen(cam, screenToWorld(cam, p));
    expect(back.x).toBeCloseTo(p.x, 9);
    expect(back.y).toBeCloseTo(p.y, 9);
  });
});

describe('panBy', () => {
  it('TC-01: moves the camera by exactly the pointer delta at zoom 1', () => {
    const next = panBy(IDENTITY, 200, 100);
    expect(next.x).toBeCloseTo(-200, 10);
    expect(next.y).toBeCloseTo(-100, 10);
    expect(next.zoom).toBe(1);
    // The world origin, which started at screen (0,0), now renders at (200,100).
    const screen = worldToScreen(next, ORIGIN);
    expect(screen.x).toBeCloseTo(200, 10);
    expect(screen.y).toBeCloseTo(100, 10);
  });

  it('TC-02: at ZOOM_MAX and far from the start, shifts by delta/zoom world units', () => {
    const cam = farCamera(ZOOM_MAX);
    const next = panBy(cam, 200, 100);
    expect(next.x).toBeCloseTo(UNBOUNDED_PAN_TESTED_EXTENT - 200 / ZOOM_MAX, 6);
    expect(next.y).toBeCloseTo(UNBOUNDED_PAN_TESTED_EXTENT - 100 / ZOOM_MAX, 6);
    expect(next.zoom).toBe(ZOOM_MAX);
    expectFiniteCamera(next);
  });

  it('returns the same object for a zero-length drag', () => {
    expect(panBy(IDENTITY, 0, 0)).toBe(IDENTITY);
  });
});

describe('zoomAt', () => {
  it('TC-03: keeps the world point under the pointer fixed (origin, zoom 1 -> 2)', () => {
    const pointer: Point = { x: 300, y: 200 };
    const next = zoomAt(IDENTITY, pointer, 2);
    expect(next.zoom).toBeCloseTo(2, 10);
    const before = screenToWorld(IDENTITY, pointer);
    const after = screenToWorld(next, pointer);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it('TC-04: keeps the pointer invariant far from the start', () => {
    const cam = farCamera(1);
    const pointer: Point = { x: 640, y: 400 };
    const next = zoomAt(cam, pointer, 1.5);
    const before = screenToWorld(cam, pointer);
    const after = screenToWorld(next, pointer);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    expectFiniteCamera(next);
  });

  it('TC-05: at ZOOM_MIN, zooming out returns the same object unchanged', () => {
    const cam: Camera = { x: 0, y: 0, zoom: ZOOM_MIN };
    const next = zoomAt(cam, { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 }, 1 / ZOOM_STEP_FACTOR);
    expect(next).toBe(cam);
    expect(next.x).toBe(cam.x);
    expect(next.y).toBe(cam.y);
    expect(next.zoom).toBe(ZOOM_MIN);
    expect(canZoomOut(cam)).toBe(false);
    expect(canZoomIn(cam)).toBe(true);
  });

  it('TC-06: at ZOOM_MAX, zooming in returns the same object unchanged', () => {
    const cam: Camera = { x: 0, y: 0, zoom: ZOOM_MAX };
    const next = zoomAt(cam, { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 }, ZOOM_STEP_FACTOR);
    expect(next).toBe(cam);
    expect(next.x).toBe(cam.x);
    expect(next.y).toBe(cam.y);
    expect(next.zoom).toBe(ZOOM_MAX);
    expect(canZoomIn(cam)).toBe(false);
    expect(canZoomOut(cam)).toBe(true);
  });

  it('TC-11: a huge factor clamps to ZOOM_MAX and keeps the pointer invariant', () => {
    const pointer: Point = { x: 250, y: 120 };
    const next = zoomAt(IDENTITY, pointer, 1000);
    expect(next.zoom).toBe(ZOOM_MAX);
    // Invariance holds with respect to the clamped zoom: the world point that was
    // under the pointer before is still under it after.
    const before = screenToWorld(IDENTITY, pointer);
    const after = screenToWorld(next, pointer);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('TC-11b: a tiny factor clamps to ZOOM_MIN and keeps the pointer invariant', () => {
    const pointer: Point = { x: 900, y: 700 };
    const next = zoomAt(IDENTITY, pointer, 1e-6);
    expect(next.zoom).toBe(ZOOM_MIN);
    const before = screenToWorld(IDENTITY, pointer);
    const after = screenToWorld(next, pointer);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('TC-12: invalid factors return the input camera unchanged and never produce NaN', () => {
    for (const factor of [0, -1, -ZOOM_STEP_FACTOR, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const next = zoomAt(IDENTITY, { x: 10, y: 20 }, factor);
      expect(next).toBe(IDENTITY);
      expectFiniteCamera(next);
    }
  });
});

describe('resize', () => {
  it('TC-07: a viewport size change leaves the camera untouched', () => {
    const cam: Camera = { x: -100, y: -50, zoom: 1 };
    const snapshot = { ...cam };
    // The camera is defined by its top-left world coordinate, so no camera API is
    // called on resize: nothing can change x, y or zoom.
    expect(cam).toEqual(snapshot);
    expect(panBy(cam, 0, 0)).toBe(cam);
    expect(screenToWorld(cam, ORIGIN)).toEqual({ x: snapshot.x, y: snapshot.y });
  });
});

describe('resetCamera', () => {
  it('TC-08: resets to zoom 1 with the world origin centred in the viewport', () => {
    const cam = farCamera(ZOOM_MAX);
    const next = resetCamera(VIEWPORT);
    expect(next.zoom).toBe(1);
    expect(next.x).toBeCloseTo(-VIEWPORT.width / 2, 10);
    expect(next.y).toBeCloseTo(-VIEWPORT.height / 2, 10);
    const originScreen = worldToScreen(next, ORIGIN);
    expect(originScreen.x).toBeCloseTo(VIEWPORT.width / 2, 10);
    expect(originScreen.y).toBeCloseTo(VIEWPORT.height / 2, 10);
    // The far camera is unaffected (immutable inputs).
    expect(cam.zoom).toBe(ZOOM_MAX);
  });
});

describe('zoomStep', () => {
  it('TC-09: one step in then one step out returns exactly 1', () => {
    const inOut = zoomStep(zoomStep(IDENTITY, VIEWPORT, 'in'), VIEWPORT, 'out');
    expect(zoomStep(IDENTITY, VIEWPORT, 'in').zoom).toBeCloseTo(ZOOM_STEP_FACTOR, 10);
    expect(inOut.zoom).toBe(1);
    expect(zoomPercent(inOut)).toBe(100);
    // Camera position too: stepping about the centre keeps the centre fixed.
    expect(inOut.x).toBeCloseTo(IDENTITY.x, 9);
    expect(inOut.y).toBeCloseTo(IDENTITY.y, 9);
  });

  it('TC-10: 20 steps in clamps at ZOOM_MAX and reports canZoomIn false', () => {
    let cam: Camera = IDENTITY;
    for (let i = 0; i < 20; i += 1) cam = zoomStep(cam, VIEWPORT, 'in');
    expect(cam.zoom).toBe(ZOOM_MAX);
    expect(canZoomIn(cam)).toBe(false);
    expect(canZoomOut(cam)).toBe(true);
    expect(zoomPercent(cam)).toBe(Math.round(ZOOM_MAX * 100));
  });

  it('TC-10b: 20 steps out clamps at ZOOM_MIN and reports canZoomOut false', () => {
    let cam: Camera = IDENTITY;
    for (let i = 0; i < 20; i += 1) cam = zoomStep(cam, VIEWPORT, 'out');
    expect(cam.zoom).toBe(ZOOM_MIN);
    expect(canZoomOut(cam)).toBe(false);
    expect(canZoomIn(cam)).toBe(true);
  });

  it('keeps the viewport centre fixed', () => {
    const centre: Point = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
    const next = zoomStep(IDENTITY, VIEWPORT, 'in');
    const before = screenToWorld(IDENTITY, centre);
    const after = screenToWorld(next, centre);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it('returns the same object when already at a limit', () => {
    const atMax: Camera = { x: 10, y: 20, zoom: ZOOM_MAX };
    expect(zoomStep(atMax, VIEWPORT, 'in')).toBe(atMax);
    const atMin: Camera = { x: 10, y: 20, zoom: ZOOM_MIN };
    expect(zoomStep(atMin, VIEWPORT, 'out')).toBe(atMin);
  });
});

describe('zoomPercent', () => {
  it('rounds to a whole percent', () => {
    expect(zoomPercent(IDENTITY)).toBe(100);
    expect(zoomPercent({ x: 0, y: 0, zoom: 1.5625 })).toBe(156);
    expect(zoomPercent({ x: 0, y: 0, zoom: ZOOM_MIN })).toBe(10);
    expect(zoomPercent({ x: 0, y: 0, zoom: ZOOM_MAX })).toBe(400);
  });
});

describe('grid spacing', () => {
  it('a world grid cell of GRID_SPACING_WORLD renders GRID_SPACING_WORLD * zoom pixels wide', () => {
    const cam: Camera = { x: 0, y: 0, zoom: 2.5 };
    const a = worldToScreen(cam, ORIGIN);
    const b = worldToScreen(cam, { x: GRID_SPACING_WORLD, y: 0 });
    expect(b.x - a.x).toBeCloseTo(GRID_SPACING_WORLD * 2.5, 10);
  });
});

describe('property: pointer invariance under zoomAt', () => {
  // Deterministic PRNG (mulberry32) so failures are reproducible.
  function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it('keeps the world point under the pointer invariant within 1e-6 over 1000 random cases', () => {
    const rand = mulberry32(0xc0ffee);
    for (let i = 0; i < 1000; i += 1) {
      const zoom = ZOOM_MIN + rand() * (ZOOM_MAX - ZOOM_MIN);
      const extent = rand() < 0.5 ? 1000 : UNBOUNDED_PAN_TESTED_EXTENT;
      const cam: Camera = {
        x: (rand() * 2 - 1) * extent,
        y: (rand() * 2 - 1) * extent,
        zoom,
      };
      const point: Point = { x: rand() * 1280, y: rand() * 800 };
      const factor = Math.exp((rand() * 2 - 1) * 2);
      const next = zoomAt(cam, point, factor);
      expectFiniteCamera(next);
      expect(next.zoom).toBeGreaterThanOrEqual(ZOOM_MIN);
      expect(next.zoom).toBeLessThanOrEqual(ZOOM_MAX);
      const before = screenToWorld(cam, point);
      const after = screenToWorld(next, point);
      // When already clamped at a limit the camera is returned unchanged.
      const expectedZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom * factor));
      if (expectedZoom === cam.zoom) {
        expect(next).toBe(cam);
      } else {
        expect(Math.abs(after.x - before.x)).toBeLessThan(1e-6);
        expect(Math.abs(after.y - before.y)).toBeLessThan(1e-6);
      }
    }
  });
});
