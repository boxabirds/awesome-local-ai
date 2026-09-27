import { describe, expect, it } from 'vitest';

import {
  UNBOUNDED_PAN_TESTED_EXTENT,
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

/** Design threshold for "exact" camera maths assertions far away from origin. */
const TOLERANCE = 1e-6;

const VIEWPORT: Size = { width: 1200, height: 800 };
const CENTRE: Point = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
const FAR = UNBOUNDED_PAN_TESTED_EXTENT;

const ORIGIN_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };
const FAR_CAMERA: Camera = { x: FAR, y: FAR, zoom: 1 };
const AT_MAX: Camera = { x: FAR, y: FAR, zoom: ZOOM_MAX };
const AT_MIN: Camera = { x: 0, y: 0, zoom: ZOOM_MIN };

const POINTER: Point = { x: 300, y: 200 };

function sameNumber(a: number, b: number, tolerance = TOLERANCE): void {
  expect(Math.abs(a - b)).toBeLessThanOrEqual(tolerance);
}

/** The board point that maps to a screen point must survive a zoom unchanged. */
function expectPointerInvariant(before: Camera, after: Camera, p: Point): void {
  const w0 = screenToWorld(before, p);
  const w1 = screenToWorld(after, p);
  sameNumber(w0.x, w1.x);
  sameNumber(w0.y, w1.y);
}

describe('camera.math — screen/world transforms', () => {
  it('round-trips world -> screen -> world at any zoom', () => {
    for (const cam of [ORIGIN_CAMERA, FAR_CAMERA, AT_MIN, AT_MAX, { x: -1234.5, y: 987.25, zoom: 1.5625 }]) {
      for (const p of [CENTRE, POINTER, { x: -500, y: 0 }]) {
        const world = screenToWorld(cam, p);
        const back = worldToScreen(cam, world);
        sameNumber(back.x, p.x);
        sameNumber(back.y, p.y);
      }
    }
  });
});

describe('camera.math — panBy (TC-01, TC-02)', () => {
  it('TC-01 moves the camera by -delta/zoom at zoom 1 and carries the world origin with the pointer', () => {
    const next = panBy(ORIGIN_CAMERA, 200, 100);
    sameNumber(next.x, -200);
    sameNumber(next.y, -100);
    expect(next.zoom).toBe(ORIGIN_CAMERA.zoom);

    // The world point (0,0) was at screen (0,0) and is now at screen (200,100).
    const before = worldToScreen(ORIGIN_CAMERA, { x: 0, y: 0 });
    const after = worldToScreen(next, { x: 0, y: 0 });
    sameNumber(before.x, 0);
    sameNumber(before.y, 0);
    sameNumber(after.x, 200);
    sameNumber(after.y, 100);
  });

  it('TC-02 pans by delta/zoom world units at ZOOM_MAX far from the start', () => {
    const next = panBy(AT_MAX, 200, 100);
    sameNumber(next.x, AT_MAX.x - 200 / ZOOM_MAX);
    sameNumber(next.y, AT_MAX.y - 100 / ZOOM_MAX);
    expect(Math.abs(next.x - (FAR - 200 / ZOOM_MAX))).toBeLessThanOrEqual(TOLERANCE);
    expect(Number.isFinite(next.x)).toBe(true);
    expect(Number.isFinite(next.y)).toBe(true);
  });

  it('returns the same object for a zero-length drag', () => {
    expect(panBy(ORIGIN_CAMERA, 0, 0)).toBe(ORIGIN_CAMERA);
  });
});

describe('camera.math — zoomAt (TC-03, TC-04, TC-05, TC-06, TC-11, TC-12)', () => {
  it('TC-03 keeps the world point under the pointer fixed', () => {
    const next = zoomAt(ORIGIN_CAMERA, POINTER, 2);
    expect(next.zoom).toBe(2);
    expectPointerInvariant(ORIGIN_CAMERA, next, POINTER);
  });

  it('TC-04 keeps the pointer point fixed 1,000,000 world units from the start', () => {
    const next = zoomAt({ ...FAR_CAMERA, zoom: 1 }, POINTER, 1.5);
    sameNumber(next.zoom, 1.5);
    expectPointerInvariant({ ...FAR_CAMERA, zoom: 1 }, next, POINTER);
  });

  it('TC-05 at ZOOM_MIN zooming out returns the same object', () => {
    const next = zoomAt(AT_MIN, CENTRE, 1 / ZOOM_STEP_FACTOR);
    expect(next).toBe(AT_MIN);
    expect(next.x).toBe(AT_MIN.x);
    expect(next.y).toBe(AT_MIN.y);
  });

  it('TC-06 at ZOOM_MAX zooming in returns the same object', () => {
    const next = zoomAt(AT_MAX, CENTRE, ZOOM_STEP_FACTOR);
    expect(next).toBe(AT_MAX);
    expect(next.x).toBe(AT_MAX.x);
    expect(next.y).toBe(AT_MAX.y);
  });

  it('TC-11 clamps a huge factor and still keeps the pointer point fixed', () => {
    const next = zoomAt(ORIGIN_CAMERA, POINTER, 1000);
    expect(next.zoom).toBe(ZOOM_MAX);
    expectPointerInvariant(ORIGIN_CAMERA, next, POINTER);

    const farOut = zoomAt(FAR_CAMERA, POINTER, Number.MIN_VALUE);
    expect(farOut.zoom).toBe(ZOOM_MIN);
    expectPointerInvariant(FAR_CAMERA, farOut, POINTER);
  });

  it('TC-12 ignores invalid factors without producing NaN', () => {
    for (const factor of [0, -1, -ZOOM_STEP_FACTOR, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const next = zoomAt(ORIGIN_CAMERA, POINTER, factor);
      expect(next).toBe(ORIGIN_CAMERA);
      expect(Number.isNaN(next.x)).toBe(false);
      expect(Number.isNaN(next.y)).toBe(false);
      expect(Number.isNaN(next.zoom)).toBe(false);
    }
  });

  it('never produces non-finite values from extreme-but-valid input', () => {
    const next = zoomAt({ x: FAR, y: -FAR, zoom: ZOOM_MIN }, { x: FAR, y: FAR }, Number.MAX_VALUE);
    expect(Number.isFinite(next.x)).toBe(true);
    expect(Number.isFinite(next.y)).toBe(true);
    expect(next.zoom).toBe(ZOOM_MAX);
  });
});

describe('camera.math — viewport resize (TC-07)', () => {
  it('TC-07 a viewport size change leaves the camera untouched', () => {
    // The camera is stored relative to the viewport top-left, so a resize only
    // changes the viewport size; no camera function mutates the camera.
    const cam: Camera = { x: -1234, y: 5678, zoom: 1.5 };
    const snapshot: Camera = { ...cam };
    screenToWorld(cam, CENTRE);
    worldToScreen(cam, { x: 0, y: 0 });
    panBy(cam, 0, 0);
    expect(cam).toEqual(snapshot);
    expect(panBy(cam, 0, 0)).toBe(cam);
  });
});

describe('camera.math — resetCamera (TC-08)', () => {
  it('TC-08 resets to zoom 1 with the board start point centred', () => {
    const next = resetCamera(VIEWPORT);
    expect(next.zoom).toBe(1);
    sameNumber(next.x, -VIEWPORT.width / 2);
    sameNumber(next.y, -VIEWPORT.height / 2);
    const origin = worldToScreen(next, { x: 0, y: 0 });
    sameNumber(origin.x, VIEWPORT.width / 2);
    sameNumber(origin.y, VIEWPORT.height / 2);
  });

  it('TC-08 resets from ZOOM_MAX far away', () => {
    const next = resetCamera({ width: 1200, height: 800 });
    expect(zoomPercent(next)).toBe(ZOOM_PERCENT_SCALE);
    expect(canZoomIn(next)).toBe(true);
    expect(canZoomOut(next)).toBe(true);
  });
});

describe('camera.math — zoomStep (TC-09, TC-10)', () => {
  it('TC-09 one step in then one step out returns exactly the zoom it started from', () => {
    const inZoom = zoomStep(ORIGIN_CAMERA, VIEWPORT, 'in');
    expect(inZoom.zoom).toBe(ZOOM_STEP_FACTOR);
    expect(zoomPercent(inZoom)).toBe(Math.round(ZOOM_STEP_FACTOR * ZOOM_PERCENT_SCALE));

    const back = zoomStep(inZoom, VIEWPORT, 'out');
    expect(back.zoom).toBe(1);
    expect(zoomPercent(back)).toBe(ZOOM_PERCENT_SCALE);
  });

  it('TC-09 a step keeps the board centre fixed on screen', () => {
    const cam: Camera = { x: -600, y: -400, zoom: 1 };
    const next = zoomStep(cam, VIEWPORT, 'in');
    expectPointerInvariant(cam, next, CENTRE);
  });

  it('TC-10 twenty steps in stop exactly at ZOOM_MAX with canZoomIn false', () => {
    let cam: Camera = ORIGIN_CAMERA;
    for (let i = 0; i < 20; i += 1) cam = zoomStep(cam, VIEWPORT, 'in');
    expect(cam.zoom).toBe(ZOOM_MAX);
    expect(canZoomIn(cam)).toBe(false);
    expect(canZoomOut(cam)).toBe(true);
    expect(zoomStep(cam, VIEWPORT, 'in')).toBe(cam);
  });

  it('TC-10 twenty steps out stop exactly at ZOOM_MIN with canZoomOut false', () => {
    let cam: Camera = ORIGIN_CAMERA;
    for (let i = 0; i < 20; i += 1) cam = zoomStep(cam, VIEWPORT, 'out');
    expect(cam.zoom).toBe(ZOOM_MIN);
    expect(canZoomOut(cam)).toBe(false);
    expect(canZoomIn(cam)).toBe(true);
    expect(zoomStep(cam, VIEWPORT, 'out')).toBe(cam);
  });

  it('a stepped zoom stays on the ZOOM_STEP_FACTOR ladder', () => {
    let cam: Camera = ORIGIN_CAMERA;
    for (let i = 0; i < 8; i += 1) {
      cam = zoomStep(cam, VIEWPORT, 'in');
      if (cam.zoom < ZOOM_MAX) {
        const exponent = Math.round(Math.log(cam.zoom) / Math.log(ZOOM_STEP_FACTOR));
        sameNumber(cam.zoom, ZOOM_STEP_FACTOR ** exponent);
      }
    }
  });
});

describe('camera.math — zoomPercent, canZoomIn/Out', () => {
  it('rounds to a whole-number percentage', () => {
    expect(zoomPercent(ORIGIN_CAMERA)).toBe(ZOOM_PERCENT_SCALE);
    expect(zoomPercent({ x: 0, y: 0, zoom: 1.5625 })).toBe(156);
    expect(zoomPercent({ x: 0, y: 0, zoom: 1.56 })).toBe(156);
    expect(zoomPercent(AT_MIN)).toBe(Math.round(ZOOM_MIN * ZOOM_PERCENT_SCALE));
    expect(zoomPercent(AT_MAX)).toBe(Math.round(ZOOM_MAX * ZOOM_PERCENT_SCALE));
  });

  it('reports zoomability against the limits', () => {
    expect(canZoomIn(ORIGIN_CAMERA)).toBe(true);
    expect(canZoomOut(ORIGIN_CAMERA)).toBe(true);
    expect(canZoomIn(AT_MIN)).toBe(true);
    expect(canZoomOut(AT_MIN)).toBe(false);
    expect(canZoomIn(AT_MAX)).toBe(false);
    expect(canZoomOut(AT_MAX)).toBe(true);
  });
});

describe('camera.math — property checks', () => {
  it('keeps the pointer world point invariant for 1,000 random cameras/points/factors', () => {
    const rand = mulberry32(0x5eed);
    for (let i = 0; i < 1000; i += 1) {
      const cam: Camera = {
        x: (rand() - 0.5) * 2 * UNBOUNDED_PAN_TESTED_EXTENT,
        y: (rand() - 0.5) * 2 * UNBOUNDED_PAN_TESTED_EXTENT,
        zoom: ZOOM_MIN * (ZOOM_MAX / ZOOM_MIN) ** rand(),
      };
      const p: Point = { x: (rand() - 0.5) * 1920, y: (rand() - 0.5) * 1080 };
      const factor = Math.exp((rand() - 0.5) * 4);
      const next = zoomAt(cam, p, factor);
      expectPointerInvariant(cam, next, p);
      expect(next.zoom).toBeGreaterThanOrEqual(ZOOM_MIN);
      expect(next.zoom).toBeLessThanOrEqual(ZOOM_MAX);
    }
  });
});

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
