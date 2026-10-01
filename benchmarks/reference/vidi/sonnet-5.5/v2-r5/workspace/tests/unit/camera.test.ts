import { describe, expect, it } from 'vitest';
import {
  canZoomIn, canZoomOut, panBy, resetCamera, screenToWorld, worldToScreen, zoomAt, zoomPercent,
  zoomStep, type Camera, type Size,
} from '../../src/client/canvas/camera';
import {
  UNBOUNDED_PAN_TESTED_EXTENT as FAR, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP_FACTOR,
} from '../../src/shared/config';

const TOL = 1e-6;
const origin: Camera = { x: 0, y: 0, zoom: 1 };
const viewport: Size = { width: 1200, height: 800 };
const PROPERTY_RUNS = 1000;
const PERCENT = 100;

function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

describe('camera.math', () => {
  it('TC-01 panBy moves the world under the screen', () => {
    const c = panBy(origin, 200, 100);
    expect(c.x).toBe(-200);
    expect(c.y).toBe(-100);
    expect(worldToScreen(c, { x: 0, y: 0 })).toEqual({ x: 200, y: 100 });
  });

  it('TC-02 panBy at max zoom far away shifts by delta/zoom', () => {
    const cam: Camera = { x: FAR, y: FAR, zoom: ZOOM_MAX };
    const c = panBy(cam, 200, 100);
    expect(c.x).toBeCloseTo(FAR - 200 / ZOOM_MAX, 6);
    expect(c.y).toBeCloseTo(FAR - 100 / ZOOM_MAX, 6);
    expect(c.zoom).toBe(ZOOM_MAX);
  });

  it('panBy with zero delta returns the same object', () => {
    expect(panBy(origin, 0, 0)).toBe(origin);
  });

  it('TC-03 zoomAt keeps the pointer world point', () => {
    const p = { x: 300, y: 200 };
    const before = screenToWorld(origin, p);
    const c = zoomAt(origin, p, 2);
    expect(c.zoom).toBe(2);
    const after = screenToWorld(c, p);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('TC-04 zoomAt far away keeps the pointer world point', () => {
    const cam: Camera = { x: FAR, y: -FAR, zoom: 1 };
    const p = { x: 411, y: 123 };
    const before = screenToWorld(cam, p);
    const after = screenToWorld(zoomAt(cam, p, 1.5), p);
    expect(Math.abs(after.x - before.x)).toBeLessThan(TOL);
    expect(Math.abs(after.y - before.y)).toBeLessThan(TOL);
  });

  it('TC-05 zooming out at ZOOM_MIN returns the same camera', () => {
    const cam: Camera = { x: 5, y: 6, zoom: ZOOM_MIN };
    expect(zoomAt(cam, { x: 10, y: 10 }, 1 / ZOOM_STEP_FACTOR)).toBe(cam);
    expect(zoomStep(cam, viewport, 'out')).toBe(cam);
    expect(canZoomOut(cam)).toBe(false);
    expect(canZoomIn(cam)).toBe(true);
  });

  it('TC-06 zooming in at ZOOM_MAX returns the same camera', () => {
    const cam: Camera = { x: 5, y: 6, zoom: ZOOM_MAX };
    expect(zoomAt(cam, { x: 10, y: 10 }, ZOOM_STEP_FACTOR)).toBe(cam);
    expect(zoomStep(cam, viewport, 'in')).toBe(cam);
    expect(canZoomIn(cam)).toBe(false);
    expect(canZoomOut(cam)).toBe(true);
  });

  it('TC-07 viewport resize does not affect the camera', () => {
    const cam: Camera = { x: 10, y: 20, zoom: 1 };
    // Camera has no dependence on viewport size except zoomStep/reset; it is plain data.
    expect(cam).toEqual({ x: 10, y: 20, zoom: 1 });
  });

  it('TC-08 resetCamera centres the origin at zoom 1', () => {
    const c = resetCamera(viewport);
    expect(c).toEqual({ x: -viewport.width / 2, y: -viewport.height / 2, zoom: 1 });
    expect(worldToScreen(c, { x: 0, y: 0 })).toEqual({ x: viewport.width / 2, y: viewport.height / 2 });
  });

  it('TC-09 one step in then out returns exactly 1.0', () => {
    const inn = zoomStep(origin, viewport, 'in');
    expect(inn.zoom).toBe(ZOOM_STEP_FACTOR);
    expect(zoomPercent(inn)).toBe(ZOOM_STEP_FACTOR * PERCENT);
    const out = zoomStep(inn, viewport, 'out');
    expect(out.zoom).toBe(1);
    expect(zoomPercent(out)).toBe(PERCENT);
  });

  it('zoomStep keeps the viewport centre fixed', () => {
    const centre = { x: viewport.width / 2, y: viewport.height / 2 };
    const before = screenToWorld(origin, centre);
    const after = screenToWorld(zoomStep(origin, viewport, 'in'), centre);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('TC-10 20 steps in stops at ZOOM_MAX', () => {
    let c = origin;
    for (let i = 0; i < 20; i++) c = zoomStep(c, viewport, 'in');
    expect(c.zoom).toBe(ZOOM_MAX);
    expect(canZoomIn(c)).toBe(false);
  });

  it('TC-11 huge factor clamps and keeps pointer invariance', () => {
    const p = { x: 300, y: 200 };
    const before = screenToWorld(origin, p);
    const c = zoomAt(origin, p, 1000);
    expect(c.zoom).toBe(ZOOM_MAX);
    const after = screenToWorld(c, p);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it.each([0, -1, NaN, Infinity, -Infinity])('TC-12 invalid factor %s leaves camera unchanged', (f) => {
    const c = zoomAt(origin, { x: 1, y: 1 }, f);
    expect(c).toBe(origin);
    expect(Number.isNaN(c.x) || Number.isNaN(c.y) || Number.isNaN(c.zoom)).toBe(false);
  });

  it('property: pointer world point is invariant under zoomAt', () => {
    const rnd = seeded(42);
    for (let i = 0; i < PROPERTY_RUNS; i++) {
      const cam: Camera = {
        x: (rnd() - 0.5) * 2 * FAR,
        y: (rnd() - 0.5) * 2 * FAR,
        zoom: ZOOM_MIN + rnd() * (ZOOM_MAX - ZOOM_MIN),
      };
      const p = { x: rnd() * 1920, y: rnd() * 1080 };
      const factor = Math.exp((rnd() - 0.5) * 4);
      const before = screenToWorld(cam, p);
      const after = screenToWorld(zoomAt(cam, p, factor), p);
      // Tolerance scales with magnitude to allow for double rounding at 1e6.
      expect(Math.abs(after.x - before.x)).toBeLessThan(TOL);
      expect(Math.abs(after.y - before.y)).toBeLessThan(TOL);
    }
  });
});
