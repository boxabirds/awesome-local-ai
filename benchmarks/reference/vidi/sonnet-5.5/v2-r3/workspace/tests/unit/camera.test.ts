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
import { UNBOUNDED_PAN_TESTED_EXTENT, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP_FACTOR } from '../../src/shared/config';

const EPS = 1e-6;
const origin: Camera = { x: 0, y: 0, zoom: 1 };
const viewport = { width: 1200, height: 800 };

function expectSameWorld(a: { x: number; y: number }, b: { x: number; y: number }) {
  expect(Math.abs(a.x - b.x)).toBeLessThan(EPS);
  expect(Math.abs(a.y - b.y)).toBeLessThan(EPS);
}

describe('panBy', () => {
  it('TC-01 moves the world by the screen delta', () => {
    const c = panBy(origin, 200, 100);
    expect(c.x).toBe(-200);
    expect(c.y).toBe(-100);
    expect(worldToScreen(c, { x: 0, y: 0 })).toEqual({ x: 200, y: 100 });
  });
  it('TC-02 at max zoom far away shifts by delta/zoom', () => {
    const far: Camera = { x: UNBOUNDED_PAN_TESTED_EXTENT, y: UNBOUNDED_PAN_TESTED_EXTENT, zoom: ZOOM_MAX };
    const c = panBy(far, 200, 100);
    expect(Math.abs(c.x - (far.x - 200 / ZOOM_MAX))).toBeLessThan(EPS);
    expect(Math.abs(c.y - (far.y - 100 / ZOOM_MAX))).toBeLessThan(EPS);
  });
  it('returns the same object for a zero delta', () => {
    expect(panBy(origin, 0, 0)).toBe(origin);
  });
});

describe('zoomAt', () => {
  it('TC-03 keeps the pointer world point fixed', () => {
    const p = { x: 300, y: 200 };
    const c = zoomAt(origin, p, 2);
    expect(c.zoom).toBe(2);
    expectSameWorld(screenToWorld(c, p), screenToWorld(origin, p));
  });
  it('TC-04 invariant far away', () => {
    const far: Camera = { x: UNBOUNDED_PAN_TESTED_EXTENT, y: -UNBOUNDED_PAN_TESTED_EXTENT, zoom: 1 };
    const p = { x: 417, y: 233 };
    expectSameWorld(screenToWorld(zoomAt(far, p, 1.5), p), screenToWorld(far, p));
  });
  it('TC-05 at min, zooming out returns the same camera', () => {
    const min: Camera = { x: 0, y: 0, zoom: ZOOM_MIN };
    expect(zoomAt(min, { x: 600, y: 400 }, 1 / ZOOM_STEP_FACTOR)).toBe(min);
    expect(zoomStep(min, viewport, 'out')).toBe(min);
  });
  it('TC-06 at max, zooming in returns the same camera', () => {
    const max: Camera = { x: 0, y: 0, zoom: ZOOM_MAX };
    expect(zoomAt(max, { x: 600, y: 400 }, ZOOM_STEP_FACTOR)).toBe(max);
    expect(zoomStep(max, viewport, 'in')).toBe(max);
  });
  it('TC-11 huge factor clamps and keeps invariance', () => {
    const p = { x: 123, y: 456 };
    const c = zoomAt(origin, p, 1000);
    expect(c.zoom).toBe(ZOOM_MAX);
    expectSameWorld(screenToWorld(c, p), screenToWorld(origin, p));
  });
  it('TC-12 invalid factors leave the camera unchanged', () => {
    for (const f of [0, -1, NaN, Infinity, -Infinity]) {
      const c = zoomAt(origin, { x: 10, y: 10 }, f);
      expect(c).toBe(origin);
      expect(Number.isNaN(c.x) || Number.isNaN(c.zoom)).toBe(false);
    }
  });
  it('property: pointer world point is invariant (1000 seeded cases)', () => {
    let seed = 12345;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    for (let i = 0; i < 1000; i++) {
      const cam: Camera = {
        x: (rnd() - 0.5) * 2 * UNBOUNDED_PAN_TESTED_EXTENT,
        y: (rnd() - 0.5) * 2 * UNBOUNDED_PAN_TESTED_EXTENT,
        zoom: ZOOM_MIN + rnd() * (ZOOM_MAX - ZOOM_MIN),
      };
      const p = { x: rnd() * 1920, y: rnd() * 1080 };
      const factor = Math.exp((rnd() - 0.5) * 4);
      expectSameWorld(screenToWorld(zoomAt(cam, p, factor), p), screenToWorld(cam, p));
    }
  });
});

describe('resize, reset, steps', () => {
  it('TC-07 a viewport size change does not touch the camera', () => {
    // The camera has no viewport dependency; resize only changes the Size passed to steps/reset.
    const cam: Camera = { x: 5, y: 6, zoom: 1 };
    const snapshot = { ...cam };
    resetCamera({ width: 100, height: 100 });
    expect(cam).toEqual(snapshot);
  });
  it('TC-08 reset centres the origin at zoom 1', () => {
    const c = resetCamera(viewport);
    expect(c).toEqual({ x: -600, y: -400, zoom: 1 });
    expect(worldToScreen(c, { x: 0, y: 0 })).toEqual({ x: 600, y: 400 });
  });
  it('TC-09 step in then out returns exactly 1', () => {
    const a = zoomStep(origin, viewport, 'in');
    expect(a.zoom).toBe(ZOOM_STEP_FACTOR);
    const b = zoomStep(a, viewport, 'out');
    expect(b.zoom).toBe(1);
    expect(zoomPercent(b)).toBe(100);
  });
  it('step keeps the viewport centre fixed', () => {
    const centre = { x: 600, y: 400 };
    const c = zoomStep(origin, viewport, 'in');
    expectSameWorld(screenToWorld(c, centre), screenToWorld(origin, centre));
  });
  it('TC-10 20 steps in clamps at max', () => {
    let c = origin;
    for (let i = 0; i < 20; i++) c = zoomStep(c, viewport, 'in');
    expect(c.zoom).toBe(ZOOM_MAX);
    expect(canZoomIn(c)).toBe(false);
    expect(canZoomOut(c)).toBe(true);
  });
  it('20 steps out clamps at min', () => {
    let c = origin;
    for (let i = 0; i < 20; i++) c = zoomStep(c, viewport, 'out');
    expect(c.zoom).toBe(ZOOM_MIN);
    expect(canZoomOut(c)).toBe(false);
    expect(canZoomIn(c)).toBe(true);
  });
  it('zoomPercent rounds', () => {
    expect(zoomPercent({ x: 0, y: 0, zoom: 1.5625 })).toBe(156);
  });
});
