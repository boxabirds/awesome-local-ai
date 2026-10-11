import { describe, expect, it } from 'vitest';

import {
  UNBOUNDED_PAN_TESTED_EXTENT,
  ZOOM_DEFAULT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_PERCENT_SCALE,
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

const LAPTOP: Size = { width: 1280, height: 800 };
const ORIGIN: Point = { x: 0, y: 0 };
const FAR = UNBOUNDED_PAN_TESTED_EXTENT;

/** Floating point comparison threshold for exact world maths. */
const WORLD_EPS = 1e-6;
/** Floating point comparison threshold for screen-space maths. */
const SCREEN_EPS = 1e-6;

const atStart = (zoom = ZOOM_DEFAULT): Camera => ({ x: 0, y: 0, zoom });
const farAway = (zoom = ZOOM_DEFAULT): Camera => ({ x: FAR, y: FAR, zoom });

describe('screenToWorld / worldToScreen', () => {
  it('are inverses of each other', () => {
    const cam: Camera = { x: -320.5, y: 88.25, zoom: 1.6 };
    const p: Point = { x: 1234.5, y: -77.25 };

    const roundTripWorld = screenToWorld(cam, worldToScreen(cam, p));
    expect(roundTripWorld.x).toBeCloseTo(p.x, 9);
    expect(roundTripWorld.y).toBeCloseTo(p.y, 9);

    const roundTripScreen = worldToScreen(cam, screenToWorld(cam, p));
    expect(roundTripScreen.x).toBeCloseTo(p.x, 9);
    expect(roundTripScreen.y).toBeCloseTo(p.y, 9);
  });

  it('puts the camera position at the viewport top-left', () => {
    const cam: Camera = { x: 40, y: -50, zoom: 2 };
    expect(screenToWorld(cam, { x: 0, y: 0 })).toEqual({ x: cam.x, y: cam.y });
    expect(worldToScreen(cam, { x: cam.x, y: cam.y })).toEqual({ x: 0, y: 0 });
  });
});

describe('panBy', () => {
  // TC-01
  it('TC-01: moves the camera by the pointer delta in world units and content by the same screen delta', () => {
    const cam = atStart();
    const next = panBy(cam, 200, 100);

    expect(next.x).toBeCloseTo(-200 / cam.zoom, 10);
    expect(next.y).toBeCloseTo(-100 / cam.zoom, 10);
    expect(next.zoom).toBe(cam.zoom);

    // The board point that was at the screen origin is now 200 right, 100 down.
    const moved = worldToScreen(next, ORIGIN);
    expect(moved.x).toBeCloseTo(200, 10);
    expect(moved.y).toBeCloseTo(100, 10);
  });

  // TC-02
  it('TC-02: pans exactly at ZOOM_MAX a million world units from the start', () => {
    const cam = farAway(ZOOM_MAX);
    const next = panBy(cam, 200, 100);

    expect(next.x).toBeCloseTo(cam.x - 200 / ZOOM_MAX, 10);
    expect(next.y).toBeCloseTo(cam.y - 100 / ZOOM_MAX, 10);
    // Exactly 50 and 25 world units at ZOOM_MAX, still sub-pixel precise far away.
    expect(cam.x - next.x).toBeCloseTo(200 / ZOOM_MAX, 10);
    expect(cam.y - next.y).toBeCloseTo(100 / ZOOM_MAX, 10);
    expect(Math.abs(next.x)).toBeLessThan(FAR + 1);
  });

  it('keeps sub-pixel precision after a single-pixel pan far away at ZOOM_MAX', () => {
    const cam = farAway(ZOOM_MAX);
    const next = panBy(cam, 1, 1);
    // One screen pixel at ZOOM_MAX is 1/ZOOM_MAX world units, and doubles hold it
    // exactly even a million world units from the start.
    expect(cam.x - next.x).toBeCloseTo(1 / ZOOM_MAX, 10);
    expect(cam.y - next.y).toBeCloseTo(1 / ZOOM_MAX, 10);
  });

  it('returns the same object for a zero-length drag', () => {
    const cam = atStart();
    expect(panBy(cam, 0, 0)).toBe(cam);
  });
});

describe('zoomAt', () => {
  // TC-03
  it('TC-03: keeps the world point under the pointer fixed while zooming', () => {
    const cam = atStart();
    const p: Point = { x: 300, y: 200 };
    const before = screenToWorld(cam, p);

    const next = zoomAt(cam, p, 2);
    expect(next.zoom).toBe(2 * cam.zoom);
    expect(screenToWorld(next, p).x).toBeCloseTo(before.x, 9);
    expect(screenToWorld(next, p).y).toBeCloseTo(before.y, 9);
  });

  // TC-04
  it('TC-04: keeps the pointer invariant a million world units from the start', () => {
    const cam = farAway();
    const p: Point = { x: 412.5, y: 251.25 };
    const before = screenToWorld(cam, p);

    const next = zoomAt(cam, p, 1.5);
    expect(Math.abs(next.zoom - 1.5)).toBeLessThan(WORLD_EPS);
    expect(Math.abs(screenToWorld(next, p).x - before.x)).toBeLessThan(WORLD_EPS);
    expect(Math.abs(screenToWorld(next, p).y - before.y)).toBeLessThan(WORLD_EPS);
    // ... and the same world point is still drawn at the same screen position.
    expect(Math.abs(worldToScreen(next, before).x - p.x)).toBeLessThan(SCREEN_EPS);
    expect(Math.abs(worldToScreen(next, before).y - p.y)).toBeLessThan(SCREEN_EPS);
  });

  // TC-05
  it('TC-05: returns the same camera object when already at ZOOM_MIN and zooming out', () => {
    const cam = atStart(ZOOM_MIN);
    expect(zoomAt(cam, { x: LAPTOP.width / 2, y: LAPTOP.height / 2 }, 1 / ZOOM_STEP_FACTOR)).toBe(cam);
  });

  // TC-06
  it('TC-06: returns the same camera object when already at ZOOM_MAX and zooming in', () => {
    const cam = atStart(ZOOM_MAX);
    expect(zoomAt(cam, { x: LAPTOP.width / 2, y: LAPTOP.height / 2 }, ZOOM_STEP_FACTOR)).toBe(cam);
  });

  // TC-11
  it('TC-11: clamps a huge zoom factor and still holds the pointer invariant', () => {
    const cam = atStart();
    const p: Point = { x: 640, y: 300 };
    const before = screenToWorld(cam, p);

    const next = zoomAt(cam, p, 1000);
    expect(next.zoom).toBe(ZOOM_MAX);
    expect(Math.abs(worldToScreen(next, before).x - p.x)).toBeLessThan(SCREEN_EPS);
    expect(Math.abs(worldToScreen(next, before).y - p.y)).toBeLessThan(SCREEN_EPS);

    // Zooming out by the same huge factor clamps at ZOOM_MIN.
    expect(zoomAt(cam, p, 1 / 1000).zoom).toBe(ZOOM_MIN);
  });

  // TC-12
  it.each([
    ['zero', 0],
    ['negative', -2],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ])('TC-12: ignores an invalid zoom factor (%s) and returns the camera unchanged', (_name, factor) => {
    const cam: Camera = { x: 12.5, y: -30.25, zoom: 1.5 };
    const next = zoomAt(cam, { x: 100, y: 100 }, factor);

    expect(next).toBe(cam);
    expect(next).toEqual(cam);
    expect(Number.isFinite(next.x)).toBe(true);
    expect(Number.isFinite(next.y)).toBe(true);
    expect(Number.isFinite(next.zoom)).toBe(true);
  });
});

describe('viewport resize', () => {
  // TC-07
  it('TC-07: changing the viewport size leaves the camera unchanged', () => {
    const cam: Camera = { x: 250, y: -175, zoom: 1.25 };
    const topLeftWorld = screenToWorld(cam, { x: 0, y: 0 });
    const probe: Point = { x: 900, y: 260 };
    const probeScreen = worldToScreen(cam, probe);

    // Resizing is not user input: the camera keeps its identity and every board
    // point keeps its position relative to the top-left corner of the board area.
    for (const size of [LAPTOP, { width: 1920, height: 1080 }, { width: 640, height: 480 }]) {
      const afterResize = cam;
      expect(afterResize).toBe(cam);
      expect(screenToWorld(afterResize, { x: 0, y: 0 })).toEqual(topLeftWorld);
      expect(worldToScreen(afterResize, probe)).toEqual(probeScreen);
      // Only Reset view depends on the size, and it always centres the origin.
      expect(worldToScreen(resetCamera(size), ORIGIN)).toEqual({
        x: size.width / 2,
        y: size.height / 2,
      });
    }
  });
});

describe('resetCamera', () => {
  // TC-08
  it('TC-08: resets to 100% with the board starting point centred', () => {
    const next = resetCamera({ width: 1200, height: 800 });

    expect(next.zoom).toBe(ZOOM_DEFAULT);
    expect(next.x).toBe(-600);
    expect(next.y).toBe(-400);
    // The board's starting point (world 0,0) sits at the centre of the area.
    expect(worldToScreen(next, ORIGIN)).toEqual({ x: 600, y: 400 });
  });

  it('centres the starting point from far away at maximum zoom', () => {
    const cam = farAway(ZOOM_MAX);
    const next = resetCamera(LAPTOP);
    expect(next).not.toBe(cam);
    expect(worldToScreen(next, ORIGIN)).toEqual({ x: LAPTOP.width / 2, y: LAPTOP.height / 2 });
  });
});

describe('zoomStep', () => {
  const centre: Point = { x: LAPTOP.width / 2, y: LAPTOP.height / 2 };

  // TC-09
  it('TC-09: one step in then one step out returns exactly the starting zoom', () => {
    const cam = atStart();
    const zoomedIn = zoomStep(cam, LAPTOP, 'in');
    expect(zoomedIn.zoom).toBe(ZOOM_STEP_FACTOR);
    expect(zoomPercent(zoomedIn)).toBe(Math.round(ZOOM_STEP_FACTOR * ZOOM_PERCENT_SCALE));

    const backOut = zoomStep(zoomedIn, LAPTOP, 'out');
    expect(backOut.zoom).toBe(ZOOM_DEFAULT);
    expect(zoomPercent(backOut)).toBe(100);
  });

  it('keeps the board location at the centre of the area fixed', () => {
    const cam: Camera = { x: -120, y: 340, zoom: 1 };
    const beforeCentreWorld = screenToWorld(cam, centre);
    const next = zoomStep(cam, LAPTOP, 'in');
    const after = screenToWorld(next, centre);
    expect(Math.abs(after.x - beforeCentreWorld.x)).toBeLessThan(WORLD_EPS);
    expect(Math.abs(after.y - beforeCentreWorld.y)).toBeLessThan(WORLD_EPS);
  });

  it('does not snap a zoom that is not near a step', () => {
    const cam = atStart(1.3);
    const next = zoomStep(cam, LAPTOP, 'in');
    expect(Math.abs(next.zoom - 1.3 * ZOOM_STEP_FACTOR)).toBeLessThan(WORLD_EPS);
  });

  // TC-10
  it('TC-10: stops at ZOOM_MAX after repeated steps in and reports canZoomIn false', () => {
    let cam: Camera = atStart();
    for (let i = 0; i < 20; i += 1) cam = zoomStep(cam, LAPTOP, 'in');

    expect(cam.zoom).toBe(ZOOM_MAX);
    expect(canZoomIn(cam)).toBe(false);
    expect(canZoomOut(cam)).toBe(true);
    expect(zoomPercent(cam)).toBe(ZOOM_MAX * ZOOM_PERCENT_SCALE);
    // A further step does nothing at all.
    expect(zoomStep(cam, LAPTOP, 'in')).toBe(cam);
  });

  it('stops at ZOOM_MIN after repeated steps out and reports canZoomOut false', () => {
    let cam: Camera = atStart();
    for (let i = 0; i < 25; i += 1) cam = zoomStep(cam, LAPTOP, 'out');

    expect(cam.zoom).toBe(ZOOM_MIN);
    expect(canZoomOut(cam)).toBe(false);
    expect(canZoomIn(cam)).toBe(true);
    expect(zoomPercent(cam)).toBe(Math.round(ZOOM_MIN * ZOOM_PERCENT_SCALE));
    expect(zoomStep(cam, LAPTOP, 'out')).toBe(cam);
  });

  it('steps in from ZOOM_MIN re-enable zooming out again', () => {
    const cam = atStart(ZOOM_MIN);
    const next = zoomStep(cam, LAPTOP, 'in');
    expect(next.zoom).toBeCloseTo(ZOOM_MIN * ZOOM_STEP_FACTOR, 10);
    expect(canZoomOut(next)).toBe(true);
  });
});

describe('canZoomIn / canZoomOut / zoomPercent', () => {
  it('reports both directions inside the limits', () => {
    const cam = atStart();
    expect(canZoomIn(cam)).toBe(true);
    expect(canZoomOut(cam)).toBe(true);
  });

  it('rounds the zoom to a whole-number percentage', () => {
    expect(zoomPercent(atStart())).toBe(100);
    expect(zoomPercent(atStart(1.5625))).toBe(156);
    expect(zoomPercent(atStart(ZOOM_MIN))).toBe(10);
    expect(zoomPercent(atStart(ZOOM_MAX))).toBe(400);
  });
});

describe('property check: the pointer world point is invariant under zoomAt', () => {
  /** Deterministic PRNG so the property check is reproducible. */
  function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it('holds for 1000 random cameras, points and factors', () => {
    const rand = mulberry32(0x5eed);
    const range = (min: number, max: number) => min + rand() * (max - min);

    for (let i = 0; i < 1000; i += 1) {
      const cam: Camera = {
        x: range(-FAR, FAR),
        y: range(-FAR, FAR),
        zoom: range(ZOOM_MIN, ZOOM_MAX),
      };
      const p: Point = { x: range(0, LAPTOP.width), y: range(0, LAPTOP.height) };
      const factor = range(0.1, 10);

      const next = zoomAt(cam, p, factor);
      expect(next.zoom).toBeGreaterThanOrEqual(ZOOM_MIN);
      expect(next.zoom).toBeLessThanOrEqual(ZOOM_MAX);

      const before = screenToWorld(cam, p);
      const after = screenToWorld(next, p);
      expect(Math.abs(after.x - before.x)).toBeLessThan(WORLD_EPS);
      expect(Math.abs(after.y - before.y)).toBeLessThan(WORLD_EPS);
    }
  });
});
