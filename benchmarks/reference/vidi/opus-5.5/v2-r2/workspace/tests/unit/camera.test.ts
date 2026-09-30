import { describe, expect, it } from 'vitest';
import {
  type Camera,
  canZoomIn,
  canZoomOut,
  panBy,
  resetCamera,
  screenToWorld,
  worldToScreen,
  zoomAt,
  zoomPercent,
  zoomStep,
} from '../../src/client/canvas/camera';
import {
  UNBOUNDED_PAN_TESTED_EXTENT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP_FACTOR,
} from '../../src/shared/config';

const PRECISION = 1e-6;
const VIEWPORT = { width: 1200, height: 800 };
const CENTRE = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
const ORIGIN_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };
const FAR = UNBOUNDED_PAN_TESTED_EXTENT;

describe('camera.math', () => {
  it('TC-01 panBy at zoom 1 from the origin shifts the camera by the screen delta', () => {
    const next = panBy(ORIGIN_CAMERA, 200, 100);
    expect(next.x).toBe(-200);
    expect(next.y).toBe(-100);
    expect(next.zoom).toBe(1);
    expect(worldToScreen(ORIGIN_CAMERA, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    expect(worldToScreen(next, { x: 0, y: 0 })).toEqual({ x: 200, y: 100 });
  });

  it('TC-02 panBy at ZOOM_MAX far away shifts by delta / zoom exactly', () => {
    const cam: Camera = { x: FAR, y: FAR, zoom: ZOOM_MAX };
    const next = panBy(cam, 200, 100);
    expect(Math.abs(next.x - (FAR - 200 / ZOOM_MAX))).toBeLessThan(PRECISION);
    expect(Math.abs(next.y - (FAR - 100 / ZOOM_MAX))).toBeLessThan(PRECISION);
    // A world point keeps following the pointer exactly.
    const w = { x: FAR + 10, y: FAR + 10 };
    const before = worldToScreen(cam, w);
    const after = worldToScreen(next, w);
    expect(Math.abs(after.x - before.x - 200)).toBeLessThan(PRECISION);
    expect(Math.abs(after.y - before.y - 100)).toBeLessThan(PRECISION);
  });

  it('panBy with zero delta returns the same object', () => {
    expect(panBy(ORIGIN_CAMERA, 0, 0)).toBe(ORIGIN_CAMERA);
  });

  it('TC-03 zoomAt keeps the world point under the pointer invariant', () => {
    const p = { x: 300, y: 200 };
    const before = screenToWorld(ORIGIN_CAMERA, p);
    const next = zoomAt(ORIGIN_CAMERA, p, 2);
    expect(next.zoom).toBe(2);
    expect(screenToWorld(next, p)).toEqual(before);
  });

  it('TC-04 zoomAt far away keeps the pointer world point within precision', () => {
    const cam: Camera = { x: FAR, y: -FAR, zoom: 1 };
    const p = { x: 437, y: 191 };
    const before = screenToWorld(cam, p);
    const next = zoomAt(cam, p, 1.5);
    const after = screenToWorld(next, p);
    expect(Math.abs(after.x - before.x)).toBeLessThan(PRECISION);
    expect(Math.abs(after.y - before.y)).toBeLessThan(PRECISION);
  });

  it('TC-05 zooming out at ZOOM_MIN returns the same camera', () => {
    const cam: Camera = { x: 5, y: 7, zoom: ZOOM_MIN };
    const next = zoomAt(cam, CENTRE, 1 / ZOOM_STEP_FACTOR);
    expect(next).toBe(cam);
    expect(zoomStep(cam, VIEWPORT, 'out')).toBe(cam);
    expect(canZoomOut(cam)).toBe(false);
    expect(canZoomIn(cam)).toBe(true);
  });

  it('TC-06 zooming in at ZOOM_MAX returns the same camera', () => {
    const cam: Camera = { x: 5, y: 7, zoom: ZOOM_MAX };
    const next = zoomAt(cam, CENTRE, ZOOM_STEP_FACTOR);
    expect(next).toBe(cam);
    expect(zoomStep(cam, VIEWPORT, 'in')).toBe(cam);
    expect(canZoomIn(cam)).toBe(false);
    expect(canZoomOut(cam)).toBe(true);
  });

  it('TC-07 a viewport size change does not alter the camera', () => {
    // The camera is anchored at the viewport top-left, so it carries no size.
    const cam: Camera = { x: 12, y: 34, zoom: 1 };
    const w = { x: 50, y: 60 };
    const screenBefore = worldToScreen(cam, w);
    // Simulate a resize: nothing about the camera changes, so neither does the
    // screen position of content relative to the top-left corner.
    expect(Object.keys(cam).sort()).toEqual(['x', 'y', 'zoom']);
    expect(worldToScreen(cam, w)).toEqual(screenBefore);
  });

  it('TC-08 resetCamera centres the origin at 100%', () => {
    const cam = resetCamera(VIEWPORT);
    expect(cam).toEqual({ x: -600, y: -400, zoom: 1 });
    expect(worldToScreen(cam, { x: 0, y: 0 })).toEqual(CENTRE);
  });

  it('TC-09 one step in then one step out returns exactly to 1.0', () => {
    const inCam = zoomStep(ORIGIN_CAMERA, VIEWPORT, 'in');
    expect(inCam.zoom).toBe(ZOOM_STEP_FACTOR);
    expect(zoomPercent(inCam)).toBe(125);
    const outCam = zoomStep(inCam, VIEWPORT, 'out');
    expect(outCam.zoom).toBe(1);
    expect(zoomPercent(outCam)).toBe(100);
  });

  it('zoomStep keeps the viewport centre fixed', () => {
    const before = screenToWorld(ORIGIN_CAMERA, CENTRE);
    const next = zoomStep(ORIGIN_CAMERA, VIEWPORT, 'in');
    const after = screenToWorld(next, CENTRE);
    expect(Math.abs(after.x - before.x)).toBeLessThan(PRECISION);
    expect(Math.abs(after.y - before.y)).toBeLessThan(PRECISION);
  });

  it('TC-10 twenty steps in clamps at ZOOM_MAX', () => {
    let cam: Camera = ORIGIN_CAMERA;
    for (let i = 0; i < 20; i++) cam = zoomStep(cam, VIEWPORT, 'in');
    expect(cam.zoom).toBe(ZOOM_MAX);
    expect(canZoomIn(cam)).toBe(false);
    expect(zoomPercent(cam)).toBe(ZOOM_MAX * 100);
  });

  it('twenty steps out clamps at ZOOM_MIN', () => {
    let cam: Camera = ORIGIN_CAMERA;
    for (let i = 0; i < 20; i++) cam = zoomStep(cam, VIEWPORT, 'out');
    expect(cam.zoom).toBe(ZOOM_MIN);
    expect(canZoomOut(cam)).toBe(false);
    expect(zoomPercent(cam)).toBe(ZOOM_MIN * 100);
  });

  it('TC-11 a huge factor clamps to ZOOM_MAX and keeps pointer invariance', () => {
    const p = { x: 300, y: 200 };
    const before = screenToWorld(ORIGIN_CAMERA, p);
    const next = zoomAt(ORIGIN_CAMERA, p, 1000);
    expect(next.zoom).toBe(ZOOM_MAX);
    const after = screenToWorld(next, p);
    expect(Math.abs(after.x - before.x)).toBeLessThan(PRECISION);
    expect(Math.abs(after.y - before.y)).toBeLessThan(PRECISION);
  });

  it.each([0, -1, -0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'TC-12 invalid factor %s returns the camera unchanged',
    (factor) => {
      const next = zoomAt(ORIGIN_CAMERA, { x: 10, y: 10 }, factor);
      expect(next).toBe(ORIGIN_CAMERA);
      expect(Number.isNaN(next.x) || Number.isNaN(next.y) || Number.isNaN(next.zoom)).toBe(false);
    },
  );

  it('zoomPercent rounds to a whole number', () => {
    expect(zoomPercent({ x: 0, y: 0, zoom: 1.5625 })).toBe(156);
  });

  it('property: zoomAt keeps the pointer world point invariant for 1,000 random cases', () => {
    // Deterministic seeded PRNG (mulberry32).
    let seed = 0x5eed;
    const rand = () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const between = (min: number, max: number) => min + rand() * (max - min);
    for (let i = 0; i < 1000; i++) {
      const cam: Camera = {
        x: between(-FAR, FAR),
        y: between(-FAR, FAR),
        zoom: between(ZOOM_MIN, ZOOM_MAX),
      };
      const p = { x: between(0, 1920), y: between(0, 1080) };
      const factor = between(ZOOM_MIN / ZOOM_MAX, ZOOM_MAX / ZOOM_MIN);
      const before = screenToWorld(cam, p);
      const next = zoomAt(cam, p, factor);
      expect(next.zoom).toBeGreaterThanOrEqual(ZOOM_MIN);
      expect(next.zoom).toBeLessThanOrEqual(ZOOM_MAX);
      const after = screenToWorld(next, p);
      expect(Math.abs(after.x - before.x)).toBeLessThan(PRECISION);
      expect(Math.abs(after.y - before.y)).toBeLessThan(PRECISION);
    }
  });
});
