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
  UNBOUNDED_PAN_TESTED_EXTENT as FAR,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP_FACTOR,
} from '../../src/shared/config';

const EPS = 1e-6;
const VIEW = { width: 1200, height: 800 };
const origin: Camera = { x: 0, y: 0, zoom: 1 };

function expectPointerInvariant(cam: Camera, p: { x: number; y: number }, factor: number) {
  const before = screenToWorld(cam, p);
  const after = screenToWorld(zoomAt(cam, p, factor), p);
  expect(Math.abs(after.x - before.x)).toBeLessThan(EPS);
  expect(Math.abs(after.y - before.y)).toBeLessThan(EPS);
}

describe('camera.math', () => {
  it('TC-01 panBy moves content by the screen delta', () => {
    const c = panBy(origin, 200, 100);
    expect(c.x).toBe(-200);
    expect(c.y).toBe(-100);
    expect(worldToScreen(c, { x: 0, y: 0 })).toEqual({ x: 200, y: 100 });
  });

  it('TC-02 panBy at max zoom far away shifts by delta/zoom exactly', () => {
    const cam = { x: FAR, y: -FAR, zoom: ZOOM_MAX };
    const c = panBy(cam, 200, 100);
    expect(Math.abs(c.x - (FAR - 200 / ZOOM_MAX))).toBeLessThan(EPS);
    expect(Math.abs(c.y - (-FAR - 100 / ZOOM_MAX))).toBeLessThan(EPS);
  });

  it('panBy with zero delta returns the same object', () => {
    expect(panBy(origin, 0, 0)).toBe(origin);
  });

  it('TC-03 zoomAt keeps the pointer world point at the origin', () => {
    const p = { x: 300, y: 200 };
    const c = zoomAt(origin, p, 2);
    expect(c.zoom).toBe(2);
    expectPointerInvariant(origin, p, 2);
  });

  it('TC-04 zoomAt keeps the pointer world point far away', () => {
    const cam = { x: FAR, y: FAR, zoom: 1 };
    expectPointerInvariant(cam, { x: 640, y: 360 }, 1.5);
  });

  it('TC-05 zooming out at ZOOM_MIN returns the same camera', () => {
    const cam = { x: 5, y: 6, zoom: ZOOM_MIN };
    expect(zoomAt(cam, { x: 600, y: 400 }, 1 / ZOOM_STEP_FACTOR)).toBe(cam);
    expect(zoomStep(cam, VIEW, 'out')).toBe(cam);
  });

  it('TC-06 zooming in at ZOOM_MAX returns the same camera', () => {
    const cam = { x: 5, y: 6, zoom: ZOOM_MAX };
    expect(zoomAt(cam, { x: 600, y: 400 }, ZOOM_STEP_FACTOR)).toBe(cam);
    expect(zoomStep(cam, VIEW, 'in')).toBe(cam);
  });

  it('TC-07 viewport size change does not affect the camera (pure value)', () => {
    const cam = Object.freeze({ x: 3, y: 4, zoom: 1 });
    resetCamera({ width: 100, height: 100 });
    expect(cam).toEqual({ x: 3, y: 4, zoom: 1 });
  });

  it('TC-08 resetCamera centres the origin at zoom 1', () => {
    expect(resetCamera(VIEW)).toEqual({ x: -600, y: -400, zoom: 1 });
    const c = resetCamera(VIEW);
    expect(worldToScreen(c, { x: 0, y: 0 })).toEqual({ x: 600, y: 400 });
  });

  it('TC-09 step in then out returns exactly 1.0', () => {
    const up = zoomStep(origin, VIEW, 'in');
    expect(up.zoom).toBe(ZOOM_STEP_FACTOR);
    const down = zoomStep(up, VIEW, 'out');
    expect(down.zoom).toBe(1);
    expect(zoomPercent(down)).toBe(100);
  });

  it('step zoom keeps the viewport centre fixed', () => {
    const cam = { x: 123, y: -45, zoom: 1 };
    const centre = { x: VIEW.width / 2, y: VIEW.height / 2 };
    const c = zoomStep(cam, VIEW, 'in');
    expect(screenToWorld(c, centre).x).toBeCloseTo(screenToWorld(cam, centre).x, 6);
    expect(screenToWorld(c, centre).y).toBeCloseTo(screenToWorld(cam, centre).y, 6);
  });

  it('TC-10 repeated zoom in stops at ZOOM_MAX', () => {
    let c = origin;
    for (let i = 0; i < 20; i++) c = zoomStep(c, VIEW, 'in');
    expect(c.zoom).toBe(ZOOM_MAX);
    expect(canZoomIn(c)).toBe(false);
    expect(canZoomOut(c)).toBe(true);
  });

  it('repeated zoom out stops at ZOOM_MIN', () => {
    let c = origin;
    for (let i = 0; i < 30; i++) c = zoomStep(c, VIEW, 'out');
    expect(c.zoom).toBe(ZOOM_MIN);
    expect(canZoomOut(c)).toBe(false);
    expect(canZoomIn(c)).toBe(true);
  });

  it('TC-11 huge factor clamps and keeps pointer invariance', () => {
    const p = { x: 300, y: 200 };
    const c = zoomAt(origin, p, 1000);
    expect(c.zoom).toBe(ZOOM_MAX);
    const before = screenToWorld(origin, p);
    const after = screenToWorld(c, p);
    expect(Math.abs(after.x - before.x)).toBeLessThan(EPS);
    expect(Math.abs(after.y - before.y)).toBeLessThan(EPS);
  });

  it.each([0, -1, NaN, Infinity, -Infinity])('TC-12 invalid factor %s leaves camera unchanged', (f) => {
    const c = zoomAt(origin, { x: 10, y: 10 }, f);
    expect(c).toBe(origin);
    expect(Number.isNaN(c.x) || Number.isNaN(c.y) || Number.isNaN(c.zoom)).toBe(false);
  });

  it('zoomPercent rounds to a whole number', () => {
    expect(zoomPercent({ x: 0, y: 0, zoom: 1.5625 })).toBe(156);
  });

  it('property: pointer world point invariant over 1,000 random zooms', () => {
    let seed = 12345;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    for (let i = 0; i < 1000; i++) {
      const cam = {
        x: (rnd() * 2 - 1) * FAR,
        y: (rnd() * 2 - 1) * FAR,
        zoom: ZOOM_MIN + rnd() * (ZOOM_MAX - ZOOM_MIN),
      };
      const p = { x: rnd() * 1920, y: rnd() * 1080 };
      const factor = ZOOM_MIN + rnd() * (ZOOM_MAX / ZOOM_MIN);
      expectPointerInvariant(cam, p, factor);
    }
  });
});
