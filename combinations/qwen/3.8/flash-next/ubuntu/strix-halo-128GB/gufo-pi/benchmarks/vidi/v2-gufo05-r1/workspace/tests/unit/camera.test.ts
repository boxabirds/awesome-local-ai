import { describe, expect, it } from 'vitest';

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
import {
  GRID_SPACING_WORLD,
  UNBOUNDED_PAN_TESTED_EXTENT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP_FACTOR,
} from '../../src/shared/config';

/** Precision for "exact" assertions on far-away world coordinates. */
const WORLD_EPSILON = 1e-6;

const VIEWPORT: Size = { width: 1200, height: 800 };
const CENTRE: Point = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };

const ORIGIN_CAM: Camera = { x: 0, y: 0, zoom: 1 };
const FAR_CAM: Camera = {
  x: UNBOUNDED_PAN_TESTED_EXTENT,
  y: UNBOUNDED_PAN_TESTED_EXTENT,
  zoom: 1,
};

function near(a: number, b: number, epsilon = WORLD_EPSILON): boolean {
  return Math.abs(a - b) <= epsilon;
}

describe('screenToWorld / worldToScreen', () => {
  it('are inverses of each other', () => {
    const cam: Camera = { x: -137.5, y: 92.25, zoom: 1.75 };
    const p: Point = { x: 411, y: 88 };
    const round = worldToScreen(cam, screenToWorld(cam, p));
    expect(round.x).toBeCloseTo(p.x, 9);
    expect(round.y).toBeCloseTo(p.y, 9);
  });

  it('places the camera position at the viewport top-left', () => {
    const cam: Camera = { x: 40, y: -20, zoom: 2 };
    expect(worldToScreen(cam, { x: cam.x, y: cam.y })).toEqual({ x: 0, y: 0 });
  });
});

describe('panBy', () => {
  // TC-01
  it('TC-01 moves the camera by -delta/zoom at zoom 1 from the origin', () => {
    const next = panBy(ORIGIN_CAM, 200, 100);
    expect(next.x).toBe(-200);
    expect(next.y).toBe(-100);
    expect(next.zoom).toBe(1);
    // The world origin, which started at screen (0,0), is now at (200,100).
    expect(worldToScreen(ORIGIN_CAM, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    expect(worldToScreen(next, { x: 0, y: 0 })).toEqual({ x: 200, y: 100 });
  });

  // TC-02
  it('TC-02 moves by -delta/zoom world units at ZOOM_MAX far from the origin', () => {
    const cam: Camera = {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: ZOOM_MAX,
    };
    const next = panBy(cam, 200, 100);
    expect(near(next.x, UNBOUNDED_PAN_TESTED_EXTENT - 200 / ZOOM_MAX)).toBe(true);
    expect(near(next.y, UNBOUNDED_PAN_TESTED_EXTENT - 100 / ZOOM_MAX)).toBe(true);
    // A 200 px drag still moves a world point exactly 200 screen pixels.
    expect(near(worldToScreen(next, { x: cam.x, y: cam.y }).x, 200)).toBe(true);
  });

  it('returns the same object for a zero-length drag', () => {
    expect(panBy(FAR_CAM, 0, 0)).toBe(FAR_CAM);
  });

  it('does not clamp position: panning beyond UNBOUNDED_PAN_TESTED_EXTENT works', () => {
    const far = panBy(ORIGIN_CAM, UNBOUNDED_PAN_TESTED_EXTENT * 2, -UNBOUNDED_PAN_TESTED_EXTENT);
    expect(far.x).toBe(-UNBOUNDED_PAN_TESTED_EXTENT * 2);
    expect(far.y).toBe(UNBOUNDED_PAN_TESTED_EXTENT);
    expect(Number.isFinite(far.x)).toBe(true);
    // Sub-pixel precision survives: a 1 px drag still moves the view by 1 px.
    expect(near(worldToScreen(far, { x: far.x, y: far.y }).x, 0)).toBe(true);
    expect(near(worldToScreen(panBy(far, 1, 0), { x: far.x, y: far.y }).x, 1)).toBe(true);
  });
});

describe('zoomAt', () => {
  // TC-03
  it('TC-03 doubles the zoom and keeps the world point under the pointer fixed', () => {
    const p: Point = { x: 300, y: 200 };
    const before = screenToWorld(ORIGIN_CAM, p);
    const next = zoomAt(ORIGIN_CAM, p, 2);
    expect(next.zoom).toBe(2);
    const after = screenToWorld(next, p);
    expect(near(after.x, before.x)).toBe(true);
    expect(near(after.y, before.y)).toBe(true);
    expect(near(worldToScreen(next, before).x, p.x)).toBe(true);
    expect(near(worldToScreen(next, before).y, p.y)).toBe(true);
  });

  // TC-04
  it('TC-04 keeps the pointer invariant far away (UNBOUNDED_PAN_TESTED_EXTENT)', () => {
    const p: Point = { x: 640, y: 400 };
    const before = screenToWorld(FAR_CAM, p);
    const next = zoomAt(FAR_CAM, p, 1.5);
    const after = screenToWorld(next, p);
    expect(next.zoom).toBeCloseTo(1.5, 9);
    expect(near(after.x, before.x)).toBe(true);
    expect(near(after.y, before.y)).toBe(true);
  });

  // TC-05
  it('TC-05 returns the same object when already at ZOOM_MIN and zooming out', () => {
    const cam: Camera = { x: 0, y: 0, zoom: ZOOM_MIN };
    const next = zoomAt(cam, CENTRE, 1 / ZOOM_STEP_FACTOR);
    expect(next).toBe(cam);
    expect(next.x).toBe(cam.x);
    expect(next.y).toBe(cam.y);
  });

  // TC-06
  it('TC-06 returns the same object when already at ZOOM_MAX and zooming in', () => {
    const cam: Camera = { x: 0, y: 0, zoom: ZOOM_MAX };
    const next = zoomAt(cam, CENTRE, ZOOM_STEP_FACTOR);
    expect(next).toBe(cam);
    expect(next.x).toBe(cam.x);
    expect(next.y).toBe(cam.y);
  });

  // TC-11
  it('TC-11 clamps a huge factor to ZOOM_MAX and still keeps the pointer fixed', () => {
    const p: Point = { x: 250, y: 700 };
    const before = screenToWorld(ORIGIN_CAM, p);
    const next = zoomAt(ORIGIN_CAM, p, 1000);
    expect(next.zoom).toBe(ZOOM_MAX);
    const afterScreen = worldToScreen(next, before);
    expect(near(afterScreen.x, p.x)).toBe(true);
    expect(near(afterScreen.y, p.y)).toBe(true);
  });

  it('clamps a tiny factor to ZOOM_MIN and still keeps the pointer fixed', () => {
    const p: Point = { x: 100, y: 120 };
    const before = screenToWorld(ORIGIN_CAM, p);
    const next = zoomAt(ORIGIN_CAM, p, 1e-6);
    expect(next.zoom).toBe(ZOOM_MIN);
    const afterScreen = worldToScreen(next, before);
    expect(near(afterScreen.x, p.x)).toBe(true);
    expect(near(afterScreen.y, p.y)).toBe(true);
  });

  // TC-12
  it.each([
    ['zero', 0],
    ['negative', -1.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ])('TC-12 returns the input camera unchanged for factor %s', (_label, factor) => {
    const next = zoomAt(FAR_CAM, CENTRE, factor);
    expect(next).toBe(FAR_CAM);
  });

  it('TC-12 never produces NaN for invalid factors', () => {
    for (const factor of [0, -3, Number.NaN, Infinity]) {
      const unchanged = zoomAt(ORIGIN_CAM, CENTRE, factor);
      expect(Number.isNaN(unchanged.x)).toBe(false);
      expect(Number.isNaN(unchanged.y)).toBe(false);
      expect(Number.isNaN(unchanged.zoom)).toBe(false);
    }
  });
});

describe('zoomStep', () => {
  // TC-09
  it('TC-09 steps in then out and returns exactly 1.0', () => {
    const one = zoomStep(ORIGIN_CAM, VIEWPORT, 'in');
    expect(one.zoom).toBe(ZOOM_STEP_FACTOR);
    expect(zoomPercent(one)).toBe(Math.round(ZOOM_STEP_FACTOR * 100));
    const back = zoomStep(one, VIEWPORT, 'out');
    expect(back.zoom).toBe(1);
    expect(back.x).toBeCloseTo(0, 9);
    expect(back.y).toBeCloseTo(0, 9);
    expect(zoomPercent(back)).toBe(100);
  });

  it('TC-09 keeps the viewport centre fixed while stepping', () => {
    const before = screenToWorld(ORIGIN_CAM, CENTRE);
    const one = zoomStep(ORIGIN_CAM, VIEWPORT, 'in');
    const after = screenToWorld(one, CENTRE);
    expect(near(after.x, before.x)).toBe(true);
    expect(near(after.y, before.y)).toBe(true);
  });

  // TC-10
  it('TC-10 clamps after many steps in and reports canZoomIn false', () => {
    let cam: Camera = ORIGIN_CAM;
    for (let i = 0; i < 20; i += 1) cam = zoomStep(cam, VIEWPORT, 'in');
    expect(cam.zoom).toBe(ZOOM_MAX);
    expect(canZoomIn(cam)).toBe(false);
    expect(zoomPercent(cam)).toBe(Math.round(ZOOM_MAX * 100));
  });

  it('clamps after many steps out and reports canZoomOut false', () => {
    let cam: Camera = ORIGIN_CAM;
    for (let i = 0; i < 20; i += 1) cam = zoomStep(cam, VIEWPORT, 'out');
    expect(cam.zoom).toBe(ZOOM_MIN);
    expect(canZoomOut(cam)).toBe(false);
    expect(zoomPercent(cam)).toBe(Math.round(ZOOM_MIN * 100));
  });

  it('returns the same object when a step would exceed a limit', () => {
    const atMax: Camera = { x: 5, y: 6, zoom: ZOOM_MAX };
    expect(zoomStep(atMax, VIEWPORT, 'in')).toBe(atMax);
    const atMin: Camera = { x: 5, y: 6, zoom: ZOOM_MIN };
    expect(zoomStep(atMin, VIEWPORT, 'out')).toBe(atMin);
  });
});

describe('resetCamera', () => {
  // TC-08
  it('TC-08 resets to zoom 1 with the world origin centred', () => {
    const cam = resetCamera({ width: 1200, height: 800 });
    expect(cam.zoom).toBe(1);
    expect(cam.x).toBe(-600);
    expect(cam.y).toBe(-400);
    expect(worldToScreen(cam, { x: 0, y: 0 })).toEqual({ x: 600, y: 400 });
  });

  it('TC-08 resets from far away and maximum zoom', () => {
    const far: Camera = { x: UNBOUNDED_PAN_TESTED_EXTENT, y: -UNBOUNDED_PAN_TESTED_EXTENT, zoom: ZOOM_MAX };
    const cam = resetCamera(VIEWPORT);
    expect(cam.zoom).toBeLessThan(far.zoom);
    expect(worldToScreen(cam, { x: 0, y: 0 })).toEqual({
      x: VIEWPORT.width / 2,
      y: VIEWPORT.height / 2,
    });
  });
});

describe('resize', () => {
  // TC-07
  it('TC-07 leaves the camera unchanged: the top-left world point stays at screen (0,0)', () => {
    const cam: Camera = { x: -300, y: 210, zoom: ZOOM_STEP_FACTOR };
    const before = { ...cam };
    // Resizing the window does not call into camera maths at all: the camera
    // stores the world coordinate at the viewport's top-left corner, so the
    // content relative to that corner does not move.
    const small: Size = { width: 320, height: 240 };
    const large: Size = { width: 1920, height: 1080 };
    expect(worldToScreen(cam, { x: cam.x, y: cam.y })).toEqual({ x: 0, y: 0 });
    expect(screenToWorld(cam, { x: 0, y: 0 })).toEqual({ x: cam.x, y: cam.y });
    expect(screenToWorld(cam, { x: small.width, y: small.height }).x).toBeCloseTo(
      cam.x + small.width / cam.zoom,
      9,
    );
    expect(screenToWorld(cam, { x: large.width, y: large.height }).x).toBeCloseTo(
      cam.x + large.width / cam.zoom,
      9,
    );
    // Nothing above mutated the camera.
    expect(cam).toEqual(before);
  });
});

describe('zoomPercent and canZoom', () => {
  it('rounds to the nearest whole percent', () => {
    expect(zoomPercent({ x: 0, y: 0, zoom: 1 })).toBe(100);
    expect(zoomPercent({ x: 0, y: 0, zoom: ZOOM_STEP_FACTOR ** 2 })).toBe(156);
    expect(zoomPercent({ x: 0, y: 0, zoom: ZOOM_MIN })).toBe(10);
    expect(zoomPercent({ x: 0, y: 0, zoom: ZOOM_MAX })).toBe(400);
  });

  it('reports zoom headroom', () => {
    expect(canZoomIn(ORIGIN_CAM)).toBe(true);
    expect(canZoomOut(ORIGIN_CAM)).toBe(true);
    expect(canZoomIn({ x: 0, y: 0, zoom: ZOOM_MAX })).toBe(false);
    expect(canZoomOut({ x: 0, y: 0, zoom: ZOOM_MIN })).toBe(false);
  });
});

describe('grid', () => {
  it('spacing in screen pixels is GRID_SPACING_WORLD * zoom at any camera position', () => {
    const cam: Camera = { x: 12_345.5, y: -678.25, zoom: 1.5 };
    const a = worldToScreen(cam, { x: 0, y: 0 });
    const b = worldToScreen(cam, { x: GRID_SPACING_WORLD, y: 0 });
    expect(b.x - a.x).toBeCloseTo(GRID_SPACING_WORLD * cam.zoom, 9);
  });
});

describe('pointer invariance property', () => {
  it('keeps the world point under the pointer for 1,000 random inputs', () => {
    // Deterministic PRNG (mulberry32) so failures are reproducible.
    let state = 0x1a2b3c4d;
    const rand = (): number => {
      state |= 0;
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const range = (lo: number, hi: number) => lo + rand() * (hi - lo);

    for (let i = 0; i < 1000; i += 1) {
      const cam: Camera = {
        x: range(-UNBOUNDED_PAN_TESTED_EXTENT, UNBOUNDED_PAN_TESTED_EXTENT),
        y: range(-UNBOUNDED_PAN_TESTED_EXTENT, UNBOUNDED_PAN_TESTED_EXTENT),
        zoom: range(ZOOM_MIN, ZOOM_MAX),
      };
      const p: Point = { x: range(0, 1920), y: range(0, 1080) };
      const factor = range(0.02, 50);
      const world = screenToWorld(cam, p);
      const next = zoomAt(cam, p, factor);
      expect(Number.isFinite(next.x)).toBe(true);
      expect(Number.isFinite(next.y)).toBe(true);
      expect(next.zoom).toBeGreaterThanOrEqual(ZOOM_MIN);
      expect(next.zoom).toBeLessThanOrEqual(ZOOM_MAX);
      const screen = worldToScreen(next, world);
      expect(Math.abs(screen.x - p.x)).toBeLessThan(WORLD_EPSILON);
      expect(Math.abs(screen.y - p.y)).toBeLessThan(WORLD_EPSILON);
    }
  });
});
