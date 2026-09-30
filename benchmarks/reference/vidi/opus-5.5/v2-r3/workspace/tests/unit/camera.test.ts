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
} from '../../src/client/canvas/camera';
import {
  PERCENT,
  UNBOUNDED_PAN_TESTED_EXTENT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP_FACTOR,
} from '../../src/shared/config';

const PRECISION = 1e-6;
const FAR = UNBOUNDED_PAN_TESTED_EXTENT;

function expectClose(actual: number, expected: number, tol = PRECISION) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);
}

describe('camera.math', () => {
  it('TC-01 panBy at zoom 1 from origin shifts camera and screen position exactly', () => {
    const cam: Camera = { x: 0, y: 0, zoom: 1 };
    const next = panBy(cam, 200, 100);
    expect(next.x).toBe(-200);
    expect(next.y).toBe(-100);
    expect(next.zoom).toBe(1);
    expect(worldToScreen(cam, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    expect(worldToScreen(next, { x: 0, y: 0 })).toEqual({ x: 200, y: 100 });
  });

  it('TC-02 panBy at ZOOM_MAX far away shifts by delta/zoom world units', () => {
    const cam: Camera = { x: FAR, y: -FAR, zoom: ZOOM_MAX };
    const next = panBy(cam, 200, 100);
    expectClose(next.x, FAR - 200 / ZOOM_MAX);
    expectClose(next.y, -FAR - 100 / ZOOM_MAX);
    const w = { x: FAR + 10, y: -FAR + 10 };
    const before = worldToScreen(cam, w);
    const after = worldToScreen(next, w);
    expectClose(after.x - before.x, 200);
    expectClose(after.y - before.y, 100);
  });

  it('panBy with zero delta returns the same object', () => {
    const cam: Camera = { x: 3, y: 4, zoom: 1 };
    expect(panBy(cam, 0, 0)).toBe(cam);
  });

  it('screenToWorld and worldToScreen are inverses', () => {
    const cam: Camera = { x: 12.5, y: -40, zoom: 1.7 };
    const p = { x: 321, y: 123 };
    const back = worldToScreen(cam, screenToWorld(cam, p));
    expectClose(back.x, p.x);
    expectClose(back.y, p.y);
  });

  it('TC-03 zoomAt keeps the world point under the pointer (origin)', () => {
    const cam: Camera = { x: 0, y: 0, zoom: 1 };
    const p = { x: 300, y: 200 };
    const before = screenToWorld(cam, p);
    const next = zoomAt(cam, p, 2);
    expect(next.zoom).toBe(2);
    const after = screenToWorld(next, p);
    expectClose(after.x, before.x);
    expectClose(after.y, before.y);
  });

  it('TC-04 zoomAt keeps the world point under the pointer (far away)', () => {
    const cam: Camera = { x: FAR, y: FAR, zoom: 1 };
    const p = { x: 640, y: 400 };
    const before = screenToWorld(cam, p);
    const next = zoomAt(cam, p, 1.5);
    expect(next.zoom).toBe(1.5);
    const after = screenToWorld(next, p);
    expectClose(after.x, before.x);
    expectClose(after.y, before.y);
  });

  it('TC-05 at ZOOM_MIN, zooming out returns the same camera', () => {
    const cam: Camera = { x: 0, y: 0, zoom: ZOOM_MIN };
    const next = zoomAt(cam, { x: 600, y: 400 }, 1 / ZOOM_STEP_FACTOR);
    expect(next).toBe(cam);
    expect(next.zoom).toBe(ZOOM_MIN);
    expect(zoomStep(cam, { width: 1200, height: 800 }, 'out')).toBe(cam);
    expect(canZoomOut(cam)).toBe(false);
  });

  it('TC-06 at ZOOM_MAX, zooming in returns the same camera', () => {
    const cam: Camera = { x: 0, y: 0, zoom: ZOOM_MAX };
    const next = zoomAt(cam, { x: 600, y: 400 }, ZOOM_STEP_FACTOR);
    expect(next).toBe(cam);
    expect(next.zoom).toBe(ZOOM_MAX);
    expect(zoomStep(cam, { width: 1200, height: 800 }, 'in')).toBe(cam);
    expect(canZoomIn(cam)).toBe(false);
  });

  it('TC-07 a viewport size change leaves the camera unchanged', () => {
    // Camera x,y is the top-left world point, independent of viewport size;
    // resizing must not require any camera update. Stepping uses the size only
    // to find the centre, and the camera object itself is never mutated.
    const cam: Camera = Object.freeze({ x: 10, y: 20, zoom: 1 });
    const small = { width: 800, height: 600 };
    const large = { width: 1920, height: 1080 };
    zoomStep(cam, small, 'in');
    zoomStep(cam, large, 'in');
    expect(cam).toEqual({ x: 10, y: 20, zoom: 1 });
    expect(worldToScreen(cam, { x: 10, y: 20 })).toEqual({ x: 0, y: 0 });
  });

  it('TC-08 resetCamera centres the origin at zoom 1', () => {
    const cam = resetCamera({ width: 1200, height: 800 });
    expect(cam).toEqual({ x: -600, y: -400, zoom: 1 });
    expect(worldToScreen(cam, { x: 0, y: 0 })).toEqual({ x: 600, y: 400 });
  });

  it('TC-09 one step in then one step out returns exactly to 1.0', () => {
    const vp = { width: 1200, height: 800 };
    const start: Camera = { x: 0, y: 0, zoom: 1 };
    const inCam = zoomStep(start, vp, 'in');
    expect(inCam.zoom).toBe(ZOOM_STEP_FACTOR);
    const outCam = zoomStep(inCam, vp, 'out');
    expect(outCam.zoom).toBe(1);
    expect(zoomPercent(outCam)).toBe(PERCENT);
  });

  it('zoomStep keeps the viewport centre fixed', () => {
    const vp = { width: 1200, height: 800 };
    const start: Camera = { x: 5, y: 7, zoom: 1 };
    const c = { x: vp.width / 2, y: vp.height / 2 };
    const before = screenToWorld(start, c);
    const after = screenToWorld(zoomStep(start, vp, 'in'), c);
    expectClose(after.x, before.x);
    expectClose(after.y, before.y);
  });

  it('many steps in and out do not drift', () => {
    const vp = { width: 1200, height: 800 };
    let cam: Camera = { x: 0, y: 0, zoom: 1 };
    for (let i = 0; i < 5; i++) cam = zoomStep(cam, vp, 'in');
    for (let i = 0; i < 5; i++) cam = zoomStep(cam, vp, 'out');
    expect(cam.zoom).toBe(1);
  });

  it('TC-10 20 steps in clamps at ZOOM_MAX', () => {
    const vp = { width: 1200, height: 800 };
    let cam: Camera = { x: 0, y: 0, zoom: 1 };
    for (let i = 0; i < 20; i++) cam = zoomStep(cam, vp, 'in');
    expect(cam.zoom).toBe(ZOOM_MAX);
    expect(canZoomIn(cam)).toBe(false);
    expect(canZoomOut(cam)).toBe(true);
    expect(zoomPercent(cam)).toBe(ZOOM_MAX * PERCENT);
  });

  it('many steps out clamps at ZOOM_MIN', () => {
    const vp = { width: 1200, height: 800 };
    let cam: Camera = { x: 0, y: 0, zoom: 1 };
    for (let i = 0; i < 30; i++) cam = zoomStep(cam, vp, 'out');
    expect(cam.zoom).toBe(ZOOM_MIN);
    expect(canZoomOut(cam)).toBe(false);
    expect(zoomPercent(cam)).toBe(Math.round(ZOOM_MIN * PERCENT));
  });

  it('TC-11 a huge factor clamps to ZOOM_MAX and keeps pointer invariance', () => {
    const cam: Camera = { x: 0, y: 0, zoom: 1 };
    const p = { x: 300, y: 200 };
    const before = screenToWorld(cam, p);
    const next = zoomAt(cam, p, 1000);
    expect(next.zoom).toBe(ZOOM_MAX);
    const after = screenToWorld(next, p);
    expectClose(after.x, before.x);
    expectClose(after.y, before.y);
  });

  it('TC-12 invalid factors return the camera unchanged', () => {
    const cam: Camera = { x: 1, y: 2, zoom: 1 };
    for (const f of [0, -1, -0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const next = zoomAt(cam, { x: 100, y: 100 }, f);
      expect(next).toBe(cam);
      expect(Number.isNaN(next.x) || Number.isNaN(next.y) || Number.isNaN(next.zoom)).toBe(false);
    }
  });

  it('zoomPercent rounds to a whole number', () => {
    expect(zoomPercent({ x: 0, y: 0, zoom: 1.5625 })).toBe(156);
    expect(zoomPercent({ x: 0, y: 0, zoom: 1 })).toBe(PERCENT);
  });

  it('property: pointer world point is invariant under zoomAt (1,000 seeded cases)', () => {
    // Mulberry32 seeded PRNG for reproducibility.
    let seed = 0x5eed;
    const rand = () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let i = 0; i < 1000; i++) {
      const cam: Camera = {
        x: (rand() * 2 - 1) * FAR,
        y: (rand() * 2 - 1) * FAR,
        zoom: ZOOM_MIN + rand() * (ZOOM_MAX - ZOOM_MIN),
      };
      const p = { x: rand() * 1920, y: rand() * 1080 };
      const factor = Math.exp((rand() * 2 - 1) * 3);
      const before = screenToWorld(cam, p);
      const next = zoomAt(cam, p, factor);
      expect(next.zoom).toBeGreaterThanOrEqual(ZOOM_MIN);
      expect(next.zoom).toBeLessThanOrEqual(ZOOM_MAX);
      const after = screenToWorld(next, p);
      expectClose(after.x, before.x);
      expectClose(after.y, before.y);
    }
  });
});
