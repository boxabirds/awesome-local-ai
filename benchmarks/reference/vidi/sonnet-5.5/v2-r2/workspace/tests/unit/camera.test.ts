import { describe, expect, it } from 'vitest';
import {
  type Camera, canZoomIn, canZoomOut, panBy, resetCamera, screenToWorld, worldToScreen,
  zoomAt, zoomPercent, zoomStep,
} from '../../src/client/canvas/camera';
import {
  UNBOUNDED_PAN_TESTED_EXTENT, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP_FACTOR,
} from '../../src/shared/config';

const EPS = 1e-6;
const VIEWPORT = { width: 1200, height: 800 };
const origin: Camera = { x: 0, y: 0, zoom: 1 };

function expectPointerInvariant(before: Camera, after: Camera, p: { x: number; y: number }) {
  const a = screenToWorld(before, p);
  const b = screenToWorld(after, p);
  expect(Math.abs(a.x - b.x)).toBeLessThan(EPS);
  expect(Math.abs(a.y - b.y)).toBeLessThan(EPS);
}

describe('camera.math', () => {
  it('TC-01 panBy moves content with the pointer', () => {
    const c = panBy(origin, 200, 100);
    expect(c.x).toBe(-200);
    expect(c.y).toBe(-100);
    expect(worldToScreen(c, { x: 0, y: 0 })).toEqual({ x: 200, y: 100 });
  });

  it('TC-02 panBy at max zoom far away', () => {
    const far: Camera = { x: UNBOUNDED_PAN_TESTED_EXTENT, y: UNBOUNDED_PAN_TESTED_EXTENT, zoom: ZOOM_MAX };
    const c = panBy(far, 200, 100);
    expect(Math.abs(c.x - (far.x - 200 / ZOOM_MAX))).toBeLessThan(EPS);
    expect(Math.abs(c.y - (far.y - 100 / ZOOM_MAX))).toBeLessThan(EPS);
  });

  it('panBy with zero delta returns the same object', () => {
    expect(panBy(origin, 0, 0)).toBe(origin);
  });

  it('TC-03 zoomAt keeps pointer world point at origin', () => {
    const p = { x: 300, y: 200 };
    const c = zoomAt(origin, p, 2);
    expect(c.zoom).toBe(2);
    expectPointerInvariant(origin, c, p);
  });

  it('TC-04 zoomAt keeps pointer world point far away', () => {
    const far: Camera = { x: UNBOUNDED_PAN_TESTED_EXTENT, y: -UNBOUNDED_PAN_TESTED_EXTENT, zoom: 1 };
    const p = { x: 411, y: 123 };
    expectPointerInvariant(far, zoomAt(far, p, 1.5), p);
  });

  it('TC-05 at min zoom, zooming out returns same camera', () => {
    const min: Camera = { x: 0, y: 0, zoom: ZOOM_MIN };
    expect(zoomAt(min, { x: 600, y: 400 }, 1 / ZOOM_STEP_FACTOR)).toBe(min);
    expect(zoomStep(min, VIEWPORT, 'out')).toBe(min);
  });

  it('TC-06 at max zoom, zooming in returns same camera', () => {
    const max: Camera = { x: 0, y: 0, zoom: ZOOM_MAX };
    expect(zoomAt(max, { x: 600, y: 400 }, ZOOM_STEP_FACTOR)).toBe(max);
    expect(zoomStep(max, VIEWPORT, 'in')).toBe(max);
  });

  it('TC-07 viewport resize does not change camera', () => {
    const cam: Camera = { x: 5, y: 6, zoom: 1 };
    const before = { ...cam };
    resetCamera({ width: 100, height: 100 }); // unrelated viewport sizes never touch an existing camera
    expect(cam).toEqual(before);
  });

  it('TC-08 resetCamera centres origin at zoom 1', () => {
    const c = resetCamera(VIEWPORT);
    expect(c.zoom).toBe(1);
    expect(worldToScreen(c, { x: 0, y: 0 })).toEqual({ x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 });
    expect(c.x).toBe(-600);
    expect(c.y).toBe(-400);
  });

  it('TC-09 step in then out returns exactly 1', () => {
    const up = zoomStep(origin, VIEWPORT, 'in');
    expect(up.zoom).toBe(ZOOM_STEP_FACTOR);
    const down = zoomStep(up, VIEWPORT, 'out');
    expect(down.zoom).toBe(1);
    expect(zoomPercent(down)).toBe(100);
  });

  it('zoomStep keeps the viewport centre fixed', () => {
    const c = zoomStep(origin, VIEWPORT, 'in');
    expectPointerInvariant(origin, c, { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 });
  });

  it('TC-10 20 steps in clamps at max', () => {
    let c = origin;
    for (let i = 0; i < 20; i++) c = zoomStep(c, VIEWPORT, 'in');
    expect(c.zoom).toBe(ZOOM_MAX);
    expect(canZoomIn(c)).toBe(false);
    expect(canZoomOut(c)).toBe(true);
  });

  it('20 steps out clamps at min', () => {
    let c = origin;
    for (let i = 0; i < 20; i++) c = zoomStep(c, VIEWPORT, 'out');
    expect(c.zoom).toBe(ZOOM_MIN);
    expect(canZoomOut(c)).toBe(false);
    expect(canZoomIn(c)).toBe(true);
  });

  it('TC-11 huge factor clamps and keeps pointer invariance', () => {
    const p = { x: 300, y: 200 };
    const c = zoomAt(origin, p, 1000);
    expect(c.zoom).toBe(ZOOM_MAX);
    expectPointerInvariant(origin, c, p);
  });

  it.each([0, -1, NaN, Infinity, -Infinity])('TC-12 invalid factor %s leaves camera unchanged', (f) => {
    const c = zoomAt(origin, { x: 10, y: 10 }, f);
    expect(c).toBe(origin);
    expect(Number.isNaN(c.x) || Number.isNaN(c.y) || Number.isNaN(c.zoom)).toBe(false);
  });

  it('zoomPercent rounds', () => {
    expect(zoomPercent({ x: 0, y: 0, zoom: 1.5625 })).toBe(156);
  });

  it('property: pointer world point invariant under zoomAt', () => {
    let seed = 12345;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    for (let i = 0; i < 1000; i++) {
      const cam: Camera = {
        x: (rand() - 0.5) * 2 * UNBOUNDED_PAN_TESTED_EXTENT,
        y: (rand() - 0.5) * 2 * UNBOUNDED_PAN_TESTED_EXTENT,
        zoom: ZOOM_MIN + rand() * (ZOOM_MAX - ZOOM_MIN),
      };
      const p = { x: rand() * 1920, y: rand() * 1080 };
      const factor = 0.1 + rand() * 10;
      expectPointerInvariant(cam, zoomAt(cam, p, factor), p);
    }
  });
});
