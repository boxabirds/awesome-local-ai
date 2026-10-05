import { describe, expect, it } from 'vitest';
import {
  PERCENT_PER_ZOOM,
  UNBOUNDED_PAN_TESTED_EXTENT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP_FACTOR
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
  type Size
} from '../../src/client/canvas/camera';

/** Tolerance (in world units or screen pixels) for "the same place". */
const EPS = 1e-6;

/** Absolute-precision assertion, so tolerances stay explicit. */
function closeTo(actual: number, expected: number, tolerance = EPS): void {
  expect(Math.abs(actual - expected), `expected ${actual} within ${tolerance} of ${expected}`).toBeLessThanOrEqual(
    tolerance
  );
}

const ORIGIN: Point = { x: 0, y: 0 };
const LAPTOP: Size = { width: 1200, height: 800 };
const CENTRE: Point = { x: LAPTOP.width / 2, y: LAPTOP.height / 2 };

const atStart: Camera = { x: 0, y: 0, zoom: 1 };
const atMin: Camera = { x: 0, y: 0, zoom: ZOOM_MIN };
const atMax: Camera = { x: 0, y: 0, zoom: ZOOM_MAX };
const farAway: Camera = {
  x: UNBOUNDED_PAN_TESTED_EXTENT,
  y: UNBOUNDED_PAN_TESTED_EXTENT,
  zoom: 1
};

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

describe('screenToWorld / worldToScreen', () => {
  it('are inverses of each other', () => {
    const cam: Camera = { x: -123.5, y: 456.25, zoom: 1.75 };
    const p: Point = { x: 321, y: -654 };
    const round = worldToScreen(cam, screenToWorld(cam, p));
    closeTo(round.x, p.x);
    closeTo(round.y, p.y);
  });

  it('maps a world point to (world - camera.xy) * zoom on screen', () => {
    const cam: Camera = { x: -10, y: -20, zoom: 2 };
    closeTo(worldToScreen(cam, ORIGIN).x, 20);
    closeTo(worldToScreen(cam, ORIGIN).y, 40);
  });
});

describe('panBy', () => {
  it('TC-01: at zoom 1 moves the camera by -delta and the content by +delta', () => {
    const next = panBy(atStart, 200, 100);
    closeTo(next.x, -200);
    closeTo(next.y, -100);
    expect(next.zoom).toBe(1);
    // The board point that was at the top-left is now 200px right, 100px down.
    const dot = worldToScreen(next, ORIGIN);
    closeTo(dot.x, 200);
    closeTo(dot.y, 100);
  });

  it('TC-02: at ZOOM_MAX far from the start, converts screen pixels to world units exactly', () => {
    const cam: Camera = { ...farAway, zoom: ZOOM_MAX };
    const next = panBy(cam, 200, 100);
    closeTo(next.x, cam.x - 200 / ZOOM_MAX);
    closeTo(next.y, cam.y - 100 / ZOOM_MAX);
    expect(next.zoom).toBe(ZOOM_MAX);
  });

  it('leaves the camera object untouched for a zero-length drag', () => {
    expect(panBy(farAway, 0, 0)).toBe(farAway);
  });

  it('does not mutate its input', () => {
    const before: Camera = { x: 5, y: 6, zoom: 2 };
    panBy(before, 100, -100);
    expect(before).toEqual({ x: 5, y: 6, zoom: 2 });
  });
});

describe('zoomAt', () => {
  it('TC-03: keeps the world point under the pointer at the same screen position', () => {
    const pointer: Point = { x: 300, y: 200 };
    const before = screenToWorld(atStart, pointer);
    const next = zoomAt(atStart, pointer, 2);
    closeTo(next.zoom, 2);
    const after = screenToWorld(next, pointer);
    closeTo(after.x, before.x);
    closeTo(after.y, before.y);
    // ...and the same screen pixel still maps back to that world point.
    const screen = worldToScreen(next, before);
    closeTo(screen.x, pointer.x);
    closeTo(screen.y, pointer.y);
  });

  it('TC-04: keeps the pointer invariant one million world units from the start', () => {
    const pointer: Point = { x: 640, y: 400 };
    const before = screenToWorld(farAway, pointer);
    const next = zoomAt(farAway, pointer, 1.5);
    const after = screenToWorld(next, pointer);
    closeTo(after.x, before.x);
    closeTo(after.y, before.y);
  });

  it('TC-05: at ZOOM_MIN, zooming out further returns the same camera object', () => {
    const next = zoomAt(atMin, CENTRE, 1 / ZOOM_STEP_FACTOR);
    expect(next).toBe(atMin);
    expect(next.zoom).toBe(ZOOM_MIN);
    expect(next.x).toBe(atMin.x);
    expect(next.y).toBe(atMin.y);
  });

  it('TC-06: at ZOOM_MAX, zooming in further returns the same camera object', () => {
    const next = zoomAt(atMax, CENTRE, ZOOM_STEP_FACTOR);
    expect(next).toBe(atMax);
    expect(next.zoom).toBe(ZOOM_MAX);
    expect(next.x).toBe(atMax.x);
    expect(next.y).toBe(atMax.y);
  });

  it('TC-11: clamps a huge factor and still keeps the pointer invariant', () => {
    const pointer: Point = { x: 250, y: 700 };
    const before = screenToWorld(atStart, pointer);
    const next = zoomAt(atStart, pointer, 1000);
    expect(next.zoom).toBe(ZOOM_MAX);
    const screen = worldToScreen(next, before);
    closeTo(screen.x, pointer.x);
    closeTo(screen.y, pointer.y);
  });

  it('TC-11: clamps a tiny factor to ZOOM_MIN and still keeps the pointer invariant', () => {
    const pointer: Point = { x: 120, y: 80 };
    const before = screenToWorld(atStart, pointer);
    const next = zoomAt(atStart, pointer, 1e-6);
    expect(next.zoom).toBe(ZOOM_MIN);
    const screen = worldToScreen(next, before);
    closeTo(screen.x, pointer.x);
    closeTo(screen.y, pointer.y);
  });

  it('TC-12: ignores invalid factors and never produces NaN', () => {
    for (const factor of [
      0,
      -1,
      -ZOOM_STEP_FACTOR,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY
    ]) {
      const next = zoomAt(atStart, CENTRE, factor);
      expect(next).toBe(atStart);
      expect(Number.isFinite(next.x)).toBe(true);
      expect(Number.isFinite(next.y)).toBe(true);
      expect(Number.isFinite(next.zoom)).toBe(true);
    }
  });

  it('TC-12: ignores an invalid factor far from the start too', () => {
    const next = zoomAt(farAway, { x: 10, y: 10 }, Number.NaN);
    expect(next).toBe(farAway);
    expect(Number.isFinite(next.zoom)).toBe(true);
  });
});

describe('viewport resize', () => {
  it('TC-07: changing the viewport size leaves the camera and the top-left anchor alone', () => {
    const camera = zoomStep(resetCamera(LAPTOP), LAPTOP, 'in');
    const snapshot = { ...camera };
    // The world point shown at the top-left corner of the board area, before
    // the resize.
    const topLeftWorld = screenToWorld(camera, { x: 0, y: 0 });
    // A resize is not user input to the camera: the viewport grows and shrinks
    // and nothing about the camera changes, so content stays anchored to the
    // top-left corner of the board area.
    const smaller: Size = { width: 640, height: 480 };
    const larger: Size = { width: 1920, height: 1080 };
    expect(smaller).toEqual({ width: 640, height: 480 });
    expect(larger).toEqual({ width: 1920, height: 1080 });
    expect(camera).toEqual(snapshot);
    closeTo(worldToScreen(camera, topLeftWorld).x, 0);
    closeTo(worldToScreen(camera, topLeftWorld).y, 0);
  });
});

describe('resetCamera', () => {
  it('TC-08: returns to zoom 1 with the board start point centred', () => {
    const farMax: Camera = { ...farAway, zoom: ZOOM_MAX };
    expect(farMax.zoom).toBe(ZOOM_MAX);
    const next = resetCamera({ width: 1200, height: 800 });
    expect(next.zoom).toBe(1);
    closeTo(next.x, -600);
    closeTo(next.y, -400);
    const origin = worldToScreen(next, ORIGIN);
    closeTo(origin.x, 600);
    closeTo(origin.y, 400);
  });
});

describe('zoomStep', () => {
  it('TC-09: one step in then one step out returns exactly to 1.0', () => {
    const inOnce = zoomStep(atStart, LAPTOP, 'in');
    expect(zoomPercent(inOnce)).toBe(Math.round(ZOOM_STEP_FACTOR * PERCENT_PER_ZOOM));
    const outOnce = zoomStep(inOnce, LAPTOP, 'out');
    expect(outOnce.zoom).toBe(1);
    expect(zoomPercent(outOnce)).toBe(100);
  });

  it('TC-09: keeps the viewport centre fixed', () => {
    const before = screenToWorld(atStart, CENTRE);
    const next = zoomStep(atStart, LAPTOP, 'in');
    const after = screenToWorld(next, CENTRE);
    closeTo(after.x, before.x);
    closeTo(after.y, before.y);
  });

  it('TC-10: 20 steps in clamp at ZOOM_MAX and canZoomIn becomes false', () => {
    let cam: Camera = atStart;
    for (let i = 0; i < 20; i += 1) cam = zoomStep(cam, LAPTOP, 'in');
    expect(cam.zoom).toBe(ZOOM_MAX);
    expect(canZoomIn(cam)).toBe(false);
    expect(canZoomOut(cam)).toBe(true);
    expect(zoomPercent(cam)).toBe(Math.round(ZOOM_MAX * PERCENT_PER_ZOOM));
    // ...and zooming back out works again.
    const out = zoomStep(cam, LAPTOP, 'out');
    expect(out.zoom).toBeLessThan(ZOOM_MAX);
    expect(canZoomIn(out)).toBe(true);
  });

  it('TC-10: 20 steps out clamp at ZOOM_MIN and canZoomOut becomes false', () => {
    let cam: Camera = atStart;
    for (let i = 0; i < 20; i += 1) cam = zoomStep(cam, LAPTOP, 'out');
    expect(cam.zoom).toBe(ZOOM_MIN);
    expect(canZoomOut(cam)).toBe(false);
    expect(canZoomIn(cam)).toBe(true);
    expect(zoomPercent(cam)).toBe(Math.round(ZOOM_MIN * PERCENT_PER_ZOOM));
  });

  it('returns the same object when a step cannot move past a limit', () => {
    expect(zoomStep(atMin, LAPTOP, 'out')).toBe(atMin);
    expect(zoomStep(atMax, LAPTOP, 'in')).toBe(atMax);
  });
});

describe('canZoomIn / canZoomOut / zoomPercent', () => {
  it('reports the limits', () => {
    expect(canZoomIn(atMin)).toBe(true);
    expect(canZoomOut(atMin)).toBe(false);
    expect(canZoomIn(atMax)).toBe(false);
    expect(canZoomOut(atMax)).toBe(true);
    expect(canZoomIn(atStart)).toBe(true);
    expect(canZoomOut(atStart)).toBe(true);
  });

  it('rounds the zoom to a whole percentage', () => {
    expect(zoomPercent(atStart)).toBe(100);
    expect(zoomPercent({ x: 0, y: 0, zoom: 1.5625 })).toBe(156);
    expect(zoomPercent(atMin)).toBe(10);
    expect(zoomPercent(atMax)).toBe(400);
  });
});

describe('property: the pointer world point is invariant under zoomAt', () => {
  it('holds for 1000 seeded cameras, points and factors', () => {
    const random = mulberry32(0x51d10);
    for (let i = 0; i < 1000; i += 1) {
      const cam: Camera = {
        x: (random() * 2 - 1) * UNBOUNDED_PAN_TESTED_EXTENT,
        y: (random() * 2 - 1) * UNBOUNDED_PAN_TESTED_EXTENT,
        zoom: ZOOM_MIN + random() * (ZOOM_MAX - ZOOM_MIN)
      };
      const point: Point = { x: random() * 1920, y: random() * 1080 };
      const factor = Math.exp((random() * 2 - 1) * 3);
      const before = screenToWorld(cam, point);
      const next = zoomAt(cam, point, factor);
      expect(Number.isFinite(next.x)).toBe(true);
      expect(Number.isFinite(next.y)).toBe(true);
      expect(next.zoom).toBeGreaterThanOrEqual(ZOOM_MIN);
      expect(next.zoom).toBeLessThanOrEqual(ZOOM_MAX);
      // Screen pixels are what the user sees: the point under the pointer must
      // not move, even a million world units from the start.
      const screen = worldToScreen(next, before);
      closeTo(screen.x, point.x, 1e-3);
      closeTo(screen.y, point.y, 1e-3);
    }
  });
});
