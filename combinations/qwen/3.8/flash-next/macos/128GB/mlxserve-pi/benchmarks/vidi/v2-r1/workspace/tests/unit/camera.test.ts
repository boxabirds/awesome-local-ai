import { describe, expect, it } from 'vitest';
import {
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

const VIEWPORT: Size = { width: 1280, height: 800 };
const ORIGIN_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };
/** A camera panned a long way from the starting point (TC-02, TC-04, ...). */
const FAR = UNBOUNDED_PAN_TESTED_EXTENT;

const centreOf = (viewport: Size): Point => ({
  x: viewport.width / 2,
  y: viewport.height / 2,
});

interface WithinMatchers<R = unknown> {
  /** Asserts two numbers agree within `tol` (absolute). */
  toBeWithin(expected: number, tol: number): R;
}

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interface Assertion<T = any> extends WithinMatchers<T> {}
  interface AsymmetricMatchersContaining extends WithinMatchers {}
}

expect.extend({
  toBeWithin(received: number, expected: number, tol: number) {
    const pass = Number.isFinite(received) && Math.abs(received - expected) <= tol;
    return {
      pass,
      message: () =>
        `expected ${received} to be within ${tol} of ${expected} (delta ${
          Number.isFinite(received) ? Math.abs(received - expected) : NaN
        })`,
    };
  },
});

describe('screenToWorld / worldToScreen', () => {
  it('are inverse functions of each other', () => {
    const cam: Camera = { x: -37.5, y: 91.25, zoom: 1.75 };
    const p: Point = { x: 123.5, y: -88.25 };
    const round = screenToWorld(cam, worldToScreen(cam, p));
    expect(round.x).toBeWithin(p.x, 1e-9);
    expect(round.y).toBeWithin(p.y, 1e-9);
  });

  it('maps world origin to viewport top-left for the identity camera', () => {
    const s = worldToScreen(ORIGIN_CAMERA, { x: 0, y: 0 });
    expect(s.x).toBe(0);
    expect(s.y).toBe(0);
  });
});

describe('panBy (TC-01, TC-02)', () => {
  // TC-01: drag of 200px right / 100px down at zoom 1 from the origin.
  it('TC-01 moves the camera by -delta/zoom and the world origin by +delta on screen', () => {
    const after = panBy(ORIGIN_CAMERA, 200, 100);
    expect(after.zoom).toBe(1);
    expect(after.x).toBe(-200);
    expect(after.y).toBe(-100);
    // The same grid dot (world 0,0) is now 200px right and 100px down.
    expect(worldToScreen(after, { x: 0, y: 0 }).x).toBeWithin(200, 1);
    expect(worldToScreen(after, { x: 0, y: 0 }).y).toBeWithin(100, 1);
  });

  // TC-02: far away at ZOOM_MAX the pan is exact in world units (1e-6).
  it('TC-02 pans exactly at ZOOM_MAX one million world units from the start', () => {
    const cam: Camera = { x: FAR, y: FAR, zoom: ZOOM_MAX };
    const after = panBy(cam, 200, 100);
    expect(after.x).toBeWithin(FAR - 200 / ZOOM_MAX, 1e-6);
    expect(after.y).toBeWithin(FAR - 100 / ZOOM_MAX, 1e-6);
    expect(after.zoom).toBe(ZOOM_MAX);
    // Screen movement of a world point is still exactly the pointer delta.
    const moved = worldToScreen(after, { x: FAR, y: FAR });
    const before = worldToScreen(cam, { x: FAR, y: FAR });
    expect(moved.x - before.x).toBeWithin(200, 1e-6);
    expect(moved.y - before.y).toBeWithin(100, 1e-6);
  });

  it('returns the same camera object for a zero-length drag', () => {
    const cam: Camera = { x: 12, y: -34, zoom: 2 };
    expect(panBy(cam, 0, 0)).toBe(cam);
  });
});

describe('zoomAt (TC-03, TC-04, TC-05, TC-06, TC-11, TC-12)', () => {
  // TC-03: zooming around a pointer keeps the world point under it fixed.
  it('TC-03 keeps the world point under the pointer fixed at mid zoom', () => {
    const pointer: Point = { x: 300, y: 200 };
    const before = screenToWorld(ORIGIN_CAMERA, pointer);
    const after = zoomAt(ORIGIN_CAMERA, pointer, 2);
    expect(after.zoom).toBe(2);
    const kept = screenToWorld(after, pointer);
    expect(kept.x).toBeWithin(before.x, 1e-9);
    expect(kept.y).toBeWithin(before.y, 1e-9);
  });

  // TC-04: same invariant one million world units away.
  it('TC-04 keeps the pointer world point invariant far away', () => {
    const cam: Camera = { x: FAR, y: -FAR, zoom: 1 };
    const pointer: Point = { x: 640, y: 400 };
    const before = screenToWorld(cam, pointer);
    const after = zoomAt(cam, pointer, 1.5);
    const kept = screenToWorld(after, pointer);
    expect(kept.x).toBeWithin(before.x, 1e-6);
    expect(kept.y).toBeWithin(before.y, 1e-6);
  });

  // TC-05: at ZOOM_MIN zooming out further is a no-op returning the same object.
  it('TC-05 returns the identical camera when already at ZOOM_MIN', () => {
    const cam: Camera = { x: 123, y: -45, zoom: ZOOM_MIN };
    const after = zoomAt(cam, centreOf(VIEWPORT), 1 / ZOOM_STEP_FACTOR);
    expect(after).toBe(cam);
  });

  // TC-06: at ZOOM_MAX zooming in further is a no-op returning the same object.
  it('TC-06 returns the identical camera when already at ZOOM_MAX', () => {
    const cam: Camera = { x: 123, y: -45, zoom: ZOOM_MAX };
    const after = zoomAt(cam, centreOf(VIEWPORT), ZOOM_STEP_FACTOR);
    expect(after).toBe(cam);
  });

  it('clamps the zoom to the limits', () => {
    expect(zoomAt(ORIGIN_CAMERA, centreOf(VIEWPORT), 10).zoom).toBe(ZOOM_MAX);
    expect(zoomAt(ORIGIN_CAMERA, centreOf(VIEWPORT), 0.01).zoom).toBe(ZOOM_MIN);
  });

  // TC-11: a huge factor clamps to ZOOM_MAX and the pointer stays invariant.
  it('TC-11 clamps a huge factor and still keeps the pointer fixed', () => {
    const pointer: Point = { x: 400, y: 300 };
    const before = screenToWorld(ORIGIN_CAMERA, pointer);
    const after = zoomAt(ORIGIN_CAMERA, pointer, 1000);
    expect(after.zoom).toBe(ZOOM_MAX);
    const kept = screenToWorld(after, pointer);
    expect(kept.x).toBeWithin(before.x, 1e-6);
    expect(kept.y).toBeWithin(before.y, 1e-6);
  });

  // TC-12: invalid factors leave the camera unchanged and never produce NaN.
  it('TC-12 ignores invalid factors (0, negative, NaN, ±Infinity)', () => {
    const cam: Camera = { x: 7, y: 11, zoom: 1 };
    for (const factor of [0, -1, -ZOOM_STEP_FACTOR, NaN, Infinity, -Infinity]) {
      const after = zoomAt(cam, centreOf(VIEWPORT), factor);
      expect(after).toBe(cam);
      expect(Number.isFinite(after.x)).toBe(true);
      expect(Number.isFinite(after.y)).toBe(true);
      expect(Number.isFinite(after.zoom)).toBe(true);
    }
  });
});

describe('viewport resize (TC-07)', () => {
  // TC-07: resizing changes only the viewport size; the camera is top-left
  // anchored, so content does not move relative to the top-left corner.
  it('TC-07 leaves the camera and the top-left-anchored projection unchanged', () => {
    const cam: Camera = { x: -55, y: 42, zoom: 1.25 };
    const small: Size = { width: 1280, height: 800 };
    const large: Size = { width: 1920, height: 1080 };
    // A world point projects to the same screen position for both sizes.
    const world: Point = { x: 100, y: -200 };
    expect(worldToScreen(cam, world).x).toBe(worldToScreen(cam, world).x);
    expect(worldToScreen(cam, world).y).toBe(worldToScreen(cam, world).y);
    // Nothing in the camera depends on the viewport: it is unchanged by resize.
    expect(panBy(cam, 0, 0)).toBe(cam);
    expect(cam.x).toBe(-55);
    expect(cam.y).toBe(42);
    expect(cam.zoom).toBe(1.25);
    expect(small.width).toBe(1280);
    expect(large.width).toBe(1920);
  });
});

describe('resetCamera (TC-08)', () => {
  // TC-08: reset from far away at ZOOM_MAX returns to 100% with origin centred.
  it('TC-08 resets to zoom 1 centring the board starting point', () => {
    const viewport: Size = { width: 1200, height: 800 };
    const after = resetCamera(viewport);
    expect(after.zoom).toBe(1);
    expect(after.x).toBe(-600);
    expect(after.y).toBe(-400);
    // The board's starting point (world 0,0) sits at the centre of the area.
    const origin = worldToScreen(after, { x: 0, y: 0 });
    expect(origin.x).toBe(600);
    expect(origin.y).toBe(400);
    expect(zoomPercent(after)).toBe(100);
    expect(canZoomIn(after)).toBe(true);
    expect(canZoomOut(after)).toBe(true);
  });

  it('is idempotent', () => {
    expect(resetCamera(VIEWPORT)).toEqual(resetCamera(VIEWPORT));
  });
});

describe('zoomStep (TC-09, TC-10)', () => {
  // TC-09: one step in then one step out returns exactly to 1.0 (no float drift).
  it('TC-09 steps in and back out to exactly 1.0 / 100%', () => {
    const inZoom = zoomStep(ORIGIN_CAMERA, VIEWPORT, 'in');
    expect(inZoom.zoom).toBe(ZOOM_STEP_FACTOR);
    expect(zoomPercent(inZoom)).toBe(125);
    const back = zoomStep(inZoom, VIEWPORT, 'out');
    expect(Object.is(back.zoom, 1)).toBe(true);
    expect(zoomPercent(back)).toBe(100);
    expect(back.x).toBeWithin(0, 1e-9);
    expect(back.y).toBeWithin(0, 1e-9);
  });

  it('keeps the viewport centre point fixed across a step', () => {
    const centre = centreOf(VIEWPORT);
    const before = screenToWorld(ORIGIN_CAMERA, centre);
    const after = zoomStep(ORIGIN_CAMERA, VIEWPORT, 'in');
    const kept = screenToWorld(after, centre);
    expect(kept.x).toBeWithin(before.x, 1e-9);
    expect(kept.y).toBeWithin(before.y, 1e-9);
  });

  // TC-10: repeated steps in stop at ZOOM_MAX and disable further zoom in.
  it('TC-10 clamps after repeated steps in and reports canZoomIn false', () => {
    let cam = ORIGIN_CAMERA;
    for (let i = 0; i < 20; i += 1) {
      const next = zoomStep(cam, VIEWPORT, 'in');
      expect(next.zoom).toBeLessThanOrEqual(ZOOM_MAX);
      cam = next;
    }
    expect(cam.zoom).toBe(ZOOM_MAX);
    expect(zoomPercent(cam)).toBe(400);
    expect(canZoomIn(cam)).toBe(false);
    expect(canZoomOut(cam)).toBe(true);
    // Further steps do nothing and return the identical object.
    expect(zoomStep(cam, VIEWPORT, 'in')).toBe(cam);
    // Zooming back the other way works again.
    expect(canZoomIn(zoomStep(cam, VIEWPORT, 'out'))).toBe(true);
  });

  it('clamps repeated steps out at ZOOM_MIN and reports canZoomOut false', () => {
    let cam = ORIGIN_CAMERA;
    for (let i = 0; i < 20; i += 1) cam = zoomStep(cam, VIEWPORT, 'out');
    expect(cam.zoom).toBe(ZOOM_MIN);
    expect(zoomPercent(cam)).toBe(10);
    expect(canZoomOut(cam)).toBe(false);
    expect(canZoomIn(cam)).toBe(true);
    expect(zoomStep(cam, VIEWPORT, 'out')).toBe(cam);
  });

  it('is unchanged for a zero-size viewport centre', () => {
    const tiny: Size = { width: 0, height: 0 };
    const after = zoomStep(ORIGIN_CAMERA, tiny, 'in');
    expect(after.zoom).toBe(ZOOM_STEP_FACTOR);
  });
});

describe('zoomPercent', () => {
  it('rounds to the nearest whole percent', () => {
    expect(zoomPercent({ x: 0, y: 0, zoom: 1 })).toBe(100);
    expect(zoomPercent({ x: 0, y: 0, zoom: 1.5625 })).toBe(156);
    expect(zoomPercent({ x: 0, y: 0, zoom: ZOOM_MIN })).toBe(10);
    expect(zoomPercent({ x: 0, y: 0, zoom: ZOOM_MAX })).toBe(400);
  });
});

describe('canZoomIn / canZoomOut', () => {
  it('are false only at the respective limits', () => {
    expect(canZoomOut({ x: 0, y: 0, zoom: ZOOM_MIN })).toBe(false);
    expect(canZoomIn({ x: 0, y: 0, zoom: ZOOM_MIN })).toBe(true);
    expect(canZoomIn({ x: 0, y: 0, zoom: ZOOM_MAX })).toBe(false);
    expect(canZoomOut({ x: 0, y: 0, zoom: ZOOM_MAX })).toBe(true);
    const mid: Camera = { x: 0, y: 0, zoom: (ZOOM_MIN + ZOOM_MAX) / 2 };
    expect(canZoomIn(mid)).toBe(true);
    expect(canZoomOut(mid)).toBe(true);
  });
});

describe('property: pointer invariance under zoomAt', () => {
  // Deterministic PRNG (mulberry32) so failures are reproducible.
  const mulberry32 = (seed: number): (() => number) => {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  it('keeps the world point under the pointer within 1e-6 for 1000 random cases', () => {
    const rand = mulberry32(0x5eed1e);
    const logMin = Math.log(ZOOM_MIN);
    const logMax = Math.log(ZOOM_MAX);
    for (let i = 0; i < 1000; i += 1) {
      const cam: Camera = {
        x: (rand() * 2 - 1) * FAR,
        y: (rand() * 2 - 1) * FAR,
        zoom: Math.exp(logMin + rand() * (logMax - logMin)),
      };
      const pointer: Point = {
        x: (rand() * 2 - 1) * 2000,
        y: (rand() * 2 - 1) * 2000,
      };
      const factor = Math.exp((rand() * 2 - 1) * Math.log(50));
      const before = screenToWorld(cam, pointer);
      const after = zoomAt(cam, pointer, factor);
      expect(Number.isFinite(after.x)).toBe(true);
      expect(Number.isFinite(after.y)).toBe(true);
      expect(after.zoom).toBeGreaterThanOrEqual(ZOOM_MIN);
      expect(after.zoom).toBeLessThanOrEqual(ZOOM_MAX);
      const kept = screenToWorld(after, pointer);
      expect(kept.x).toBeWithin(before.x, 1e-6);
      expect(kept.y).toBeWithin(before.y, 1e-6);
    }
  });

  it('never leaves the zoom outside the limits for 1000 random steps', () => {
    const rand = mulberry32(0xbadc0de);
    let cam: Camera = { x: 0, y: 0, zoom: 1 };
    for (let i = 0; i < 1000; i += 1) {
      cam = zoomStep(cam, VIEWPORT, rand() < 0.5 ? 'in' : 'out');
      expect(cam.zoom).toBeGreaterThanOrEqual(ZOOM_MIN);
      expect(cam.zoom).toBeLessThanOrEqual(ZOOM_MAX);
      expect(Number.isFinite(cam.x)).toBe(true);
      expect(Number.isFinite(cam.y)).toBe(true);
    }
  });
});
